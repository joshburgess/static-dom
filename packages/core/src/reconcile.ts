/**
 * reconcile.ts — Keyed array reconciliation engine.
 *
 * Extracted from array()/arrayBy() to eliminate duplication and make
 * each fast path independently testable. The reconciler manages a keyed
 * list of DOM items with comment markers for O(1) moves.
 *
 * Fast paths (checked in order):
 *   1. Same-structure: keys match in order → update-only, no Map/LIS
 *   2. Append-only: existing keys are a prefix → mount the tail
 *   3. Clear-all: new list is empty → bulk teardown
 *   4. Full-replacement: zero key overlap → bulk clear + fresh mount
 *   5. General: remove stale, mount new, LIS-based minimum DOM moves
 *
 * The LIS (Longest Increasing Subsequence) algorithm from Inferno minimizes
 * DOM moves by finding the largest set of items already in correct order.
 */

import type { SDOM, Teardown } from "./types"
import type { Observer, Update, UpdateStream, Dispatcher } from "./observable"
import { guard, __SDOM_GUARD__, getErrorHandler } from "./errors"
import { __SDOM_DEV__, validateUniqueKeys } from "./dev"
import { getCurrentDelegator, withDelegator } from "./delegation"
import {
  __SDOM_COMPILED_SETUP__,
  __SDOM_COMPILED_STATE__,
  type CompiledSetup,
  type CompiledStateSpec,
} from "./constructors"

// ---------------------------------------------------------------------------
// LIS — Longest Increasing Subsequence (from Inferno)
//
// Time: O(n log n)  Space: O(n)
// ---------------------------------------------------------------------------

/**
 * Compute the longest increasing subsequence of `arr`.
 * Returns indices into `arr` that form the LIS, in order.
 */
export function lis(arr: number[]): number[] {
  const n = arr.length
  if (n === 0) return []

  // tails[i] = smallest value ending an IS of length i+1
  const tails: number[] = []
  // tailIdx[i] = index in arr where tails[i] lives
  const tailIdx: number[] = []
  // prev[i] = predecessor index in the LIS chain for arr[i]
  const prev = new Int32Array(n).fill(-1)

  for (let i = 0; i < n; i++) {
    const val = arr[i]!
    // Binary search: leftmost position in tails >= val
    let lo = 0, hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tails[mid]! < val) lo = mid + 1
      else hi = mid
    }

    tails[lo] = val
    tailIdx[lo] = i
    prev[i] = lo > 0 ? tailIdx[lo - 1]! : -1
  }

  // Reconstruct: walk backwards from the tail of the longest chain
  const result = new Array<number>(tails.length)
  let k = tailIdx[tails.length - 1]!
  for (let i = tails.length - 1; i >= 0; i--) {
    result[i] = k
    k = prev[k]!
  }

  return result
}

// ---------------------------------------------------------------------------
// ItemEntry — per-item state tracked by the reconciler
// ---------------------------------------------------------------------------

// prev/next live directly on the entry rather than on a nested update object,
// and firstNode is stored here too instead of a sibling Map. Both shave one
// allocation per row off the bulk mount path. The entry is structurally
// compatible with Update<ItemModel> so it doubles as the observer payload.
//
// The compiled-path discriminator (which update/teardown function to call)
// lives at the closure level — every entry under a given reconciler walks
// the same code path, so storing it per row is pure waste. `state` carries
// the per-row state for compiledState()-mounted rows; the shared update +
// teardown functions are read off the closure.
interface ItemEntry<ItemModel> {
  startMarker: Comment | null
  endMarker: Comment | null
  teardown: Teardown
  observer: Observer<Update<ItemModel>> | null
  observers: Set<Observer<Update<ItemModel>>> | null
  prev: ItemModel
  next: ItemModel
  firstNode: ChildNode | null
  /**
   * Direct (prev, next) update path used when the item SDOM was produced by
   * `compiled()` — mirrors the `update` half of the instance returned by the
   * brand-stashed setup. Null on every other path.
   */
  directUpdate: ((prev: ItemModel, next: ItemModel) => void) | null
  /**
   * State-based compiled path: per-row state object created by
   * `compiledState()`'s setup. The shared module-scope update + teardown
   * functions read/write through it.
   */
  state: object | null
}

const NOOP_TEARDOWN: Teardown = { teardown() {} }

// ---------------------------------------------------------------------------
// createArrayReconciler — factory for keyed array reconciliation
// ---------------------------------------------------------------------------

export interface ArrayReconciler<ItemModel> {
  /**
   * Sync the live DOM items with a new list.
   * On the first call, mounts all items without markers (fast initial render).
   * On subsequent calls, uses fast paths and LIS-based reordering.
   *
   * @param count   Number of items in the new list.
   * @param keyAt   Extract key for item at index i.
   * @param modelAt Extract model for item at index i.
   */
  sync(
    count: number,
    keyAt: (i: number) => string,
    modelAt: (i: number) => ItemModel,
  ): void

  /** Tear down all items and remove the container. */
  teardown(): void
}

export function createArrayReconciler<ItemModel, Msg>(
  container: HTMLElement,
  itemSdom: SDOM<ItemModel, Msg>,
  dispatch: Dispatcher<Msg>,
  label: string,
): ArrayReconciler<ItemModel> {
  // Capture the ambient delegator at factory time so per-item mounts that
  // happen later (after program() returns) still register through the
  // program's root listener.
  const capturedDelegator = getCurrentDelegator()
  const liveItems = new Map<string, ItemEntry<ItemModel>>()

  // Detect compiled() at factory time: when the item SDOM carries the
  // `__SDOM_COMPILED_SETUP__` brand we can drive each row through the
  // bare setup function and skip the per-row subscribe / unsub / wrapper
  // Teardown allocations that compiled()'s own attach would do.
  const compiledSetup =
    (itemSdom as unknown as { [__SDOM_COMPILED_SETUP__]?: CompiledSetup<ItemModel, Msg> })[
      __SDOM_COMPILED_SETUP__
    ] ?? null

  // State-based variant: setup writes into a pre-allocated state object and
  // the shared update + teardown functions read it. Trades the per-row
  // instance literal + two method closures for a single state object.
  const compiledStateSpec =
    (itemSdom as unknown as {
      [__SDOM_COMPILED_STATE__]?: CompiledStateSpec<ItemModel, Msg, object>
    })[__SDOM_COMPILED_STATE__] ?? null

  // Pre-extract the shared functions once. Hot paths read these directly
  // off the closure instead of indirecting through entry fields.
  const compiledStateSetup = compiledStateSpec ? compiledStateSpec.setup : null
  const compiledStateUpdate = compiledStateSpec ? compiledStateSpec.update : null
  const compiledStateTeardown = compiledStateSpec ? compiledStateSpec.teardown : null

  // Shared UpdateStream — avoids per-row function object allocation.
  let currentMountEntry: ItemEntry<ItemModel> | null = null
  const sharedUpdateStream: UpdateStream<ItemModel> = {
    subscribe(observer) {
      const entry = currentMountEntry!
      if (entry.observer === null && entry.observers === null) {
        entry.observer = observer
      } else {
        if (entry.observers === null) {
          entry.observers = new Set()
          if (entry.observer) {
            entry.observers.add(entry.observer)
            entry.observer = null
          }
        }
        entry.observers.add(observer)
      }
      return () => {
        if (entry.observer === observer) {
          entry.observer = null
        } else if (entry.observers) {
          entry.observers.delete(observer)
        }
      }
    },
  }

  // --- Lazy marker insertion ---
  let markersInserted = false

  /** Mount an item during initial render — no markers, appends to `target`.
   *  `target` is the container itself for one-off mounts, or a temporary
   *  DocumentFragment when the caller is bulk-mounting and will flush the
   *  fragment to the container at the end.
   *
   *  The caller is responsible for installing `capturedDelegator` as the
   *  ambient delegator before invoking this in a bulk loop — withDelegator
   *  is hoisted up so 10k mounts share one push/pop instead of 10k. */
  function mountItemInitial(
    target: Element | DocumentFragment,
    key: string,
    itemModel: ItemModel,
  ): void {
    const entry: ItemEntry<ItemModel> = {
      startMarker: null, endMarker: null,
      teardown: NOOP_TEARDOWN,
      observer: null, observers: null,
      prev: itemModel, next: itemModel,
      firstNode: null,
      directUpdate: null,
      state: null,
    }
    liveItems.set(key, entry)

    const lastBefore = target.lastChild

    if (compiledStateSetup !== null) {
      // Fast path: setup returns a single per-row state object. The shared
      // (module-scope) update + teardown functions are kept on the closure
      // and read directly when needed.
      const state = guard(
        "attach",
        `${label} item "${key}"`,
        () => compiledStateSetup(target, itemModel, dispatch),
        null as unknown as object,
      )
      if (state !== null) entry.state = state
    } else if (compiledSetup !== null) {
      // Legacy compiled() fast path: invoke the user setup directly. It
      // returns `{update, teardown}`, which already satisfies the Teardown
      // protocol, so we reuse the instance object as `entry.teardown`
      // instead of allocating a wrapper.
      const instance = guard(
        "attach",
        `${label} item "${key}"`,
        () => compiledSetup(target, itemModel, dispatch),
        null as unknown as { update: (p: ItemModel, n: ItemModel) => void; teardown: () => void },
      )
      if (instance !== null) {
        entry.teardown = instance
        entry.directUpdate = instance.update
      }
    } else {
      currentMountEntry = entry
      entry.teardown = guard("attach", `${label} item "${key}"`, () =>
        itemSdom.attach(target, itemModel, sharedUpdateStream, dispatch),
        NOOP_TEARDOWN,
      )
      currentMountEntry = null
    }

    entry.firstNode = lastBefore ? lastBefore.nextSibling : target.firstChild
  }

  /** Mount an item during reconciliation — with markers for reordering. */
  function mountItemFull(key: string, itemModel: ItemModel): void {
    const startMarker = document.createComment(`s:${key}`)
    const endMarker = document.createComment(`e:${key}`)

    const entry: ItemEntry<ItemModel> = {
      startMarker, endMarker,
      teardown: NOOP_TEARDOWN,
      observer: null, observers: null,
      prev: itemModel, next: itemModel,
      firstNode: null,
      directUpdate: null,
      state: null,
    }
    liveItems.set(key, entry)

    container.appendChild(startMarker)

    if (compiledStateSetup !== null) {
      const state = withDelegator(capturedDelegator, () =>
        guard(
          "attach",
          `${label} item "${key}"`,
          () => compiledStateSetup(container, itemModel, dispatch),
          null as unknown as object,
        ),
      )
      if (state !== null) entry.state = state
    } else if (compiledSetup !== null) {
      const instance = withDelegator(capturedDelegator, () =>
        guard(
          "attach",
          `${label} item "${key}"`,
          () => compiledSetup(container, itemModel, dispatch),
          null as unknown as { update: (p: ItemModel, n: ItemModel) => void; teardown: () => void },
        ),
      )
      if (instance !== null) {
        entry.teardown = instance
        entry.directUpdate = instance.update
      }
    } else {
      currentMountEntry = entry
      entry.teardown = withDelegator(capturedDelegator, () =>
        guard("attach", `${label} item "${key}"`, () =>
          itemSdom.attach(container, itemModel, sharedUpdateStream, dispatch),
          NOOP_TEARDOWN,
        )
      )
      currentMountEntry = null
    }

    container.appendChild(endMarker)
  }

  function pushItemUpdate(entry: ItemEntry<ItemModel>, itemModel: ItemModel): void {
    const prev = entry.next
    entry.prev = prev
    entry.next = itemModel
    if (compiledStateUpdate !== null) {
      compiledStateUpdate(entry.state!, prev, itemModel)
      return
    }
    const directUpdate = entry.directUpdate
    if (directUpdate !== null) {
      directUpdate(prev, itemModel)
      return
    }
    const update = entry as unknown as Update<ItemModel>
    if (entry.observer) {
      entry.observer(update)
    } else if (entry.observers) {
      entry.observers.forEach(obs => obs(update))
    }
  }

  function teardownEntry(entry: ItemEntry<ItemModel>): void {
    if (compiledStateTeardown !== null) compiledStateTeardown(entry.state!)
    else entry.teardown.teardown()
  }

  function ensureMarkers(): void {
    if (markersInserted) return
    markersInserted = true

    const entries = Array.from(liveItems.entries())
    for (const [key, entry] of entries) {
      if (entry.startMarker !== null) continue
      const firstNode = entry.firstNode
      if (!firstNode) continue
      const start = document.createComment(`s:${key}`)
      entry.startMarker = start
      container.insertBefore(start, firstNode)
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]![1]
      if (entry.endMarker !== null) continue
      const end = document.createComment(`e:${entries[i]![0]}`)
      entry.endMarker = end
      const nextEntry = i + 1 < entries.length ? entries[i + 1]![1] : null
      const ref = nextEntry?.startMarker ?? null
      container.insertBefore(end, ref)
    }

    // firstNode references are no longer needed; drop them so GC can reclaim
    // text/element nodes if the user later replaces them out-of-band.
    for (const [, entry] of entries) entry.firstNode = null
  }

  /** Move all nodes in [startMarker..endMarker] before `ref`. */
  function moveItemBefore(entry: ItemEntry<ItemModel>, ref: ChildNode | null): void {
    let node: ChildNode | null = entry.startMarker!
    const end = entry.endMarker!
    while (node !== null) {
      const next: ChildNode | null = node.nextSibling
      container.insertBefore(node, ref)
      if (node === end) break
      node = next
    }
  }

  /** Remove an item: teardown (removes content nodes) + remove markers. */
  function removeItem(key: string): void {
    const entry = liveItems.get(key)
    if (!entry) return
    teardownEntry(entry)
    entry.startMarker?.remove()
    entry.endMarker?.remove()
    liveItems.delete(key)
  }

  /** LIS-based reorder for minimum DOM moves. */
  function reorder(
    count: number,
    keyAt: (i: number) => string,
    nextByKey: Map<string, ItemModel>,
  ): void {
    // oldPos must reflect current DOM order. prevKeys carries the order
    // produced by the previous sync; liveItems iteration is insertion order
    // and goes stale after any reorder. New items mounted during this sync
    // are not in prevKeys but live at the end of the container, so we tack
    // them on in liveItems order.
    const oldPos = new Map<string, number>()
    let posIdx = 0
    if (prevKeys !== null) {
      for (let i = 0; i < prevKeys.length; i++) {
        const key = prevKeys[i]!
        if (nextByKey.has(key) && liveItems.has(key)) {
          oldPos.set(key, posIdx++)
        }
      }
    }
    for (const [key] of liveItems) {
      if (!oldPos.has(key) && nextByKey.has(key)) {
        oldPos.set(key, posIdx++)
      }
    }

    const positions: number[] = []
    const posKeys: string[] = []
    for (let i = 0; i < count; i++) {
      const key = keyAt(i)
      const p = oldPos.get(key)
      if (p !== undefined) {
        positions.push(p)
        posKeys.push(key)
      }
    }

    if (positions.length > 0) {
      const lisResult = lis(positions)
      const lisSet = new Set<number>()
      for (const idx of lisResult) lisSet.add(idx)

      let lastPlaced: ChildNode | null = null
      let seqIdx = posKeys.length - 1
      for (let i = count - 1; i >= 0; i--) {
        const key = keyAt(i)
        const entry = liveItems.get(key)!
        if (seqIdx >= 0 && key === posKeys[seqIdx]) {
          if (!lisSet.has(seqIdx)) {
            moveItemBefore(entry, lastPlaced)
          }
          seqIdx--
        } else {
          moveItemBefore(entry, lastPlaced)
        }
        lastPlaced = entry.startMarker
      }
    }
  }

  // --- Key cache for fast-path detection ---
  let prevKeys: string[] | null = null
  let isFirstSync = true

  function sync(
    count: number,
    keyAt: (i: number) => string,
    modelAt: (i: number) => ItemModel,
  ): void {
    // --- Bulk mount from empty: no markers, no reconciliation ---
    // Build into a DocumentFragment first so the N row insertions collapse
    // into a single live-DOM append at the end. Hits on first sync, on the
    // sync after clear/full-replacement, and on the first non-empty sync
    // after an initial empty sync — i.e., the common 1k/10k create flow.
    if (liveItems.size === 0) {
      isFirstSync = false
      markersInserted = false
      if (count === 0) {
        prevKeys = []
        return
      }
      const keys = new Array<string>(count)
      const frag = document.createDocumentFragment()
      withDelegator(capturedDelegator, () => {
        for (let i = 0; i < count; i++) {
          const key = keyAt(i)
          keys[i] = key
          mountItemInitial(frag, key, modelAt(i))
        }
      })
      container.appendChild(frag)
      prevKeys = keys
      return
    }

    // --- Dev mode: validate unique keys ---
    if (__SDOM_DEV__) {
      const devKeys = new Array<string>(count)
      for (let i = 0; i < count; i++) devKeys[i] = keyAt(i)
      validateUniqueKeys(devKeys, label)
    }

    // --- Fast path: same keys, same order → update-only ---
    // Also detects 2-item swap with unchanged interior in a single scan,
    // skipping nextByKey/oldPos/LIS for the krausest swap1k pattern.
    if (prevKeys !== null && count === prevKeys.length) {
      let diffCount = 0
      let firstDiff = -1
      let lastDiff = -1
      for (let i = 0; i < count; i++) {
        if (keyAt(i) !== prevKeys[i]) {
          diffCount++
          if (diffCount === 1) firstDiff = i
          else if (diffCount === 2) lastDiff = i
          else break
        }
      }
      if (diffCount === 0) {
        // sameStructure — update-only
        for (let i = 0; i < count; i++) {
          const entry = liveItems.get(prevKeys[i]!)!
          const model = modelAt(i)
          if (entry.next !== model) {
            pushItemUpdate(entry, model)
          }
        }
        return
      }

      // 2-item swap fast path: exactly two positions differ and they're
      // a transposition.
      if (
        diffCount === 2 &&
        keyAt(firstDiff) === prevKeys[lastDiff] &&
        keyAt(lastDiff) === prevKeys[firstDiff]
      ) {
        ensureMarkers()
        const entryA = liveItems.get(prevKeys[firstDiff]!)!
        const entryB = liveItems.get(prevKeys[lastDiff]!)!
        // Capture insertion refs before either move runs.
        const afterA = entryA.endMarker!.nextSibling
        const afterB = entryB.endMarker!.nextSibling
        moveItemBefore(entryA, afterB)
        moveItemBefore(entryB, afterA)

        const newKeys = prevKeys.slice()
        newKeys[firstDiff] = prevKeys[lastDiff]!
        newKeys[lastDiff] = prevKeys[firstDiff]!

        // Push model updates for any rows whose model identity changed.
        for (let i = 0; i < count; i++) {
          const entry = liveItems.get(newKeys[i]!)!
          const model = modelAt(i)
          if (entry.next !== model) {
            pushItemUpdate(entry, model)
          }
        }
        prevKeys = newKeys
        return
      }
    }

    // --- Fast path: append-only ---
    if (prevKeys !== null && count > prevKeys.length) {
      let isAppend = true
      for (let i = 0; i < prevKeys.length; i++) {
        if (keyAt(i) !== prevKeys[i]) {
          isAppend = false
          break
        }
      }
      if (isAppend) {
        for (let i = 0; i < prevKeys.length; i++) {
          const entry = liveItems.get(prevKeys[i]!)!
          const model = modelAt(i)
          if (entry.next !== model) {
            pushItemUpdate(entry, model)
          }
        }
        // No ensureMarkers here. Append doesn't move anything, so markers
        // stay deferred until a swap/reorder/insert actually needs them.
        // Mount new items into a fragment via the marker-less initial path
        // and flush in one live append.
        const newKeys = new Array<string>(count)
        for (let i = 0; i < prevKeys.length; i++) newKeys[i] = prevKeys[i]!
        const frag = document.createDocumentFragment()
        const prevLen = prevKeys.length
        withDelegator(capturedDelegator, () => {
          for (let i = prevLen; i < count; i++) {
            const key = keyAt(i)
            newKeys[i] = key
            mountItemInitial(frag, key, modelAt(i))
          }
        })
        container.appendChild(frag)
        prevKeys = newKeys
        return
      }
    }

    // --- Fast path: clear all ---
    // Wipe the DOM first so per-item teardowns find their nodes already
    // detached: el.remove() becomes a no-op, and 1000 individual removes
    // collapse into one textContent="" wipe.
    if (count === 0 && liveItems.size > 0) {
      container.textContent = ""
      for (const entry of liveItems.values()) teardownEntry(entry)
      liveItems.clear()
      markersInserted = false
      prevKeys = []
      return
    }

    // --- Prefix/suffix walks for pure removal or pure insertion ---
    // After matching equal keys at the head and tail, if the middle is
    // empty in either direction we can skip nextByKey + LIS entirely.
    // Targets remove-one (pure removal) and insert-in-middle patterns.
    if (prevKeys !== null && liveItems.size > 0) {
      const oldLen = prevKeys.length
      const limit = oldLen < count ? oldLen : count

      let prefixLen = 0
      while (prefixLen < limit && prevKeys[prefixLen] === keyAt(prefixLen)) {
        prefixLen++
      }

      let oldEnd = oldLen - 1
      let newEnd = count - 1
      while (
        oldEnd >= prefixLen &&
        newEnd >= prefixLen &&
        prevKeys[oldEnd] === keyAt(newEnd)
      ) {
        oldEnd--
        newEnd--
      }

      // Pure removal: new is fully consumed by prefix + suffix
      if (newEnd < prefixLen && oldEnd >= prefixLen) {
        for (let i = 0; i < prefixLen; i++) {
          const entry = liveItems.get(prevKeys[i]!)!
          const model = modelAt(i)
          if (entry.next !== model) {
            pushItemUpdate(entry, model)
          }
        }
        for (let i = oldEnd + 1; i < oldLen; i++) {
          const entry = liveItems.get(prevKeys[i]!)!
          const model = modelAt(prefixLen + (i - oldEnd - 1))
          if (entry.next !== model) {
            pushItemUpdate(entry, model)
          }
        }
        ensureMarkers()
        for (let i = prefixLen; i <= oldEnd; i++) {
          removeItem(prevKeys[i]!)
        }
        const newKeys = new Array<string>(count)
        for (let i = 0; i < prefixLen; i++) newKeys[i] = prevKeys[i]!
        for (let i = oldEnd + 1; i < oldLen; i++) {
          newKeys[prefixLen + (i - oldEnd - 1)] = prevKeys[i]!
        }
        prevKeys = newKeys
        return
      }

      // Pure insertion: old is fully consumed by prefix + suffix
      if (oldEnd < prefixLen && newEnd >= prefixLen) {
        for (let i = 0; i < prefixLen; i++) {
          const entry = liveItems.get(prevKeys[i]!)!
          const model = modelAt(i)
          if (entry.next !== model) {
            pushItemUpdate(entry, model)
          }
        }
        const suffixStart = oldEnd + 1
        for (let i = suffixStart; i < oldLen; i++) {
          const entry = liveItems.get(prevKeys[i]!)!
          const newIdx = newEnd + 1 + (i - suffixStart)
          const model = modelAt(newIdx)
          if (entry.next !== model) {
            pushItemUpdate(entry, model)
          }
        }
        ensureMarkers()
        const refKey = suffixStart < oldLen ? prevKeys[suffixStart]! : null
        const refNode = refKey ? liveItems.get(refKey)!.startMarker : null
        const newKeys = new Array<string>(count)
        for (let i = 0; i < prefixLen; i++) newKeys[i] = prevKeys[i]!
        for (let i = prefixLen; i <= newEnd; i++) {
          const key = keyAt(i)
          newKeys[i] = key
          mountItemFull(key, modelAt(i))
        }
        // Move freshly-mounted items from the end of the container into
        // place. insertBefore the same refNode in order — each move slots
        // the next item directly after the previous one.
        for (let i = prefixLen; i <= newEnd; i++) {
          moveItemBefore(liveItems.get(newKeys[i]!)!, refNode)
        }
        for (let i = suffixStart; i < oldLen; i++) {
          newKeys[newEnd + 1 + (i - suffixStart)] = prevKeys[i]!
        }
        prevKeys = newKeys
        return
      }
    }

    // Build key→model map for full reconciliation
    const nextByKey = new Map<string, ItemModel>()
    const nextKeys = new Array<string>(count)
    for (let i = 0; i < count; i++) {
      const key = keyAt(i)
      nextKeys[i] = key
      nextByKey.set(key, modelAt(i))
    }

    // --- Fast path: full replacement (zero key overlap) ---
    if (liveItems.size > 0 && count > 0) {
      let noOverlap = true
      for (const [key] of liveItems) {
        if (nextByKey.has(key)) { noOverlap = false; break }
      }
      if (noOverlap) {
        container.textContent = ""
        for (const entry of liveItems.values()) teardownEntry(entry)
        liveItems.clear()
        markersInserted = false
        const frag = document.createDocumentFragment()
        withDelegator(capturedDelegator, () => {
          for (let i = 0; i < count; i++) {
            mountItemInitial(frag, nextKeys[i]!, modelAt(i))
          }
        })
        container.appendChild(frag)
        prevKeys = nextKeys
        return
      }
    }

    // --- General reconciliation ---
    ensureMarkers()

    // Remove items no longer present
    for (const [key] of liveItems) {
      if (!nextByKey.has(key)) removeItem(key)
    }

    // Mount new + update existing
    for (let i = 0; i < count; i++) {
      const key = nextKeys[i]!
      const model = modelAt(i)
      const entry = liveItems.get(key)
      if (!entry) {
        mountItemFull(key, model)
      } else if (entry.next !== model) {
        pushItemUpdate(entry, model)
      }
    }

    // Reorder using LIS for minimum DOM moves
    reorder(count, i => nextKeys[i]!, nextByKey)

    prevKeys = nextKeys
  }

  function teardown(): void {
    for (const entry of liveItems.values()) {
      teardownEntry(entry)
      entry.startMarker?.remove()
      entry.endMarker?.remove()
    }
    container.remove()
  }

  return { sync, teardown }
}
