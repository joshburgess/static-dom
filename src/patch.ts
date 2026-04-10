/**
 * patch.ts — Delta types for the incremental lambda calculus layer.
 *
 * For each type T, we define a "change type" ΔT that describes what
 * changed between two values of T. The key operations:
 *
 *   apply(value, delta)     — produce the new value
 *   diff(prev, next)        — compute the delta between two values
 *   compose(a, b)           — combine two deltas
 *
 * The core delta types:
 *
 *   AtomDelta<T>            — replace or no-op (works for any T)
 *   ArrayDelta<T>           — structured array operations
 *   KeyedArrayDelta<T>      — keyed array operations (for SDOM's array constructor)
 *
 * These are designed to be composed by users for their model types:
 *
 *   interface MyModelDelta {
 *     items?: KeyedArrayDelta<Item>
 *     input?: AtomDelta<string>
 *   }
 *
 * ─────────────────────────────────────────────────────────────────────
 * DESIGN NOTES
 * ─────────────────────────────────────────────────────────────────────
 *
 * We don't attempt a generic `Delta<T>` that pattern-matches on T —
 * TypeScript's type system can't do this reliably. Instead, we provide
 * composable delta primitives that users assemble for their models.
 *
 * The incremental SDOM constructors accept an optional delta extractor.
 * When deltas are available, updates are O(k) for k operations.
 * When absent, they fall back to the existing full-diff behavior.
 */

// ---------------------------------------------------------------------------
// AtomDelta — works for any type
// ---------------------------------------------------------------------------

/** A delta that either replaces the entire value or does nothing. */
export type AtomDelta<T> =
  | { readonly kind: "noop" }
  | { readonly kind: "replace"; readonly value: T }

export function noop(): { readonly kind: "noop" } {
  return { kind: "noop" }
}

export function replace<T>(value: T): { readonly kind: "replace"; readonly value: T } {
  return { kind: "replace", value }
}

export function applyAtom<T>(value: T, delta: AtomDelta<T>): T {
  return delta.kind === "replace" ? delta.value : value
}

// ---------------------------------------------------------------------------
// ArrayOp — individual operations on an array
// ---------------------------------------------------------------------------

/** Insert an item at a specific index. */
export interface ArrayInsert<T> {
  readonly kind: "insert"
  readonly index: number
  readonly item: T
}

/** Remove the item at a specific index. */
export interface ArrayRemove {
  readonly kind: "remove"
  readonly index: number
}

/** Move an item from one index to another. */
export interface ArrayMove {
  readonly kind: "move"
  readonly from: number
  readonly to: number
}

/** Replace the item at a specific index. */
export interface ArrayPatch<T> {
  readonly kind: "patch"
  readonly index: number
  readonly value: T
}

export type ArrayOp<T> =
  | ArrayInsert<T>
  | ArrayRemove
  | ArrayMove
  | ArrayPatch<T>

// Constructor helpers
export const insert = <T>(index: number, item: T): ArrayInsert<T> =>
  ({ kind: "insert", index, item })

export const remove = (index: number): ArrayRemove =>
  ({ kind: "remove", index })

export const move = (from: number, to: number): ArrayMove =>
  ({ kind: "move", from, to })

export const patch = <T>(index: number, value: T): ArrayPatch<T> =>
  ({ kind: "patch", index, value })

// ---------------------------------------------------------------------------
// ArrayDelta — a set of operations on an array
// ---------------------------------------------------------------------------

/**
 * A delta for an array value.
 *
 * Either an atomic delta (replace entire array or noop) or a list of
 * structured operations that can be applied in O(k) for k ops.
 */
export type ArrayDelta<T> =
  | AtomDelta<T[]>
  | { readonly kind: "ops"; readonly ops: readonly ArrayOp<T>[] }

export function ops<T>(...ops: ArrayOp<T>[]): ArrayDelta<T> {
  return { kind: "ops", ops }
}

/** Apply a single ArrayOp to an array (immutable — returns new array). */
export function applyArrayOp<T>(arr: readonly T[], op: ArrayOp<T>): T[] {
  switch (op.kind) {
    case "insert": {
      const result = [...arr]
      result.splice(op.index, 0, op.item)
      return result
    }
    case "remove": {
      const result = [...arr]
      result.splice(op.index, 1)
      return result
    }
    case "move": {
      const result = [...arr]
      const [item] = result.splice(op.from, 1)
      result.splice(op.to, 0, item!)
      return result
    }
    case "patch": {
      const result = [...arr]
      result[op.index] = op.value
      return result
    }
  }
}

/** Apply an ArrayDelta to an array. */
export function applyArrayDelta<T>(arr: readonly T[], delta: ArrayDelta<T>): T[] {
  switch (delta.kind) {
    case "noop":
      return arr as T[]
    case "replace":
      return delta.value
    case "ops":
      return delta.ops.reduce<T[]>(
        (acc, op) => applyArrayOp(acc, op),
        [...arr]
      )
  }
}

// ---------------------------------------------------------------------------
// KeyedArrayDelta — operations on keyed arrays (for SDOM's array)
// ---------------------------------------------------------------------------

/**
 * Operations on keyed arrays. These use string keys instead of numeric
 * indices, matching SDOM's `KeyedItem<T>` structure.
 *
 * This is the delta type consumed by `incrementalArray`.
 */

export interface KeyedInsert<T> {
  readonly kind: "insert"
  readonly key: string
  readonly item: T
  /** Insert before this key. If null, append to end. */
  readonly before: string | null
}

export interface KeyedRemove {
  readonly kind: "remove"
  readonly key: string
}

export interface KeyedMove {
  readonly kind: "move"
  readonly key: string
  /** Move before this key. If null, move to end. */
  readonly before: string | null
}

export interface KeyedPatch<T> {
  readonly kind: "patch"
  readonly key: string
  readonly value: T
}

export type KeyedOp<T> =
  | KeyedInsert<T>
  | KeyedRemove
  | KeyedMove
  | KeyedPatch<T>

export type KeyedArrayDelta<T> =
  | AtomDelta<T[]>
  | { readonly kind: "ops"; readonly ops: readonly KeyedOp<T>[] }

// Constructor helpers for keyed operations
export const keyedInsert = <T>(key: string, item: T, before: string | null = null): KeyedInsert<T> =>
  ({ kind: "insert", key, item, before })

export const keyedRemove = (key: string): KeyedRemove =>
  ({ kind: "remove", key })

export const keyedMove = (key: string, before: string | null = null): KeyedMove =>
  ({ kind: "move", key, before })

export const keyedPatch = <T>(key: string, value: T): KeyedPatch<T> =>
  ({ kind: "patch", key, value })

export function keyedOps<T>(...ops: KeyedOp<T>[]): KeyedArrayDelta<T> {
  return { kind: "ops", ops }
}

// ---------------------------------------------------------------------------
// Diff utilities
// ---------------------------------------------------------------------------

/**
 * Compute a KeyedArrayDelta by diffing two keyed arrays.
 *
 * This is the "fallback" path — when the user doesn't provide deltas,
 * we compute them. It's still O(n) but produces structured ops that the
 * incremental array can consume uniformly.
 *
 * @param keyOf  Extract the key from an item.
 * @param prev   Previous array.
 * @param next   Next array.
 */
export function diffKeyed<T>(
  prev: readonly T[],
  next: readonly T[],
  keyOf: (item: T) => string,
  eq: (a: T, b: T) => boolean = Object.is
): KeyedArrayDelta<T> {
  const prevKeys = new Map<string, { item: T; index: number }>()
  for (let i = 0; i < prev.length; i++) {
    const item = prev[i]!
    prevKeys.set(keyOf(item), { item, index: i })
  }

  const nextKeys = new Map<string, { item: T; index: number }>()
  for (let i = 0; i < next.length; i++) {
    const item = next[i]!
    nextKeys.set(keyOf(item), { item, index: i })
  }

  const result: KeyedOp<T>[] = []

  // Removals: in prev but not in next
  for (const [key] of prevKeys) {
    if (!nextKeys.has(key)) {
      result.push(keyedRemove(key))
    }
  }

  // Insertions and patches
  for (let i = 0; i < next.length; i++) {
    const item = next[i]!
    const key = keyOf(item)
    const prevEntry = prevKeys.get(key)

    if (!prevEntry) {
      // New item — insert before the next key (or append)
      const beforeKey = i + 1 < next.length ? keyOf(next[i + 1]!) : null
      result.push(keyedInsert(key, item, beforeKey))
    } else if (!eq(prevEntry.item, item)) {
      // Changed item
      result.push(keyedPatch(key, item))
    }
  }

  // Order changes: detect if the relative order changed
  // (simplified — we emit moves only when needed)
  // For a full implementation, use longest increasing subsequence
  // to minimize moves. For now, we skip move detection in diff
  // since the array constructor handles reordering in its reconcile step.

  if (result.length === 0) return noop()
  return keyedOps(...result)
}
