/**
 * incremental.ts — Incremental SDOM constructors.
 *
 * These constructors consume structured deltas for O(k) updates
 * instead of diffing entire data structures on every model change.
 *
 * The key export is `incrementalArray`, which replaces the standard
 * `array` when you can provide keyed array deltas from your update
 * function. When deltas aren't available, it falls back to the
 * standard diff-based reconciliation.
 *
 * ─────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────
 *
 * @example
 * ```typescript
 * import { incrementalArray } from "@sdom/core/incremental"
 * import { keyedOps, keyedInsert, keyedRemove, keyedPatch } from "@sdom/core/patch"
 *
 * // The model carries optional pending patches
 * interface Model {
 *   items: Item[]
 *   _itemOps?: KeyedArrayDelta<Item>
 * }
 *
 * const view = incrementalArray(
 *   "ul",
 *   m => m.items.map(t => ({ key: t.id, model: t })),
 *   m => m._itemOps ?? null,  // extract delta if available
 *   todoItem
 * )
 *
 * // In update, provide deltas for O(1) DOM updates:
 * function update(msg: Msg, model: Model): Model {
 *   switch (msg.type) {
 *     case "addTodo":
 *       const item = { id: uuid(), text: model.input, done: false }
 *       return {
 *         ...model,
 *         items: [...model.items, item],
 *         _itemOps: keyedOps(keyedInsert(item.id, item)),
 *       }
 *     case "removeTodo":
 *       return {
 *         ...model,
 *         items: model.items.filter(t => t.id !== msg.id),
 *         _itemOps: keyedOps(keyedRemove(msg.id)),
 *       }
 *   }
 * }
 * ```
 */

import { makeSDOM, type SDOM, type Teardown, type KeyedItem } from "./types"
import type { Observer, Update, UpdateStream, Dispatcher } from "./observable"
import type { KeyedArrayDelta, KeyedOp } from "./patch"
import { lis } from "./constructors"

// ---------------------------------------------------------------------------
// Fast-patch handler — allows programWithDelta to bypass subscription chain
// ---------------------------------------------------------------------------

/**
 * A handler that can process a single keyed patch directly, bypassing
 * the full subscription chain. Registered by `incrementalArray` and
 * consumed by `programWithDelta` for the common single-patch case.
 */
export type FastPatchHandler = (key: string, value: unknown) => boolean

/**
 * Slot for a fast-patch handler. When set, `programWithDelta` checks
 * single-patch deltas against this handler before going through the
 * full subscription chain.
 *
 * This is the mechanism that "flattens" the dispatch path:
 *   dispatch → extract delta → fastPatchHandler(key, value) → done
 * instead of:
 *   dispatch → observer → incrementalArray → isKeyedArrayDelta → applyKeyedOp → pushItemUpdate → item observer → attrUpdaters
 */
let _fastPatchHandler: FastPatchHandler | null = null

/** @internal Register the fast-patch handler. Returns unregister function. */
export function _registerFastPatch(handler: FastPatchHandler): () => void {
  _fastPatchHandler = handler
  return () => { if (_fastPatchHandler === handler) _fastPatchHandler = null }
}

/** @internal Try the fast-patch handler. Returns true if handled. */
export function _tryFastPatch(key: string, value: unknown): boolean {
  return _fastPatchHandler !== null && _fastPatchHandler(key, value)
}

/** Runtime check for KeyedArrayDelta shape (since delta comes as `unknown`). */
function isKeyedArrayDelta(v: unknown): v is KeyedArrayDelta<unknown> {
  if (v == null || typeof v !== "object") return false
  const d = v as { kind?: string }
  return d.kind === "ops" || d.kind === "noop" || d.kind === "replace"
}

/**
 * An incremental array that consumes keyed deltas for O(k) DOM updates.
 *
 * When `getDelta` returns a delta, the array applies individual
 * operations (insert, remove, move, patch) directly without scanning
 * the full list. When it returns null, falls back to full reconciliation.
 *
 * @param containerTag  Wrapper element tag (e.g. "ul", "div").
 * @param getItems      Project model to keyed items (same as `array`).
 * @param getDelta      Extract a keyed array delta from the next model,
 *                      or null to fall back to full diff. Optional — if
 *                      omitted, the array reads deltas from `Update.delta`
 *                      (set by `programWithDelta`).
 * @param itemSdom      The SDOM template for each item.
 */
export function incrementalArray<
  Model,
  ItemModel,
  Msg
>(
  containerTag: keyof HTMLElementTagNameMap,
  getItems: (model: Model) => KeyedItem<ItemModel>[],
  getDeltaOrSdom: ((next: Model) => KeyedArrayDelta<ItemModel> | null) | SDOM<ItemModel, Msg>,
  itemSdomOrUndefined?: SDOM<ItemModel, Msg>
): SDOM<Model, Msg> {
  // Overload: (tag, getItems, itemSdom) or (tag, getItems, getDelta, itemSdom)
  let getDelta: ((next: Model) => KeyedArrayDelta<ItemModel> | null) | null
  let itemSdom: SDOM<ItemModel, Msg>
  if (itemSdomOrUndefined !== undefined) {
    getDelta = getDeltaOrSdom as (next: Model) => KeyedArrayDelta<ItemModel> | null
    itemSdom = itemSdomOrUndefined
  } else {
    getDelta = null
    itemSdom = getDeltaOrSdom as SDOM<ItemModel, Msg>
  }
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const container = document.createElement(containerTag)
    parent.appendChild(container)

    // Live item tracking — comment markers instead of wrapper divs.
    // Single-observer fast path: first subscriber stored directly.
    type ItemEntry = {
      startMarker: Comment
      endMarker: Comment
      teardown: Teardown
      modelRef: { current: ItemModel }
      observer: Observer<Update<ItemModel>> | null
      observers: Set<Observer<Update<ItemModel>>> | null
      update: { prev: ItemModel; next: ItemModel; delta?: unknown }
    }
    const liveItems = new Map<string, ItemEntry>()

    // Ordered key list for position lookups
    let keyOrder: string[] = []

    function mountItem(key: string, itemModel: ItemModel): void {
      const startMarker = document.createComment(`s:${key}`)
      const endMarker = document.createComment(`e:${key}`)

      const modelRef = { current: itemModel }
      const update = { prev: itemModel, next: itemModel } as { prev: ItemModel; next: ItemModel; delta?: unknown }

      const entry: ItemEntry = {
        startMarker, endMarker, teardown: { teardown() {} }, modelRef,
        observer: null, observers: null, update,
      }
      liveItems.set(key, entry)

      const itemUpdates: UpdateStream<ItemModel> = {
        subscribe(obs) {
          if (entry.observer === null && entry.observers === null) {
            entry.observer = obs
          } else {
            if (entry.observers === null) {
              entry.observers = new Set()
              if (entry.observer) {
                entry.observers.add(entry.observer)
                entry.observer = null
              }
            }
            entry.observers.add(obs)
          }
          return () => {
            if (entry.observer === obs) {
              entry.observer = null
            } else if (entry.observers) {
              entry.observers.delete(obs)
            }
          }
        },
      }

      const frag = document.createDocumentFragment()
      frag.appendChild(startMarker)
      entry.teardown = itemSdom.attach(frag, itemModel, itemUpdates, dispatch)
      frag.appendChild(endMarker)
      container.appendChild(frag)
    }

    function unmountItem(key: string): void {
      const item = liveItems.get(key)
      if (!item) return
      item.teardown.teardown()
      item.startMarker.remove()
      item.endMarker.remove()
      liveItems.delete(key)
    }

    /** Move all nodes in [startMarker..endMarker] before `ref`. */
    function moveItemBefore(entry: ItemEntry, ref: ChildNode | null): void {
      let node: ChildNode | null = entry.startMarker
      const end = entry.endMarker
      while (node !== null) {
        const next: ChildNode | null = node.nextSibling
        container.insertBefore(node, ref)
        if (node === end) break
        node = next
      }
    }

    // Cache last-looked-up entry
    let lastKey: string | null = null
    let lastEntry: ItemEntry | null = null

    function pushItemUpdate(key: string, newModel: ItemModel): void {
      let item: ItemEntry | undefined
      if (key === lastKey && lastEntry !== null) {
        item = lastEntry
      } else {
        item = liveItems.get(key)
        if (!item) return
        lastKey = key
        lastEntry = item
      }
      const prev = item.modelRef.current
      if (prev !== newModel) {
        item.modelRef.current = newModel
        item.update.prev = prev
        item.update.next = newModel
        item.update.delta = undefined
        if (item.observer) {
          item.observer(item.update as Update<ItemModel>)
        } else if (item.observers) {
          item.observers.forEach(obs => obs(item.update as Update<ItemModel>))
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Incremental path: apply individual keyed operations
    // ─────────────────────────────────────────────────────────────────

    function applyKeyedOp(op: KeyedOp<ItemModel>): void {
      switch (op.kind) {
        case "insert": {
          mountItem(op.key, op.item)
          // mountItem appends to end; if `before` specified, move it
          if (op.before !== null) {
            const entry = liveItems.get(op.key)!
            const beforeItem = liveItems.get(op.before)
            if (beforeItem) {
              moveItemBefore(entry, beforeItem.startMarker)
              const idx = keyOrder.indexOf(op.before)
              keyOrder.splice(idx, 0, op.key)
              return
            }
          }
          keyOrder.push(op.key)
          break
        }

        case "remove": {
          unmountItem(op.key)
          const idx = keyOrder.indexOf(op.key)
          if (idx !== -1) keyOrder.splice(idx, 1)
          break
        }

        case "move": {
          const entry = liveItems.get(op.key)
          if (!entry) break
          const fromIdx = keyOrder.indexOf(op.key)
          if (fromIdx !== -1) keyOrder.splice(fromIdx, 1)

          if (op.before !== null) {
            const beforeItem = liveItems.get(op.before)
            if (beforeItem) {
              moveItemBefore(entry, beforeItem.startMarker)
              const toIdx = keyOrder.indexOf(op.before)
              keyOrder.splice(toIdx, 0, op.key)
              break
            }
          }
          // Move to end
          moveItemBefore(entry, null)
          keyOrder.push(op.key)
          break
        }

        case "patch": {
          pushItemUpdate(op.key, op.value)
          break
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Full reconciliation fallback (same as standard array)
    // ─────────────────────────────────────────────────────────────────

    function fullReconcile(_prev: Model, next: Model): void {
      const nextItems = getItems(next)

      const nextByKey = new Map<string, ItemModel>()
      for (const item of nextItems) nextByKey.set(item.key, item.model)

      // Remove
      for (const [key] of liveItems) {
        if (!nextByKey.has(key)) unmountItem(key)
      }

      // Mount new + update existing (use liveItems for prev model)
      for (const { key, model: itemModel } of nextItems) {
        if (!liveItems.has(key)) {
          mountItem(key, itemModel)
        } else {
          pushItemUpdate(key, itemModel)
        }
      }

      // Reorder using LIS for minimum DOM moves
      const oldKeySet = new Set(keyOrder)
      const newKeyOrder = nextItems.map(i => i.key)

      // Build old-position map for surviving items
      const oldPos = new Map<string, number>()
      for (let i = 0; i < keyOrder.length; i++) {
        if (nextByKey.has(keyOrder[i]!)) oldPos.set(keyOrder[i]!, i)
      }

      const positions: number[] = []
      const posKeys: string[] = []
      for (const key of newKeyOrder) {
        const p = oldPos.get(key)
        if (p !== undefined) { positions.push(p); posKeys.push(key) }
      }

      if (positions.length > 0) {
        const lisResult = lis(positions)
        const lisSet = new Set<number>()
        for (const idx of lisResult) lisSet.add(idx)

        let lastPlaced: ChildNode | null = null
        let seqIdx = posKeys.length - 1
        for (let i = newKeyOrder.length - 1; i >= 0; i--) {
          const entry = liveItems.get(newKeyOrder[i]!)!
          if (seqIdx >= 0 && newKeyOrder[i] === posKeys[seqIdx]) {
            if (!lisSet.has(seqIdx)) moveItemBefore(entry, lastPlaced)
            seqIdx--
          } else {
            moveItemBefore(entry, lastPlaced)
          }
          lastPlaced = entry.startMarker
        }
      }

      keyOrder = newKeyOrder
    }

    // ─────────────────────────────────────────────────────────────────
    // Initial mount + subscription
    // ─────────────────────────────────────────────────────────────────

    const initialItems = getItems(initialModel)
    for (const { key, model: itemModel } of initialItems) {
      mountItem(key, itemModel)
    }
    keyOrder = initialItems.map(i => i.key)

    // Register fast-patch handler — bypasses subscription chain entirely
    // for single keyedPatch operations (the most common incremental case).
    const unregisterFastPatch = _registerFastPatch((key, value) => {
      const entry = key === lastKey && lastEntry !== null ? lastEntry : liveItems.get(key)
      if (!entry) return false
      lastKey = key
      lastEntry = entry
      const prev = entry.modelRef.current
      const newModel = value as ItemModel
      if (prev !== newModel) {
        entry.modelRef.current = newModel
        entry.update.prev = prev
        entry.update.next = newModel
        entry.update.delta = undefined
        if (entry.observer) {
          entry.observer(entry.update as Update<ItemModel>)
        } else if (entry.observers) {
          entry.observers.forEach(obs => obs(entry.update as Update<ItemModel>))
        }
      }
      return true
    })

    const unsub = updates.subscribe(({ prev, next, delta: streamDelta }) => {
      const rawDelta = streamDelta ?? (getDelta ? getDelta(next) : null)
      const delta = isKeyedArrayDelta(rawDelta) ? rawDelta as KeyedArrayDelta<ItemModel> : null

      if (delta !== null && delta.kind === "ops") {
        for (const op of delta.ops) {
          applyKeyedOp(op)
        }
      } else if (delta !== null && delta.kind === "replace") {
        for (const key of [...liveItems.keys()]) unmountItem(key)
        keyOrder = []
        fullReconcile(prev, next)
      } else {
        fullReconcile(prev, next)
      }
    })

    return {
      teardown() {
        unregisterFastPatch()
        unsub()
        for (const { teardown: td, startMarker, endMarker } of liveItems.values()) {
          td.teardown()
          startMarker.remove()
          endMarker.remove()
        }
        container.remove()
      },
    }
  })
}
