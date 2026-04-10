import { describe, it, expect } from "vitest"
import {
  createSignal,
  toUpdateStream,
  mapUpdate,
  mergeUpdates,
  contramapDispatcher,
  type Update,
} from "../src/observable"

// ---------------------------------------------------------------------------
// createSignal
// ---------------------------------------------------------------------------

describe("createSignal", () => {
  it("holds an initial value", () => {
    const s = createSignal(42)
    expect(s.value).toBe(42)
  })

  it("updates value on setValue", () => {
    const s = createSignal("a")
    s.setValue("b")
    expect(s.value).toBe("b")
  })

  it("notifies subscribers on setValue", () => {
    const s = createSignal(0)
    const received: number[] = []
    s.subscribe(v => received.push(v))
    s.setValue(1)
    s.setValue(2)
    expect(received).toEqual([1, 2])
  })

  it("does not notify after unsubscribe", () => {
    const s = createSignal(0)
    const received: number[] = []
    const unsub = s.subscribe(v => received.push(v))
    s.setValue(1)
    unsub()
    s.setValue(2)
    expect(received).toEqual([1])
  })

  it("supports multiple subscribers independently", () => {
    const s = createSignal(0)
    const a: number[] = []
    const b: number[] = []
    const unsubA = s.subscribe(v => a.push(v))
    s.subscribe(v => b.push(v))

    s.setValue(1)
    unsubA()
    s.setValue(2)

    expect(a).toEqual([1])
    expect(b).toEqual([1, 2])
  })
})

// ---------------------------------------------------------------------------
// toUpdateStream
// ---------------------------------------------------------------------------

describe("toUpdateStream", () => {
  it("emits prev/next pairs", () => {
    const s = createSignal(0)
    const stream = toUpdateStream(s)
    const updates: Array<{ prev: number; next: number }> = []
    stream.subscribe(u => updates.push({ prev: u.prev, next: u.next }))

    s.setValue(1)
    s.setValue(2)
    expect(updates).toEqual([
      { prev: 0, next: 1 },
      { prev: 1, next: 2 },
    ])
  })

  it("sets delta to undefined", () => {
    const s = createSignal("x")
    const stream = toUpdateStream(s)
    const deltas: unknown[] = []
    stream.subscribe(u => deltas.push(u.delta))

    s.setValue("y")
    expect(deltas).toEqual([undefined])
  })

  it("returns a working unsubscribe", () => {
    const s = createSignal(0)
    const stream = toUpdateStream(s)
    const updates: number[] = []
    const unsub = stream.subscribe(u => updates.push(u.next))

    s.setValue(1)
    unsub()
    s.setValue(2)
    expect(updates).toEqual([1])
  })
})

// ---------------------------------------------------------------------------
// mapUpdate
// ---------------------------------------------------------------------------

describe("mapUpdate", () => {
  it("projects updates through a function", () => {
    const s = createSignal({ name: "Alice", age: 30 })
    const stream = toUpdateStream(s)
    const mapped = mapUpdate(stream, m => m.name)
    const names: string[] = []
    mapped.subscribe(u => names.push(u.next))

    s.setValue({ name: "Bob", age: 30 })
    expect(names).toEqual(["Bob"])
  })

  it("skips updates when projected value is unchanged (reference equality)", () => {
    const s = createSignal({ name: "Alice", age: 30 })
    const stream = toUpdateStream(s)
    const mapped = mapUpdate(stream, m => m.name)
    const names: string[] = []
    mapped.subscribe(u => names.push(u.next))

    // Change age but not name
    s.setValue({ name: "Alice", age: 31 })
    expect(names).toEqual([])

    // Change name
    s.setValue({ name: "Bob", age: 31 })
    expect(names).toEqual(["Bob"])
  })

  it("accepts a custom equality function", () => {
    const s = createSignal({ x: 1 })
    const stream = toUpdateStream(s)
    // Always consider equal — should never emit
    const mapped = mapUpdate(stream, m => m.x, () => true)
    const received: number[] = []
    mapped.subscribe(u => received.push(u.next))

    s.setValue({ x: 2 })
    s.setValue({ x: 3 })
    expect(received).toEqual([])
  })

  it("provides correct prev and next in projected updates", () => {
    const s = createSignal({ v: "a" })
    const stream = toUpdateStream(s)
    const mapped = mapUpdate(stream, m => m.v)
    const pairs: Array<{ prev: string; next: string }> = []
    mapped.subscribe(u => pairs.push({ prev: u.prev, next: u.next }))

    s.setValue({ v: "b" })
    s.setValue({ v: "c" })
    expect(pairs).toEqual([
      { prev: "a", next: "b" },
      { prev: "b", next: "c" },
    ])
  })
})

// ---------------------------------------------------------------------------
// mergeUpdates
// ---------------------------------------------------------------------------

describe("mergeUpdates", () => {
  it("merges multiple streams into one", () => {
    const s1 = createSignal(0)
    const s2 = createSignal(0)
    const stream1 = toUpdateStream(s1)
    const stream2 = toUpdateStream(s2)
    const merged = mergeUpdates(stream1, stream2)
    const nexts: number[] = []
    merged.subscribe(u => nexts.push(u.next))

    s1.setValue(1)
    s2.setValue(2)
    expect(nexts).toEqual([1, 2])
  })

  it("unsubscribes from all streams", () => {
    const s1 = createSignal(0)
    const s2 = createSignal(0)
    const merged = mergeUpdates(toUpdateStream(s1), toUpdateStream(s2))
    const nexts: number[] = []
    const unsub = merged.subscribe(u => nexts.push(u.next))

    s1.setValue(1)
    unsub()
    s1.setValue(2)
    s2.setValue(3)
    expect(nexts).toEqual([1])
  })

  it("works with zero streams", () => {
    const merged = mergeUpdates<number>()
    const nexts: number[] = []
    const unsub = merged.subscribe(u => nexts.push(u.next))
    unsub()
    expect(nexts).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// contramapDispatcher
// ---------------------------------------------------------------------------

describe("contramapDispatcher", () => {
  it("maps messages through a function", () => {
    const received: string[] = []
    const parent = (msg: string) => received.push(msg)
    const child = contramapDispatcher(parent, (n: number) => `num:${n}`)
    child(42)
    expect(received).toEqual(["num:42"])
  })

  it("preserves dispatch order", () => {
    const received: string[] = []
    const parent = (msg: string) => received.push(msg)
    const child = contramapDispatcher(parent, (n: number) => String(n))
    child(1)
    child(2)
    child(3)
    expect(received).toEqual(["1", "2", "3"])
  })
})
