import { describe, it, expect } from "vitest"
import {
  noop, replace, applyAtom,
  insert, remove, move, patch, ops,
  applyArrayOp, applyArrayDelta,
  keyedInsert, keyedRemove, keyedPatch, keyedOps,
  diffKeyed,
  fields, applyRecord, fieldDelta, produce,
  type RecordDelta,
} from "../src/patch"

describe("AtomDelta", () => {
  it("noop returns original value", () => {
    expect(applyAtom(42, noop())).toBe(42)
    expect(applyAtom("hello", noop())).toBe("hello")
  })

  it("replace returns new value", () => {
    expect(applyAtom(42, replace(99))).toBe(99)
    expect(applyAtom("hello", replace("world"))).toBe("world")
  })
})

describe("ArrayOp", () => {
  it("insert at index", () => {
    expect(applyArrayOp([1, 2, 3], insert(1, 10))).toEqual([1, 10, 2, 3])
    expect(applyArrayOp([1, 2, 3], insert(0, 10))).toEqual([10, 1, 2, 3])
    expect(applyArrayOp([1, 2, 3], insert(3, 10))).toEqual([1, 2, 3, 10])
  })

  it("remove at index", () => {
    expect(applyArrayOp([1, 2, 3], remove(1))).toEqual([1, 3])
    expect(applyArrayOp([1, 2, 3], remove(0))).toEqual([2, 3])
    expect(applyArrayOp([1, 2, 3], remove(2))).toEqual([1, 2])
  })

  it("move from index to index", () => {
    expect(applyArrayOp([1, 2, 3, 4], move(0, 2))).toEqual([2, 3, 1, 4])
    expect(applyArrayOp([1, 2, 3, 4], move(3, 0))).toEqual([4, 1, 2, 3])
  })

  it("patch at index", () => {
    expect(applyArrayOp([1, 2, 3], patch(1, 20))).toEqual([1, 20, 3])
  })
})

describe("ArrayDelta", () => {
  it("noop returns original", () => {
    const arr = [1, 2, 3]
    expect(applyArrayDelta(arr, noop())).toBe(arr)
  })

  it("replace returns new array", () => {
    expect(applyArrayDelta([1, 2], replace([3, 4, 5]))).toEqual([3, 4, 5])
  })

  it("applies multiple ops in order", () => {
    // Start: [a, b, c]
    // Insert "x" at 1 → [a, x, b, c]
    // Remove at 3 → [a, x, b]
    const result = applyArrayDelta(
      ["a", "b", "c"],
      ops(insert(1, "x"), remove(3))
    )
    expect(result).toEqual(["a", "x", "b"])
  })
})

describe("diffKeyed", () => {
  interface Item { id: string; label: string }
  const keyOf = (item: Item) => item.id

  it("detects no changes", () => {
    const items = [{ id: "a", label: "A" }]
    expect(diffKeyed(items, items, keyOf)).toEqual({ kind: "noop" })
  })

  it("detects insertions", () => {
    const a = { id: "a", label: "A" }
    const prev = [a]
    const next = [a, { id: "b", label: "B" }] // same ref for "a"
    const delta = diffKeyed(prev, next, keyOf)
    expect(delta).toEqual(keyedOps(
      keyedInsert("b", { id: "b", label: "B" }, null)
    ))
  })

  it("detects removals", () => {
    const a = { id: "a", label: "A" }
    const prev = [a, { id: "b", label: "B" }]
    const next = [a] // same ref for "a"
    const delta = diffKeyed(prev, next, keyOf)
    expect(delta).toEqual(keyedOps(keyedRemove("b")))
  })

  it("detects patches", () => {
    const prev = [{ id: "a", label: "A" }]
    const next = [{ id: "a", label: "A updated" }]
    const delta = diffKeyed(prev, next, keyOf)
    expect(delta).toEqual(keyedOps(
      keyedPatch("a", { id: "a", label: "A updated" })
    ))
  })

  it("detects mixed operations", () => {
    const prev = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ]
    const next = [
      { id: "a", label: "A modified" },
      { id: "d", label: "D" },
    ]
    const delta = diffKeyed(prev, next, keyOf)
    expect(delta.kind).toBe("ops")
    if (delta.kind !== "ops") return

    const kinds = delta.ops.map(op => op.kind)
    expect(kinds).toContain("remove") // b removed
    expect(kinds).toContain("remove") // c removed
    expect(kinds).toContain("insert") // d inserted
    expect(kinds).toContain("patch")  // a patched
  })
})

// ─────────────────────────────────────────────────────────────────────
// RecordDelta
// ─────────────────────────────────────────────────────────────────────

describe("RecordDelta", () => {
  interface Model { count: number; name: string; items: string[] }

  it("noop returns original", () => {
    const m: Model = { count: 1, name: "a", items: [] }
    expect(applyRecord(m, { kind: "noop" })).toBe(m)
  })

  it("replace returns new value", () => {
    const m: Model = { count: 1, name: "a", items: [] }
    const next: Model = { count: 99, name: "z", items: ["x"] }
    expect(applyRecord(m, { kind: "replace", value: next })).toBe(next)
  })

  it("fields replaces only specified fields", () => {
    const m: Model = { count: 1, name: "a", items: ["x"] }
    const result = applyRecord(m, fields<Model>({ count: replace(42) }))
    expect(result).toEqual({ count: 42, name: "a", items: ["x"] })
  })

  it("fields noop on a field leaves it unchanged", () => {
    const m: Model = { count: 1, name: "a", items: [] }
    const result = applyRecord(m, fields<Model>({ count: noop() }))
    expect(result).toEqual(m)
  })

  it("fields replaces multiple fields", () => {
    const m: Model = { count: 1, name: "a", items: [] }
    const result = applyRecord(m, fields<Model>({
      count: replace(10),
      name: replace("b"),
    }))
    expect(result).toEqual({ count: 10, name: "b", items: [] })
  })
})

describe("fieldDelta", () => {
  interface Model { count: number; name: string }

  it("returns undefined for noop", () => {
    expect(fieldDelta<Model, "count">({ kind: "noop" }, "count")).toBeUndefined()
  })

  it("extracts field value from replace", () => {
    const delta: RecordDelta<Model> = { kind: "replace", value: { count: 5, name: "x" } }
    expect(fieldDelta(delta, "count")).toEqual({ kind: "replace", value: 5 })
    expect(fieldDelta(delta, "name")).toEqual({ kind: "replace", value: "x" })
  })

  it("extracts field delta from fields variant", () => {
    const delta = fields<Model>({ count: replace(42) })
    expect(fieldDelta(delta, "count")).toEqual({ kind: "replace", value: 42 })
    expect(fieldDelta(delta, "name")).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────
// produce
// ─────────────────────────────────────────────────────────────────────

describe("produce", () => {
  interface Model { count: number; name: string; active: boolean }

  it("returns noop when nothing changes", () => {
    const m: Model = { count: 1, name: "a", active: true }
    const [next, delta] = produce(m, _draft => {})
    expect(next).toBe(m) // same reference
    expect(delta).toEqual({ kind: "noop" })
  })

  it("tracks a single field change", () => {
    const m: Model = { count: 1, name: "a", active: true }
    const [next, delta] = produce(m, draft => {
      draft.count = 42
    })
    expect(next).toEqual({ count: 42, name: "a", active: true })
    expect(next).not.toBe(m)
    expect(delta.kind).toBe("fields")
    if (delta.kind !== "fields") return
    expect(delta.fields.count).toEqual({ kind: "replace", value: 42 })
    expect(delta.fields.name).toBeUndefined()
    expect(delta.fields.active).toBeUndefined()
  })

  it("tracks multiple field changes", () => {
    const m: Model = { count: 1, name: "a", active: true }
    const [next, delta] = produce(m, draft => {
      draft.count = 10
      draft.name = "b"
    })
    expect(next).toEqual({ count: 10, name: "b", active: true })
    expect(delta.kind).toBe("fields")
    if (delta.kind !== "fields") return
    expect(delta.fields.count).toEqual({ kind: "replace", value: 10 })
    expect(delta.fields.name).toEqual({ kind: "replace", value: "b" })
    expect(delta.fields.active).toBeUndefined()
  })

  it("reads current values through proxy", () => {
    const m: Model = { count: 1, name: "a", active: true }
    const [next, _delta] = produce(m, draft => {
      draft.count = draft.count + 1
    })
    expect(next.count).toBe(2)
  })
})
