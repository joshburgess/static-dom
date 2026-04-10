import { describe, it, expect } from "vitest"
import {
  noop, replace, applyAtom,
  insert, remove, move, patch, ops,
  applyArrayOp, applyArrayDelta,
  keyedInsert, keyedRemove, keyedPatch, keyedOps,
  diffKeyed,
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
