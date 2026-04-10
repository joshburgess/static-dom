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
 *                      or null to fall back to full diff.
 * @param itemSdom      The SDOM template for each item.
 */
export function incrementalArray<
  Model,
  ItemModel,
  Msg
>(
  containerTag: keyof HTMLElementTagNameMap,
  getItems: (model: Model) => KeyedItem<ItemModel>[],
  getDelta: (next: Model) => KeyedArrayDelta<ItemModel> | null,
  itemSdom: SDOM<ItemModel, Msg>
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const container = document.createElement(containerTag)
    parent.appendChild(container)

    // Live item tracking
    const liveItems = new Map<string, {
      wrapper: HTMLElement
      teardown: Teardown
      modelRef: { current: ItemModel }
      observers: Set<Observer<Update<ItemModel>>>
    }>()

    // Ordered key list for position lookups
    let keyOrder: string[] = []

    function mountItem(key: string, itemModel: ItemModel): HTMLElement {
      const wrapper = document.createElement("div")
      wrapper.dataset["sdKey"] = key

      const modelRef = { current: itemModel }
      const observers = new Set<Observer<Update<ItemModel>>>()

      const itemUpdates: UpdateStream<ItemModel> = {
        subscribe(observer) {
          observers.add(observer)
          return () => { observers.delete(observer) }
        },
      }

      const td = itemSdom.attach(wrapper, itemModel, itemUpdates, dispatch)
      liveItems.set(key, { wrapper, teardown: td, modelRef, observers })
      return wrapper
    }

    function unmountItem(key: string): void {
      const item = liveItems.get(key)
      if (!item) return
      item.teardown.teardown()
      item.wrapper.remove()
      liveItems.delete(key)
    }

    function pushItemUpdate(key: string, newModel: ItemModel): void {
      const item = liveItems.get(key)
      if (!item) return
      const prev = item.modelRef.current
      if (prev !== newModel) {
        item.modelRef.current = newModel
        const update = { prev, next: newModel }
        item.observers.forEach(obs => obs(update))
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Incremental path: apply individual keyed operations
    // ─────────────────────────────────────────────────────────────────

    function applyKeyedOp(op: KeyedOp<ItemModel>): void {
      switch (op.kind) {
        case "insert": {
          const wrapper = mountItem(op.key, op.item)
          if (op.before !== null) {
            const beforeItem = liveItems.get(op.before)
            if (beforeItem) {
              container.insertBefore(wrapper, beforeItem.wrapper)
              const idx = keyOrder.indexOf(op.before)
              keyOrder.splice(idx, 0, op.key)
              return
            }
          }
          // Append to end
          container.appendChild(wrapper)
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
          const item = liveItems.get(op.key)
          if (!item) break
          // Remove from current position
          const fromIdx = keyOrder.indexOf(op.key)
          if (fromIdx !== -1) keyOrder.splice(fromIdx, 1)

          if (op.before !== null) {
            const beforeItem = liveItems.get(op.before)
            if (beforeItem) {
              container.insertBefore(item.wrapper, beforeItem.wrapper)
              const toIdx = keyOrder.indexOf(op.before)
              keyOrder.splice(toIdx, 0, op.key)
              break
            }
          }
          // Move to end
          container.appendChild(item.wrapper)
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

    function fullReconcile(prev: Model, next: Model): void {
      const prevItems = getItems(prev)
      const nextItems = getItems(next)

      const prevByKey = new Map<string, ItemModel>()
      for (const item of prevItems) prevByKey.set(item.key, item.model)

      const nextByKey = new Map<string, ItemModel>()
      for (const item of nextItems) nextByKey.set(item.key, item.model)

      // Remove
      for (const [key] of liveItems) {
        if (!nextByKey.has(key)) unmountItem(key)
      }

      // Mount new + update existing
      for (const { key, model: itemModel } of nextItems) {
        if (!liveItems.has(key)) {
          mountItem(key, itemModel)
        } else {
          pushItemUpdate(key, itemModel)
        }
      }

      // Ensure DOM order
      keyOrder = nextItems.map(i => i.key)
      for (let i = 0; i < keyOrder.length; i++) {
        const item = liveItems.get(keyOrder[i]!)!
        const currentAtIndex = container.children[i]
        if (currentAtIndex !== item.wrapper) {
          container.insertBefore(item.wrapper, currentAtIndex ?? null)
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Initial mount + subscription
    // ─────────────────────────────────────────────────────────────────

    // Mount initial items
    const initialItems = getItems(initialModel)
    for (const { key, model: itemModel } of initialItems) {
      const wrapper = mountItem(key, itemModel)
      container.appendChild(wrapper)
    }
    keyOrder = initialItems.map(i => i.key)

    const unsub = updates.subscribe(({ prev, next }) => {
      const delta = getDelta(next)

      if (delta !== null && delta.kind === "ops") {
        // Incremental path: apply operations directly
        for (const op of delta.ops) {
          applyKeyedOp(op)
        }
      } else if (delta !== null && delta.kind === "replace") {
        // Full replace — clear and remount
        for (const key of [...liveItems.keys()]) unmountItem(key)
        keyOrder = []
        const nextItems = delta.value.map((item, i) => ({
          // For replace deltas with raw values, we need getItems to provide keys.
          // Fall back to full reconcile which uses getItems.
          key: String(i), model: item,
        }))
        // Actually, replace with raw values doesn't have keys — fall back
        fullReconcile(prev, next)
      } else {
        // No delta or noop — full reconciliation
        fullReconcile(prev, next)
      }
    })

    return {
      teardown() {
        unsub()
        for (const { teardown: td } of liveItems.values()) td.teardown()
        container.remove()
      },
    }
  })
}
