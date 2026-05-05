/**
 * incremental-graph.ts — Incremental computation graph (OCaml-Incremental flavor).
 *
 * A small dependency graph for the model layer of an SDOM program. Cells
 * carry a current value and recompute when any parent changes. Setting a
 * `Var` marks dependents dirty; `stabilize()` walks dirty cells in
 * topological-height order, recomputes, and fires observers for cells
 * whose value crossed the cutoff.
 *
 * Scope:
 *   - Designed for the *model* layer (programs, derivations, optic-focused
 *     subviews). Not meant to back the row reconciler — rows stay as
 *     direct callbacks under array()/incrementalArray() to keep the
 *     bulk-mount path allocation-free.
 *   - Synchronous: stabilize runs to completion before observers see fresh
 *     values. Programs call stabilize at the end of each dispatch.
 *   - One global graph. Cell IDs are session-unique; no contexts.
 *
 * Cutoff:
 *   - Each cell has an `eq` function. After recompute, if `eq(prev, next)`
 *     is true, dependents are NOT marked dirty and observers do not fire.
 *
 * Heights:
 *   - Each cell's height is `max(parent.height) + 1`. The dirty queue
 *     processes cells in ascending height so that by the time a cell
 *     recomputes, every parent it reads has already settled.
 */

import type { UpdateStream, Update, Observer, Unsubscribe as ObsUnsubscribe } from "./observable"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void

/**
 * A reactive cell — a read-only handle to a node in the dependency graph.
 *
 * Renamed from `Node` so it doesn't shadow the global DOM `Node` type.
 * The internal storage is still called `InternalNode` since the data
 * structure is genuinely a graph node.
 */
export interface Cell<T> {
  /** Force any pending stabilization, then read the current value. */
  readonly value: T
  /** Subscribe to value changes (fires after stabilize). */
  observe(observer: (value: T) => void): Unsubscribe
  /** Internal — exposed for derived-cell construction. Do not depend on. */
  readonly _internal: InternalNode<T>
}

/** A writable leaf cell. */
export interface Var<T> extends Cell<T> {
  set(value: T): void
}

/**
 * Internal storage. The `*First / *Rest` shape is a single-occupant fast
 * path: the common case in real apps is one observer per cell (the
 * program view) and zero or one dependent. Avoiding the `Set` allocation
 * for that case skips an iterator object on every notify.
 */
interface InternalNode<T> {
  id: number
  value: T
  height: number
  /** Marked when a parent's value crossed cutoff. Cleared on recompute. */
  dirty: boolean
  /** Parents we read in our recompute; null for vars. */
  parents: InternalNode<unknown>[] | null
  /** Cells that read us in their recompute. */
  dependentsFirst: InternalNode<unknown> | null
  dependentsRest: Set<InternalNode<unknown>> | null
  /** External observers — callbacks that run after stabilize when value changed. */
  observersFirst: ((value: T) => void) | null
  observersRest: Set<(value: T) => void> | null
  /** Pure recompute. Reads parent.value directly. Null for vars. */
  recompute: (() => T) | null
  /** Cutoff: when true, dependents are not marked dirty. */
  eq: (a: T, b: T) => boolean
}

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

let nextId = 0

/**
 * Dirty buckets indexed by cell height. We walk from height 0 upward in
 * `stabilize()`. Because a dependent's height is strictly greater than
 * each of its parents', a single forward pass settles the whole graph:
 * any new dirties enqueued during processing land at heights we haven't
 * reached yet, and the loop's `dirtyMaxHeight` bound is re-read each
 * iteration so the pass naturally extends.
 */
let dirtyBuckets: Array<Set<InternalNode<unknown>> | undefined> = []
let dirtyMaxHeight = -1
let dirtyAny = false

let inBatch = 0

/**
 * Pending observer notifications, stored as parallel arrays to avoid
 * allocating a `{obs, value}` wrapper per pair.
 */
let pendingObs: Array<(value: unknown) => void> = []
let pendingValues: unknown[] = []

function defaultEq<T>(a: T, b: T): boolean {
  return a === b
}

// ---------------------------------------------------------------------------
// Internal: dependents / observers add/remove/iterate
// ---------------------------------------------------------------------------

function addDependent(parent: InternalNode<unknown>, dep: InternalNode<unknown>): void {
  if (parent.dependentsFirst === null) {
    parent.dependentsFirst = dep
    return
  }
  if (parent.dependentsFirst === dep) return
  if (parent.dependentsRest === null) {
    parent.dependentsRest = new Set()
  }
  parent.dependentsRest.add(dep)
}

function removeDependent(parent: InternalNode<unknown>, dep: InternalNode<unknown>): void {
  if (parent.dependentsFirst === dep) {
    if (parent.dependentsRest === null) {
      parent.dependentsFirst = null
      return
    }
    // Promote one from rest to first.
    const iter = parent.dependentsRest.values()
    const promoted = iter.next().value!
    parent.dependentsFirst = promoted
    parent.dependentsRest.delete(promoted)
    if (parent.dependentsRest.size === 0) parent.dependentsRest = null
    return
  }
  if (parent.dependentsRest !== null) {
    parent.dependentsRest.delete(dep)
    if (parent.dependentsRest.size === 0) parent.dependentsRest = null
  }
}

function hasDependents(n: InternalNode<unknown>): boolean {
  return n.dependentsFirst !== null
}

function markDependentsDirty(n: InternalNode<unknown>): void {
  const first = n.dependentsFirst
  if (first === null) return
  enqueueDirty(first)
  const rest = n.dependentsRest
  if (rest !== null) {
    for (const dep of rest) enqueueDirty(dep)
  }
}

function hasObservers<T>(n: InternalNode<T>): boolean {
  return n.observersFirst !== null
}

function notifyObserversInline<T>(n: InternalNode<T>, value: T): void {
  const first = n.observersFirst
  if (first === null) return
  first(value)
  const rest = n.observersRest
  if (rest !== null) rest.forEach((obs) => obs(value))
}

function scheduleObservers<T>(n: InternalNode<T>, value: T): void {
  const first = n.observersFirst
  if (first === null) return
  pendingObs.push(first as (value: unknown) => void)
  pendingValues.push(value)
  const rest = n.observersRest
  if (rest !== null) {
    for (const obs of rest) {
      pendingObs.push(obs as (value: unknown) => void)
      pendingValues.push(value)
    }
  }
}

function flushNotifies(): void {
  if (pendingObs.length === 0) return
  const obs = pendingObs
  const vals = pendingValues
  pendingObs = []
  pendingValues = []
  for (let i = 0; i < obs.length; i++) {
    obs[i]!(vals[i]!)
  }
}

function addObserver<T>(n: InternalNode<T>, obs: (value: T) => void): void {
  if (n.observersFirst === null) {
    n.observersFirst = obs
    return
  }
  if (n.observersRest === null) n.observersRest = new Set()
  n.observersRest.add(obs)
}

function removeObserver<T>(n: InternalNode<T>, obs: (value: T) => void): void {
  if (n.observersFirst === obs) {
    if (n.observersRest === null) {
      n.observersFirst = null
      return
    }
    const iter = n.observersRest.values()
    const promoted = iter.next().value!
    n.observersFirst = promoted
    n.observersRest.delete(promoted)
    if (n.observersRest.size === 0) n.observersRest = null
    return
  }
  if (n.observersRest !== null) {
    n.observersRest.delete(obs)
    if (n.observersRest.size === 0) n.observersRest = null
  }
}

// ---------------------------------------------------------------------------
// Internal: dirty queue
// ---------------------------------------------------------------------------

function enqueueDirty(n: InternalNode<unknown>): void {
  if (n.dirty) return
  n.dirty = true
  let bucket = dirtyBuckets[n.height]
  if (bucket === undefined) {
    bucket = new Set()
    dirtyBuckets[n.height] = bucket
  }
  bucket.add(n)
  dirtyAny = true
  if (n.height > dirtyMaxHeight) dirtyMaxHeight = n.height
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function makeVar<T>(
  initial: T,
  eq: (a: T, b: T) => boolean = defaultEq,
): Var<T> {
  const internal: InternalNode<T> = {
    id: nextId++,
    value: initial,
    height: 0,
    dirty: false,
    parents: null,
    dependentsFirst: null,
    dependentsRest: null,
    observersFirst: null,
    observersRest: null,
    recompute: null,
    eq,
  }
  return {
    get value() {
      return internal.value
    },
    set(next: T) {
      if (internal.eq(internal.value, next)) return
      internal.value = next
      // Leaf fast path: no derived cells and not batched — fire observers
      // inline. This is the hot path for program runners (modelVar has no
      // graph dependents, only direct view subscriptions) and keeps the
      // leaf-only cost on par with a plain notifying signal.
      if (internal.dependentsFirst === null && inBatch === 0) {
        const first = internal.observersFirst
        if (first === null) return
        first(next)
        const rest = internal.observersRest
        if (rest !== null) rest.forEach((obs) => obs(next))
        return
      }
      markDependentsDirty(internal as InternalNode<unknown>)
      if (internal.observersFirst !== null) {
        scheduleObservers(internal, next)
      }
      if (inBatch === 0) stabilize()
    },
    observe(observer: (value: T) => void): Unsubscribe {
      addObserver(internal, observer)
      return () => removeObserver(internal, observer)
    },
    _internal: internal,
  }
}

export function mapCell<A, B>(
  parent: Cell<A>,
  project: (a: A) => B,
  eq: (a: B, b: B) => boolean = defaultEq,
): Cell<B> {
  const p = parent._internal as InternalNode<unknown>
  const internal: InternalNode<B> = {
    id: nextId++,
    value: undefined as unknown as B,
    height: p.height + 1,
    dirty: false,
    parents: [p],
    dependentsFirst: null,
    dependentsRest: null,
    observersFirst: null,
    observersRest: null,
    recompute: () => project(p.value as A),
    eq,
  }
  addDependent(p, internal as InternalNode<unknown>)
  // Compute initial value eagerly so .value is correct without a stabilize
  // sweep just for construction.
  internal.value = (internal.recompute as () => B)()
  return {
    get value() {
      return internal.value
    },
    observe(observer: (value: B) => void): Unsubscribe {
      addObserver(internal, observer)
      return () => removeObserver(internal, observer)
    },
    _internal: internal,
  } as Cell<B>
}

export function mapCell2<A, B, C>(
  a: Cell<A>,
  b: Cell<B>,
  project: (a: A, b: B) => C,
  eq: (a: C, b: C) => boolean = defaultEq,
): Cell<C> {
  const pa = a._internal as InternalNode<unknown>
  const pb = b._internal as InternalNode<unknown>
  const internal: InternalNode<C> = {
    id: nextId++,
    value: undefined as unknown as C,
    height: Math.max(pa.height, pb.height) + 1,
    dirty: false,
    parents: [pa, pb],
    dependentsFirst: null,
    dependentsRest: null,
    observersFirst: null,
    observersRest: null,
    recompute: () => project(pa.value as A, pb.value as B),
    eq,
  }
  addDependent(pa, internal as InternalNode<unknown>)
  addDependent(pb, internal as InternalNode<unknown>)
  internal.value = (internal.recompute as () => C)()
  return {
    get value() {
      return internal.value
    },
    observe(observer: (value: C) => void): Unsubscribe {
      addObserver(internal, observer)
      return () => removeObserver(internal, observer)
    },
    _internal: internal,
  } as Cell<C>
}

/**
 * Run a function with stabilize deferred until exit. Multiple `set` calls
 * inside collapse to a single stabilize sweep at the end.
 */
export function batch<T>(fn: () => T): T {
  inBatch++
  try {
    return fn()
  } finally {
    inBatch--
    if (inBatch === 0) stabilize()
  }
}

/**
 * Drain the dirty queue. Walks from height 0 upward in a single forward
 * pass: because a dependent's height is strictly greater than each parent,
 * any new dirties enqueued during processing land at heights we haven't
 * reached yet. Observers for value-changed cells fire after the pass.
 */
export function stabilize(): void {
  if (dirtyAny) {
    for (let h = 0; h <= dirtyMaxHeight; h++) {
      const bucket = dirtyBuckets[h]
      if (bucket === undefined) continue
      dirtyBuckets[h] = undefined
      for (const n of bucket) {
        if (!n.dirty) continue
        n.dirty = false
        const prev = n.value
        const next = n.recompute === null ? prev : n.recompute()
        if (!n.eq(prev as never, next as never)) {
          n.value = next
          markDependentsDirty(n)
          if (hasObservers(n)) scheduleObservers(n, next)
        }
      }
    }
    dirtyAny = false
    dirtyMaxHeight = -1
  }
  flushNotifies()
}

// ---------------------------------------------------------------------------
// Bridge to UpdateStream
// ---------------------------------------------------------------------------

/**
 * Expose a Cell<T> as an UpdateStream<T>. Each subscriber gets a reusable
 * `{prev, next}` object whose fields are mutated on each emission. This
 * matches the existing toUpdateStream contract — observers must consume
 * the update synchronously and not retain references.
 *
 * Used by program runners to back the existing view surface with the
 * Incremental graph without churning every constructor's attach signature.
 */
export function cellToUpdateStream<T>(cell: Cell<T>): UpdateStream<T> {
  return {
    subscribe(observer: Observer<Update<T>>): ObsUnsubscribe {
      const update: { prev: T; next: T; delta: unknown | undefined } = {
        prev: cell.value,
        next: cell.value,
        delta: undefined,
      }
      return cell.observe((value) => {
        update.prev = update.next
        update.next = value
        update.delta = undefined
        observer(update)
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

/**
 * Unlink a derived cell from its parents so it can be GC'd. Idempotent.
 * Vars do nothing — they have no parents to detach from.
 */
export function disposeCell<T>(cell: Cell<T>): void {
  const n = cell._internal as InternalNode<unknown>
  if (n.parents !== null) {
    for (const p of n.parents) removeDependent(p, n)
    n.parents = null
  }
  n.dependentsFirst = null
  n.dependentsRest = null
  n.observersFirst = null
  n.observersRest = null
  n.recompute = null
}
