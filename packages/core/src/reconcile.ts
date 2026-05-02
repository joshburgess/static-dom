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

interface ItemEntry<ItemModel> {
  startMarker: Comment | null
  endMarker: Comment | null
  teardown: Teardown
  modelRef: { current: ItemModel }
  observer: Observer<Update<ItemModel>> | null
  observers: Set<Observer<Update<ItemModel>>> | null
  update: { prev: ItemModel; next: ItemModel }
}

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
  const itemFirstNodes = new Map<string, ChildNode>()

  /** Mount an item during initial render — no markers, no fragment. */
  function mountItemInitial(key: string, itemModel: ItemModel): void {
    const modelRef = { current: itemModel }
    const update = { prev: itemModel, next: itemModel }
    const entry: ItemEntry<ItemModel> = {
      startMarker: null, endMarker: null,
      teardown: { teardown() {} }, modelRef,
      observer: null, observers: null, update,
    }
    liveItems.set(key, entry)

    const lastBefore = container.lastChild

    currentMountEntry = entry
    entry.teardown = withDelegator(capturedDelegator, () =>
      guard("attach", `${label} item "${key}"`, () =>
        itemSdom.attach(container, itemModel, sharedUpdateStream, dispatch),
        { teardown() {} }
      )
    )
    currentMountEntry = null

    const firstNode = lastBefore ? lastBefore.nextSibling : container.firstChild
    if (firstNode) itemFirstNodes.set(key, firstNode)
  }

  /** Mount an item during reconciliation — with markers for reordering. */
  function mountItemFull(key: string, itemModel: ItemModel): void {
    const startMarker = document.createComment(`s:${key}`)
    const endMarker = document.createComment(`e:${key}`)

    const modelRef = { current: itemModel }
    const update = { prev: itemModel, next: itemModel }
    const entry: ItemEntry<ItemModel> = {
      startMarker, endMarker,
      teardown: { teardown() {} }, modelRef,
      observer: null, observers: null, update,
    }
    liveItems.set(key, entry)

    const frag = document.createDocumentFragment()
    frag.appendChild(startMarker)

    currentMountEntry = entry
    entry.teardown = withDelegator(capturedDelegator, () =>
      guard("attach", `${label} item "${key}"`, () =>
        itemSdom.attach(frag, itemModel, sharedUpdateStream, dispatch),
        { teardown() {} }
      )
    )
    currentMountEntry = null

    frag.appendChild(endMarker)
    container.appendChild(frag)
  }

  function pushItemUpdate(entry: ItemEntry<ItemModel>, prevModel: ItemModel, itemModel: ItemModel): void {
    entry.modelRef.current = itemModel
    entry.update.prev = prevModel
    entry.update.next = itemModel
    if (entry.observer) {
      entry.observer(entry.update)
    } else if (entry.observers) {
      entry.observers.forEach(obs => obs(entry.update))
    }
  }

  function ensureMarkers(): void {
    if (markersInserted) return
    markersInserted = true

    const entries = Array.from(liveItems.entries())
    for (const [key, entry] of entries) {
      if (entry.startMarker !== null) continue
      const firstNode = itemFirstNodes.get(key)
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

    itemFirstNodes.clear()
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
    entry.teardown.teardown()
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
    // --- Initial mount: no markers, no reconciliation ---
    if (isFirstSync) {
      isFirstSync = false
      const keys = new Array<string>(count)
      for (let i = 0; i < count; i++) {
        const key = keyAt(i)
        keys[i] = key
        mountItemInitial(key, modelAt(i))
      }
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
    if (prevKeys !== null && count === prevKeys.length) {
      let sameStructure = true
      for (let i = 0; i < count; i++) {
        if (keyAt(i) !== prevKeys[i]) {
          sameStructure = false
          break
        }
      }
      if (sameStructure) {
        for (let i = 0; i < count; i++) {
          const entry = liveItems.get(prevKeys[i]!)!
          const model = modelAt(i)
          if (entry.modelRef.current !== model) {
            pushItemUpdate(entry, entry.modelRef.current, model)
          }
        }
        // prevKeys unchanged
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
          if (entry.modelRef.current !== model) {
            pushItemUpdate(entry, entry.modelRef.current, model)
          }
        }
        ensureMarkers()
        const newKeys = new Array<string>(count)
        for (let i = 0; i < prevKeys.length; i++) newKeys[i] = prevKeys[i]!
        for (let i = prevKeys.length; i < count; i++) {
          const key = keyAt(i)
          newKeys[i] = key
          mountItemFull(key, modelAt(i))
        }
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
      for (const { teardown: td } of liveItems.values()) td.teardown()
      liveItems.clear()
      markersInserted = false
      itemFirstNodes.clear()
      prevKeys = []
      return
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
        for (const { teardown: td } of liveItems.values()) td.teardown()
        liveItems.clear()
        markersInserted = false
        itemFirstNodes.clear()
        for (let i = 0; i < count; i++) {
          mountItemInitial(nextKeys[i]!, modelAt(i))
        }
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
      } else if (entry.modelRef.current !== model) {
        pushItemUpdate(entry, entry.modelRef.current, model)
      }
    }

    // Reorder using LIS for minimum DOM moves
    reorder(count, i => nextKeys[i]!, nextByKey)

    prevKeys = nextKeys
  }

  function teardown(): void {
    for (const { teardown: td, startMarker, endMarker } of liveItems.values()) {
      td.teardown()
      startMarker?.remove()
      endMarker?.remove()
    }
    container.remove()
  }

  return { sync, teardown }
}
 void {
    for (const { teardown: td, startMarker, endMarker } of liveItems.values()) {
      td.teardown()
      startMarker?.remove()
      endMarker?.remove()
    }
    container.remove()
  }

  return { sync, teardown }
}
