/**
 * incremental-graph.ts — Incremental computation graph (OCaml-Incremental flavor).
 *
 * A small dependency graph for the model layer of an SDOM program. Nodes
 * carry a current value and recompute when any parent changes. Setting a
 * `Var` marks dependents dirty; `stabilize()` walks dirty nodes in
 * topological-height order, recomputes, and fires observers for nodes
 * whose value crossed the cutoff.
 *
 * Scope:
 *   - Designed for the *model* layer (programs, derivations, optic-focused
 *     subviews). Not meant to back the row reconciler — rows stay as
 *     direct callbacks under array()/incrementalArray() to keep the
 *     bulk-mount path allocation-free.
 *   - Synchronous: stabilize runs to completion before observers see fresh
 *     values. Programs call stabilize at the end of each dispatch.
 *   - One global graph. Node IDs are session-unique; no contexts.
 *
 * Cutoff:
 *   - Each node has an `eq` function. After recompute, if `eq(prev, next)`
 *     is true, dependents are NOT marked dirty and observers do not fire.
 *
 * Heights:
 *   - Each node's height is `max(parent.height) + 1`. The dirty queue
 *     processes nodes in ascending height so that by the time a node
 *     recomputes, every parent it reads has already settled.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void

/** A read-only handle into a node in the graph. */
export interface Node<T> {
  /** Force any pending stabilization, then read the current value. */
  readonly value: T
  /** Subscribe to value changes (fires after stabilize). */
  observe(observer: (value: T) => void): Unsubscribe
  /** Internal — exposed for derived-node construction. Do not depend on. */
  readonly _internal: InternalNode<T>
}

/** A writable leaf. */
export interface Var<T> extends Node<T> {
  set(value: T): void
}

interface InternalNode<T> {
  id: number
  value: T
  height: number
  /** Bumped each time the node is recomputed; observers compare against prev. */
  stamp: number
  /** Marked when a parent's stamp moves past our last-seen-parent-stamp. */
  dirty: boolean
  /** Parents we read in our recompute; null for vars. */
  parents: InternalNode<unknown>[] | null
  /** Nodes that read us in their recompute. */
  dependents: Set<InternalNode<unknown>>
  /** External observers — callbacks that run after stabilize when value changed. */
  observers: Set<(value: T) => void>
  /** Pure recompute. Reads parent.value directly. Null for vars. */
  recompute: (() => T) | null
  /** Cutoff: when true, dependents are not marked dirty. */
  eq: (a: T, b: T) => boolean
}

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

let nextId = 0
/** Buckets of dirty nodes keyed by height. Drained in ascending height order. */
const dirtyByHeight = new Map<number, Set<InternalNode<unknown>>>()
let inBatch = 0
/** Observers to fire after stabilize completes. Pairs (observer, value). */
let pendingNotifies: Array<{ obs: (value: unknown) => void; value: unknown }> = []

function defaultEq<T>(a: T, b: T): boolean {
  return a === b
}

function enqueueDirty(n: InternalNode<unknown>): void {
  if (n.dirty) return
  n.dirty = true
  let bucket = dirtyByHeight.get(n.height)
  if (bucket === undefined) {
    bucket = new Set()
    dirtyByHeight.set(n.height, bucket)
  }
  bucket.add(n)
}

function markDependentsDirty(n: InternalNode<unknown>): void {
  for (const dep of n.dependents) enqueueDirty(dep)
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
    stamp: 0,
    dirty: false,
    parents: null,
    dependents: new Set(),
    observers: new Set(),
    recompute: null,
    eq,
  }
  return makeHandle(internal, (next) => {
    if (internal.eq(internal.value, next)) return
    internal.value = next
    internal.stamp++
    markDependentsDirty(internal as InternalNode<unknown>)
    if (internal.observers.size > 0) {
      schedulePush(internal as InternalNode<unknown>, next)
    }
    if (inBatch === 0) stabilize()
  })
}

export function map<A, B>(
  parent: Node<A>,
  project: (a: A) => B,
  eq: (a: B, b: B) => boolean = defaultEq,
): Node<B> {
  const p = parent._internal as InternalNode<unknown>
  const internal: InternalNode<B> = {
    id: nextId++,
    value: undefined as unknown as B,
    height: p.height + 1,
    stamp: 0,
    dirty: true,
    parents: [p],
    dependents: new Set(),
    observers: new Set(),
    recompute: () => project(p.value as A),
    eq,
  }
  p.dependents.add(internal as InternalNode<unknown>)
  // Compute initial value eagerly so .value is correct without a stabilize
  // sweep just for construction.
  internal.value = (internal.recompute as () => B)()
  internal.dirty = false
  return makeHandle<B>(internal, () => {
    throw new Error("map node is not writable")
  }) as Node<B>
}

export function map2<A, B, C>(
  a: Node<A>,
  b: Node<B>,
  project: (a: A, b: B) => C,
  eq: (a: C, b: C) => boolean = defaultEq,
): Node<C> {
  const pa = a._internal as InternalNode<unknown>
  const pb = b._internal as InternalNode<unknown>
  const internal: InternalNode<C> = {
    id: nextId++,
    value: undefined as unknown as C,
    height: Math.max(pa.height, pb.height) + 1,
    stamp: 0,
    dirty: true,
    parents: [pa, pb],
    dependents: new Set(),
    observers: new Set(),
    recompute: () => project(pa.value as A, pb.value as B),
    eq,
  }
  pa.dependents.add(internal as InternalNode<unknown>)
  pb.dependents.add(internal as InternalNode<unknown>)
  internal.value = (internal.recompute as () => C)()
  internal.dirty = false
  return makeHandle<C>(internal, () => {
    throw new Error("map2 node is not writable")
  }) as Node<C>
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
 * Drain the dirty queue. Processes by ascending height so that by the time
 * a node recomputes, all parents it reads have settled. Observers for
 * value-changed nodes fire after the queue is empty.
 */
export function stabilize(): void {
  while (dirtyByHeight.size > 0) {
    const heights = Array.from(dirtyByHeight.keys()).sort((a, b) => a - b)
    const h = heights[0]!
    const bucket = dirtyByHeight.get(h)!
    dirtyByHeight.delete(h)
    for (const n of bucket) {
      if (!n.dirty) continue
      n.dirty = false
      const prev = n.value
      const next = n.recompute === null ? prev : n.recompute()
      if (!n.eq(prev as never, next as never)) {
        n.value = next
        n.stamp++
        markDependentsDirty(n)
        if (n.observers.size > 0) schedulePush(n, next)
      }
    }
  }
  flushNotifies()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function schedulePush(n: InternalNode<unknown>, value: unknown): void {
  for (const obs of n.observers) {
    pendingNotifies.push({ obs: obs as (value: unknown) => void, value })
  }
}

function flushNotifies(): void {
  if (pendingNotifies.length === 0) return
  const work = pendingNotifies
  pendingNotifies = []
  for (const { obs, value } of work) obs(value)
}

function makeHandle<T>(
  internal: InternalNode<T>,
  setter: (next: T) => void,
): Var<T> {
  return {
    get value() {
      return internal.value
    },
    set(next: T) {
      setter(next)
    },
    observe(observer: (value: T) => void): Unsubscribe {
      internal.observers.add(observer)
      return () => {
        internal.observers.delete(observer)
      }
    },
    _internal: internal,
  }
}

// ---------------------------------------------------------------------------
// Bridge to UpdateStream
// ---------------------------------------------------------------------------

import type { UpdateStream, Update, Observer, Unsubscribe as ObsUnsubscribe } from "./observable"

/**
 * Expose a Node<T> as an UpdateStream<T>. Each subscriber gets a reusable
 * `{prev, next}` object whose fields are mutated on each emission. This
 * matches the existing toUpdateStream contract — observers must consume
 * the update synchronously and not retain references.
 *
 * Used by program runners to back the existing view surface with the
 * Incremental graph without churning every constructor's attach signature.
 */
export function nodeToUpdateStream<T>(node: Node<T>): UpdateStream<T> {
  return {
    subscribe(observer: Observer<Update<T>>): ObsUnsubscribe {
      const update: { prev: T; next: T; delta: unknown | undefined } = {
        prev: node.value,
        next: node.value,
        delta: undefined,
      }
      return node.observe((value) => {
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
 * Unlink a derived node from its parents so it can be GC'd. Idempotent.
 * Vars do nothing — they have no parents to detach from.
 */
export function disposeNode<T>(node: Node<T>): void {
  const n = node._internal as InternalNode<unknown>
  if (n.parents !== null) {
    for (const p of n.parents) p.dependents.delete(n)
    n.parents = null
  }
  n.dependents.clear()
  n.observers.clear()
  n.recompute = null
}
