import { describe, it, expect, vi } from "vitest"
import {
  makeVar,
  map,
  map2,
  batch,
  stabilize,
  disposeNode,
} from "../src/incremental-graph"

describe("incremental-graph", () => {
  it("var.value reads back the initial value", () => {
    const v = makeVar(1)
    expect(v.value).toBe(1)
  })

  it("var.set updates the value synchronously when not in a batch", () => {
    const v = makeVar(1)
    v.set(2)
    expect(v.value).toBe(2)
  })

  it("ref-eq cutoff suppresses redundant set", () => {
    const v = makeVar({ x: 1 })
    const obs = vi.fn()
    v.observe(obs)
    const sameRef = v.value
    v.set(sameRef)
    expect(obs).not.toHaveBeenCalled()
  })

  it("observers fire after stabilize for value-changed vars", () => {
    const v = makeVar(1)
    const obs = vi.fn()
    v.observe(obs)
    v.set(2)
    expect(obs).toHaveBeenCalledTimes(1)
    expect(obs).toHaveBeenCalledWith(2)
  })

  it("map derives a new node and recomputes when the parent changes", () => {
    const v = makeVar(2)
    const doubled = map(v, (x) => x * 2)
    expect(doubled.value).toBe(4)
    v.set(5)
    expect(doubled.value).toBe(10)
  })

  it("map cutoff prevents downstream observers from firing", () => {
    const v = makeVar(1)
    const isPositive = map(v, (x) => x > 0)
    const obs = vi.fn()
    isPositive.observe(obs)
    v.set(2)
    expect(obs).not.toHaveBeenCalled()
    v.set(-1)
    expect(obs).toHaveBeenCalledTimes(1)
    expect(obs).toHaveBeenCalledWith(false)
  })

  it("map2 combines two parents", () => {
    const a = makeVar(1)
    const b = makeVar(2)
    const sum = map2(a, b, (x, y) => x + y)
    expect(sum.value).toBe(3)
    a.set(10)
    expect(sum.value).toBe(12)
    b.set(20)
    expect(sum.value).toBe(30)
  })

  it("batch collapses multiple sets into one stabilize sweep", () => {
    const v = makeVar(1)
    const doubled = map(v, (x) => x * 2)
    const obs = vi.fn()
    doubled.observe(obs)
    batch(() => {
      v.set(2)
      v.set(3)
      v.set(4)
    })
    expect(obs).toHaveBeenCalledTimes(1)
    expect(obs).toHaveBeenCalledWith(8)
    expect(doubled.value).toBe(8)
  })

  it("nested batches only stabilize at the outermost exit", () => {
    const v = makeVar(1)
    const doubled = map(v, (x) => x * 2)
    const obs = vi.fn()
    doubled.observe(obs)
    batch(() => {
      v.set(2)
      batch(() => {
        v.set(3)
      })
      expect(doubled.value).toBe(2) // not yet stabilized
    })
    expect(obs).toHaveBeenCalledTimes(1)
    expect(doubled.value).toBe(6)
  })

  it("a diamond graph recomputes the join exactly once per change", () => {
    const root = makeVar(1)
    const left = map(root, (x) => x + 1)
    const right = map(root, (x) => x + 2)
    const joinFn = vi.fn((l: number, r: number) => l * r)
    const join = map2(left, right, joinFn)
    expect(join.value).toBe(2 * 3)
    expect(joinFn).toHaveBeenCalledTimes(1)
    root.set(10)
    expect(join.value).toBe(11 * 12)
    expect(joinFn).toHaveBeenCalledTimes(2)
  })

  it("explicit stabilize is a no-op when nothing is dirty", () => {
    const v = makeVar(1)
    const doubled = map(v, (x) => x * 2)
    const obs = vi.fn()
    doubled.observe(obs)
    stabilize()
    expect(obs).not.toHaveBeenCalled()
  })

  it("unsubscribe stops further observer notifications", () => {
    const v = makeVar(1)
    const obs = vi.fn()
    const unsub = v.observe(obs)
    v.set(2)
    expect(obs).toHaveBeenCalledTimes(1)
    unsub()
    v.set(3)
    expect(obs).toHaveBeenCalledTimes(1)
  })

  it("disposeNode detaches a derived node so the parent stops driving it", () => {
    const v = makeVar(1)
    const doubled = map(v, (x) => x * 2)
    disposeNode(doubled)
    v.set(5)
    // doubled is detached — value frozen at last computed value
    expect(doubled.value).toBe(2)
  })

  it("custom eq on map cuts off based on a domain notion of equality", () => {
    const v = makeVar({ x: 1, label: "a" })
    const xOnly = map(v, (m) => m, (a, b) => a.x === b.x)
    const obs = vi.fn()
    xOnly.observe(obs)
    v.set({ x: 1, label: "b" })
    expect(obs).not.toHaveBeenCalled()
    v.set({ x: 2, label: "c" })
    expect(obs).toHaveBeenCalledTimes(1)
  })
})
