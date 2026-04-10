import { describe, it, expect } from "vitest"
import { lens, prop, composeLenses, unionMember, indexLens, iso } from "../src/optics"
import type { Lens, Prism, Iso } from "../src/optics"
import {
  createSignal,
  toUpdateStream,
  mapUpdate,
  mergeUpdates,
  contramapDispatcher,
} from "../src/observable"
import type { Update, UpdateStream, Dispatcher } from "../src/observable"

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface Address {
  street: string
  city: string
}

interface User {
  name: string
  age: number
  address: Address
}

// ---------------------------------------------------------------------------
// lens()
// ---------------------------------------------------------------------------

describe("lens", () => {
  const nameLens: Lens<User, string> = lens(
    (u: User) => u.name,
    (name: string, u: User) => ({ ...u, name }),
  )

  const user: User = { name: "Alice", age: 30, address: { street: "Elm St", city: "Springfield" } }

  it("get extracts the focused value", () => {
    expect(nameLens.get(user)).toBe("Alice")
  })

  it("set produces a new whole with the part replaced", () => {
    const updated = nameLens.set("Bob", user)
    expect(updated.name).toBe("Bob")
    expect(updated.age).toBe(30) // unchanged
  })

  it("satisfies get-set law: get(set(a, s)) === a", () => {
    const updated = nameLens.set("Charlie", user)
    expect(nameLens.get(updated)).toBe("Charlie")
  })

  it("satisfies set-get law: set(get(s), s) === s (structurally)", () => {
    const roundTripped = nameLens.set(nameLens.get(user), user)
    expect(roundTripped).toEqual(user)
  })

  it("compose chains two lenses left-to-right", () => {
    const ageLens: Lens<User, number> = lens(
      (u: User) => u.age,
      (age: number, u: User) => ({ ...u, age }),
    )
    // Compose with identity-ish lens that focuses on same type
    const streetLens: Lens<Address, string> = lens(
      (a: Address) => a.street,
      (street: string, a: Address) => ({ ...a, street }),
    )
    const addressLens: Lens<User, Address> = lens(
      (u: User) => u.address,
      (address: Address, u: User) => ({ ...u, address }),
    )

    const userStreetLens = addressLens.compose(streetLens)
    expect(userStreetLens.get(user)).toBe("Elm St")
    const updated = userStreetLens.set("Oak Ave", user)
    expect(updated.address.street).toBe("Oak Ave")
    expect(updated.name).toBe("Alice") // unchanged
  })

  it("toUpdate returns the get function", () => {
    expect(nameLens.toUpdate()).toBe(nameLens.get)
  })

  it("getDelta extracts sub-delta when provided", () => {
    const withDelta = lens(
      (u: User) => u.name,
      (name: string, u: User) => ({ ...u, name }),
      (parentDelta: unknown) => {
        if (
          parentDelta != null &&
          typeof parentDelta === "object" &&
          "field" in parentDelta &&
          (parentDelta as { field: string }).field === "name"
        ) {
          return (parentDelta as { field: string; value: unknown }).value
        }
        return undefined
      },
    )

    expect(withDelta.getDelta).toBeDefined()
    expect(withDelta.getDelta!({ field: "name", value: "changed" })).toBe("changed")
    expect(withDelta.getDelta!({ field: "age", value: 99 })).toBeUndefined()
  })

  it("getDelta is absent when not provided", () => {
    expect(nameLens.getDelta).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// prop() — record lens helper
// ---------------------------------------------------------------------------

describe("prop", () => {
  const user: User = { name: "Alice", age: 30, address: { street: "Elm St", city: "Springfield" } }

  it("creates a lens for a record key", () => {
    const ageLens = prop<User>()("age")
    expect(ageLens.get(user)).toBe(30)
    expect(ageLens.set(31, user)).toEqual({ ...user, age: 31 })
  })

  it("getDelta handles RecordDelta with fields variant", () => {
    const nameLens = prop<User>()("name")
    const delta = { kind: "fields", fields: { name: { kind: "replace", value: "Bob" } } }
    expect(nameLens.getDelta!(delta)).toEqual({ kind: "replace", value: "Bob" })
  })

  it("getDelta returns undefined for noop", () => {
    const nameLens = prop<User>()("name")
    expect(nameLens.getDelta!({ kind: "noop" })).toBeUndefined()
  })

  it("getDelta extracts field from replace variant", () => {
    const ageLens = prop<User>()("age")
    const delta = { kind: "replace", value: { name: "Bob", age: 99, address: { street: "X", city: "Y" } } }
    expect(ageLens.getDelta!(delta)).toEqual({ kind: "replace", value: 99 })
  })

  it("getDelta returns undefined when field is not in fields variant", () => {
    const ageLens = prop<User>()("age")
    const delta = { kind: "fields", fields: { name: { kind: "replace", value: "Bob" } } }
    expect(ageLens.getDelta!(delta)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// composeLenses()
// ---------------------------------------------------------------------------

describe("composeLenses", () => {
  const user: User = { name: "Alice", age: 30, address: { street: "Elm St", city: "Springfield" } }

  it("composes two lenses", () => {
    const streetLens = composeLenses(
      prop<User>()("address"),
      prop<Address>()("street"),
    )
    expect(streetLens.get(user)).toBe("Elm St")

    const updated = streetLens.set("Oak Ave", user)
    expect(updated.address.street).toBe("Oak Ave")
    expect(updated.name).toBe("Alice")
  })

  it("composes three lenses", () => {
    interface Root { user: User }
    const root: Root = { user }

    const streetLens = composeLenses(
      prop<Root>()("user"),
      prop<User>()("address"),
      prop<Address>()("street"),
    )
    expect(streetLens.get(root)).toBe("Elm St")

    const updated = streetLens.set("Main St", root)
    expect(updated.user.address.street).toBe("Main St")
    expect(updated.user.name).toBe("Alice")
  })

  it("preserves getDelta through composition", () => {
    const addressLens = prop<User>()("address")
    const streetLens = prop<Address>()("street")
    const composed = composeLenses(addressLens, streetLens)

    // Both prop lenses have getDelta, so the composed one should too
    expect(composed.getDelta).toBeDefined()

    // A fields delta that contains an address field with a nested fields delta
    const delta = {
      kind: "fields",
      fields: {
        address: {
          kind: "fields",
          fields: {
            street: { kind: "replace", value: "New St" },
          },
        },
      },
    }
    expect(composed.getDelta!(delta)).toEqual({ kind: "replace", value: "New St" })
  })
})

// ---------------------------------------------------------------------------
// unionMember()
// ---------------------------------------------------------------------------

describe("unionMember", () => {
  type Shape =
    | { kind: "circle"; r: number }
    | { kind: "rect"; w: number; h: number }

  function isCircle(s: Shape): s is { kind: "circle"; r: number } {
    return s.kind === "circle"
  }

  const circlePrism: Prism<Shape, { kind: "circle"; r: number }> = unionMember<
    Shape,
    { kind: "circle"; r: number }
  >(isCircle)

  it("preview returns A when predicate matches", () => {
    const circle: Shape = { kind: "circle", r: 5 }
    expect(circlePrism.preview(circle)).toEqual({ kind: "circle", r: 5 })
  })

  it("preview returns null when predicate does not match", () => {
    const rect: Shape = { kind: "rect", w: 3, h: 4 }
    expect(circlePrism.preview(rect)).toBeNull()
  })

  it("review embeds A back into S", () => {
    const circle = { kind: "circle" as const, r: 10 }
    const result: Shape = circlePrism.review(circle)
    expect(result).toEqual({ kind: "circle", r: 10 })
  })

  it("satisfies preview(review(a)) === a", () => {
    const a = { kind: "circle" as const, r: 7 }
    expect(circlePrism.preview(circlePrism.review(a))).toEqual(a)
  })

  it("composeLens chains a prism with a lens", () => {
    const rLens: Lens<{ kind: "circle"; r: number }, number> = lens(
      (c) => c.r,
      (r, c) => ({ ...c, r }),
    )
    const rPrism = circlePrism.composeLens(rLens)

    const circle: Shape = { kind: "circle", r: 5 }
    const rect: Shape = { kind: "rect", w: 3, h: 4 }

    expect(rPrism.preview(circle)).toBe(5)
    expect(rPrism.preview(rect)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// indexLens()
// ---------------------------------------------------------------------------

describe("indexLens", () => {
  const arr: ReadonlyArray<string> = ["a", "b", "c"]

  it("get retrieves the element at the given index", () => {
    expect(indexLens<string>(0).get(arr)).toBe("a")
    expect(indexLens<string>(1).get(arr)).toBe("b")
    expect(indexLens<string>(2).get(arr)).toBe("c")
  })

  it("set produces a new array with the element replaced", () => {
    const updated = indexLens<string>(1).set("x", arr)
    expect(updated).toEqual(["a", "x", "c"])
    // Original is not mutated
    expect(arr).toEqual(["a", "b", "c"])
  })

  it("throws RangeError on out-of-bounds get", () => {
    expect(() => indexLens<string>(5).get(arr)).toThrow(RangeError)
    expect(() => indexLens<string>(5).get(arr)).toThrow(/out of bounds/)
  })

  it("composes with other lenses", () => {
    interface Item { label: string }
    const items: ReadonlyArray<Item> = [{ label: "first" }, { label: "second" }]

    const labelOfSecond = indexLens<Item>(1).compose(prop<Item>()("label"))
    expect(labelOfSecond.get(items)).toBe("second")

    const updated = labelOfSecond.set("changed", items)
    expect(updated[1]).toEqual({ label: "changed" })
    expect(updated[0]).toEqual({ label: "first" })
  })
})

// ---------------------------------------------------------------------------
// iso()
// ---------------------------------------------------------------------------

describe("iso", () => {
  // Celsius <-> Fahrenheit
  const celsiusToFahrenheit: Iso<number, number> = iso(
    (c: number) => c * 9 / 5 + 32,
    (f: number) => (f - 32) * 5 / 9,
  )

  it("from converts S to A", () => {
    expect(celsiusToFahrenheit.from(0)).toBe(32)
    expect(celsiusToFahrenheit.from(100)).toBe(212)
  })

  it("to converts A back to S", () => {
    expect(celsiusToFahrenheit.to(32)).toBe(0)
    expect(celsiusToFahrenheit.to(212)).toBe(100)
  })

  it("get is the same as from", () => {
    expect(celsiusToFahrenheit.get(0)).toBe(celsiusToFahrenheit.from(0))
    expect(celsiusToFahrenheit.get(100)).toBe(celsiusToFahrenheit.from(100))
  })

  it("round-trip: to(from(s)) === s", () => {
    expect(celsiusToFahrenheit.to(celsiusToFahrenheit.from(0))).toBeCloseTo(0)
    expect(celsiusToFahrenheit.to(celsiusToFahrenheit.from(37))).toBeCloseTo(37)
  })

  it("round-trip: from(to(a)) === a", () => {
    expect(celsiusToFahrenheit.from(celsiusToFahrenheit.to(98.6))).toBeCloseTo(98.6)
  })

  it("compose works because Iso extends Lens", () => {
    // String length iso (lossy in general, but fine for testing compose)
    interface Wrapper { temp: number }
    const tempLens = prop<Wrapper>()("temp")
    const composed = tempLens.compose(celsiusToFahrenheit)

    const w: Wrapper = { temp: 100 }
    expect(composed.get(w)).toBe(212)
    // set on an iso ignores the second argument (the whole S)
    const updated = composed.set(32, w)
    expect(updated.temp).toBe(0)
  })

  it("works with structural types (not just numbers)", () => {
    interface Pair { fst: string; snd: string }
    const pairIso: Iso<Pair, [string, string]> = iso(
      (p: Pair) => [p.fst, p.snd] as [string, string],
      ([fst, snd]: [string, string]) => ({ fst, snd }),
    )

    const pair: Pair = { fst: "hello", snd: "world" }
    expect(pairIso.from(pair)).toEqual(["hello", "world"])
    expect(pairIso.to(["hello", "world"])).toEqual(pair)

    // Round-trip
    expect(pairIso.to(pairIso.from(pair))).toEqual(pair)
  })
})

// ---------------------------------------------------------------------------
// mapUpdate()
// ---------------------------------------------------------------------------

describe("mapUpdate", () => {
  it("projects updates through a function", () => {
    const signal = createSignal({ name: "Alice", age: 30 })
    const stream = toUpdateStream(signal)
    const nameStream = mapUpdate(stream, (m) => m.name)

    const received: Update<string>[] = []
    nameStream.subscribe((u) => {
      received.push({ prev: u.prev, next: u.next })
    })

    signal.setValue({ name: "Bob", age: 30 })
    expect(received).toHaveLength(1)
    expect(received[0]!.prev).toBe("Alice")
    expect(received[0]!.next).toBe("Bob")
  })

  it("filters when projected value has not changed (reference equality)", () => {
    const signal = createSignal({ name: "Alice", age: 30 })
    const stream = toUpdateStream(signal)
    const nameStream = mapUpdate(stream, (m) => m.name)

    const received: Update<string>[] = []
    nameStream.subscribe((u) => {
      received.push({ prev: u.prev, next: u.next })
    })

    // Change only age — name stays the same string literal
    signal.setValue({ name: "Alice", age: 31 })
    expect(received).toHaveLength(0)

    // Now change name
    signal.setValue({ name: "Bob", age: 31 })
    expect(received).toHaveLength(1)
  })

  it("uses custom equality function when provided", () => {
    const signal = createSignal({ value: [1, 2, 3] })
    const stream = toUpdateStream(signal)

    // Custom eq: arrays are equal if they have the same length
    const lenStream = mapUpdate(
      stream,
      (m) => m.value,
      (a, b) => a.length === b.length,
    )

    const received: Array<{ prev: number[]; next: number[] }> = []
    lenStream.subscribe((u) => {
      received.push({ prev: u.prev, next: u.next })
    })

    // Same length — should be filtered
    signal.setValue({ value: [4, 5, 6] })
    expect(received).toHaveLength(0)

    // Different length — should emit
    signal.setValue({ value: [1, 2] })
    expect(received).toHaveLength(1)
    expect(received[0]!.next).toEqual([1, 2])
  })

  it("passes delta through to the projected update", () => {
    // Manually create an UpdateStream that carries a delta
    const listeners: Array<(u: Update<{ x: number }>) => void> = []
    const stream: UpdateStream<{ x: number }> = {
      subscribe(observer) {
        listeners.push(observer)
        return () => {
          const idx = listeners.indexOf(observer)
          if (idx >= 0) listeners.splice(idx, 1)
        }
      },
    }

    const mapped = mapUpdate(stream, (m) => m.x)
    const received: Update<number>[] = []
    mapped.subscribe((u) => {
      received.push({ prev: u.prev, next: u.next, delta: u.delta })
    })

    // Emit with a delta
    const delta = { kind: "fields", fields: { x: { kind: "replace", value: 42 } } }
    for (const listener of listeners) {
      listener({ prev: { x: 1 }, next: { x: 42 }, delta })
    }

    expect(received).toHaveLength(1)
    expect(received[0]!.delta).toBe(delta) // delta is passed through by reference
  })

  it("unsubscribe stops receiving updates", () => {
    const signal = createSignal({ name: "Alice" })
    const stream = toUpdateStream(signal)
    const nameStream = mapUpdate(stream, (m) => m.name)

    const received: string[] = []
    const unsub = nameStream.subscribe((u) => {
      received.push(u.next)
    })

    signal.setValue({ name: "Bob" })
    expect(received).toEqual(["Bob"])

    unsub()
    signal.setValue({ name: "Charlie" })
    expect(received).toEqual(["Bob"]) // no new entry
  })
})

// ---------------------------------------------------------------------------
// mergeUpdates()
// ---------------------------------------------------------------------------

describe("mergeUpdates", () => {
  it("merges emissions from multiple streams", () => {
    const signal1 = createSignal(1)
    const signal2 = createSignal(100)
    const stream1 = toUpdateStream(signal1)
    const stream2 = toUpdateStream(signal2)
    const merged = mergeUpdates(stream1, stream2)

    const received: Update<number>[] = []
    merged.subscribe((u) => {
      received.push({ prev: u.prev, next: u.next })
    })

    signal1.setValue(2)
    expect(received).toHaveLength(1)
    expect(received[0]!).toEqual({ prev: 1, next: 2 })

    signal2.setValue(200)
    expect(received).toHaveLength(2)
    expect(received[1]!).toEqual({ prev: 100, next: 200 })
  })

  it("unsubscribe stops all inner subscriptions", () => {
    const signal1 = createSignal("a")
    const signal2 = createSignal("x")
    const merged = mergeUpdates(toUpdateStream(signal1), toUpdateStream(signal2))

    const received: string[] = []
    const unsub = merged.subscribe((u) => {
      received.push(u.next)
    })

    signal1.setValue("b")
    signal2.setValue("y")
    expect(received).toEqual(["b", "y"])

    unsub()

    signal1.setValue("c")
    signal2.setValue("z")
    expect(received).toEqual(["b", "y"]) // no new entries
  })

  it("works with a single stream", () => {
    const signal = createSignal(0)
    const merged = mergeUpdates(toUpdateStream(signal))

    const received: number[] = []
    merged.subscribe((u) => received.push(u.next))

    signal.setValue(1)
    expect(received).toEqual([1])
  })
})

// ---------------------------------------------------------------------------
// contramapDispatcher()
// ---------------------------------------------------------------------------

describe("contramapDispatcher", () => {
  it("transforms the message type before dispatching", () => {
    const received: Array<{ type: string; value: number }> = []
    const parentDispatcher: Dispatcher<{ type: string; value: number }> = (msg) => {
      received.push(msg)
    }

    const childDispatcher = contramapDispatcher(
      parentDispatcher,
      (n: number) => ({ type: "increment", value: n }),
    )

    childDispatcher(5)
    childDispatcher(10)

    expect(received).toEqual([
      { type: "increment", value: 5 },
      { type: "increment", value: 10 },
    ])
  })

  it("composes contravariantly (inner transformation applied first)", () => {
    const received: string[] = []
    const dispatcher: Dispatcher<string> = (msg) => received.push(msg)

    // number -> string -> collected
    const numDispatcher = contramapDispatcher(dispatcher, (n: number) => `num:${n}`)
    // boolean -> number -> string -> collected
    const boolDispatcher = contramapDispatcher(numDispatcher, (b: boolean) => (b ? 1 : 0))

    boolDispatcher(true)
    boolDispatcher(false)

    expect(received).toEqual(["num:1", "num:0"])
  })

  it("preserves identity when mapping with id", () => {
    const received: number[] = []
    const dispatcher: Dispatcher<number> = (msg) => received.push(msg)
    const mapped = contramapDispatcher(dispatcher, (n: number) => n)

    mapped(42)
    expect(received).toEqual([42])
  })
})
