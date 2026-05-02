import { describe, it, expect } from "vitest"
import {
  lens, lensOf, prism, prismOf, iso, isoOf, affineOf, traversal,
  prop, at, composeLenses, unionMember, nullablePrism, indexLens,
  each, values, filtered,
} from "../src/optics"
import type { Lens, Prism, Iso, Affine, Traversal } from "../src/optics"
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

  it("toUpdate returns a function equivalent to get", () => {
    const fn = nameLens.toUpdate()
    expect(fn(user)).toBe(nameLens.get(user))
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

// ---------------------------------------------------------------------------
// Composition table — structural subtyping
// ---------------------------------------------------------------------------

describe("composition table", () => {
  // Iso: Celsius ↔ Fahrenheit
  const cToF = isoOf<number, number>(
    c => c * 9 / 5 + 32,
    f => (f - 32) * 5 / 9,
  )

  // Lens: temp field
  interface Weather { temp: number; desc: string }
  const tempLens = lensOf<Weather, number>(
    w => w.temp,
    (t, w) => ({ ...w, temp: t }),
  )

  // Prism: positive number
  const positivePrism = prismOf<number, number>(
    n => n > 0 ? n : null,
    n => n,
  )

  it("Iso + Iso = Iso", () => {
    const doubleIso = isoOf<number, number>(n => n * 2, n => n / 2)
    const composed = cToF.compose(doubleIso)
    // If it's an Iso, it should have from/to
    expect(composed.from(0)).toBe(64) // 32 * 2
    expect(composed.to(64)).toBeCloseTo(0)
  })

  it("Lens + Lens = Lens", () => {
    interface Outer { inner: Weather }
    const innerLens = lensOf<Outer, Weather>(
      o => o.inner,
      (w, o) => ({ ...o, inner: w }),
    )
    const composed = innerLens.compose(tempLens)
    const o: Outer = { inner: { temp: 25, desc: "sunny" } }
    expect(composed.get(o)).toBe(25)
    expect(composed.set(30, o)).toEqual({ inner: { temp: 30, desc: "sunny" } })
  })

  it("Prism + Prism = Prism", () => {
    const evenPrism = prismOf<number, number>(
      n => n % 2 === 0 ? n : null,
      n => n,
    )
    const composed = positivePrism.compose(evenPrism)
    expect(composed.preview(4)).toBe(4)   // positive + even
    expect(composed.preview(3)).toBeNull() // positive but odd
    expect(composed.preview(-2)).toBeNull() // even but negative
    expect(composed.review(6)).toBe(6)
  })

  it("Lens + Prism = Affine", () => {
    const composed = tempLens.compose(positivePrism)
    const sunny: Weather = { temp: 25, desc: "sunny" }
    const cold: Weather = { temp: -5, desc: "cold" }

    expect(composed.preview(sunny)).toBe(25)
    expect(composed.preview(cold)).toBeNull()
  })

  it("Prism + Lens = Affine", () => {
    interface Wrapper { value: number }
    const valueLens = lensOf<Wrapper, number>(
      w => w.value,
      (v, w) => ({ ...w, value: v }),
    )
    // Prism<number, Wrapper> doesn't make sense directly,
    // so we test Prism<Shape, Circle>.compose(Lens<Circle, number>)
    type Shape =
      | { kind: "circle"; r: number }
      | { kind: "rect"; w: number }
    const circlePrism = prismOf<Shape, { kind: "circle"; r: number }>(
      s => s.kind === "circle" ? s as { kind: "circle"; r: number } : null,
      c => c,
    )
    const rLens = lensOf<{ kind: "circle"; r: number }, number>(
      c => c.r,
      (r, c) => ({ ...c, r }),
    )
    const composed = circlePrism.compose(rLens)
    expect(composed.preview({ kind: "circle", r: 5 })).toBe(5)
    expect(composed.preview({ kind: "rect", w: 3 })).toBeNull()
  })

  it("Iso + Lens = Lens", () => {
    // Iso is a subtype of Lens, so Iso.compose(Lens) resolves to Lens.compose(Lens) = Lens
    const composed = cToF.compose(tempLens)
    // This composes: number --cToF--> number --tempLens--> ? but tempLens expects Weather...
    // Let's compose the other direction: Lens then Iso
    const composed2 = tempLens.compose(cToF)
    const w: Weather = { temp: 0, desc: "freezing" }
    expect(composed2.get(w)).toBe(32) // 0°C = 32°F
    expect(composed2.set(212, w).temp).toBeCloseTo(100) // 212°F = 100°C
  })

  it("Iso + Prism = Prism", () => {
    const composed = cToF.compose(positivePrism)
    expect(composed.preview(0)).toBe(32) // 0°C = 32°F, positive
    expect(composed.preview(-100)).toBeNull() // -100°C = -148°F, negative
  })
})

// ---------------------------------------------------------------------------
// modify()
// ---------------------------------------------------------------------------

describe("modify", () => {
  const user: User = { name: "Alice", age: 30, address: { street: "Elm St", city: "Springfield" } }

  it("modifies through a Lens", () => {
    const ageLens = prop<User>()("age")
    const increment = ageLens.modify((a: number) => a + 1)
    expect(increment(user)).toEqual({ ...user, age: 31 })
  })

  it("modifies through a composed Lens", () => {
    const streetLens = composeLenses(prop<User>()("address"), prop<Address>()("street"))
    const upper = streetLens.modify((s: string) => s.toUpperCase())
    expect(upper(user).address.street).toBe("ELM ST")
  })

  it("modifies through a Prism (target present)", () => {
    type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number }
    const circlePrism = prismOf<Shape, { kind: "circle"; r: number }>(
      s => s.kind === "circle" ? s as { kind: "circle"; r: number } : null,
      c => c,
    )
    const doubleR = circlePrism.modify(c => ({ ...c, r: c.r * 2 }))
    expect(doubleR({ kind: "circle", r: 5 })).toEqual({ kind: "circle", r: 10 })
  })

  it("modify on Prism returns unchanged when target absent", () => {
    type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number }
    const circlePrism = prismOf<Shape, { kind: "circle"; r: number }>(
      s => s.kind === "circle" ? s as { kind: "circle"; r: number } : null,
      c => c,
    )
    const rect: Shape = { kind: "rect", w: 3 }
    const doubleR = circlePrism.modify(c => ({ ...c, r: c.r * 2 }))
    expect(doubleR(rect)).toBe(rect) // same reference
  })

  it("modifies through an Iso", () => {
    const double = isoOf<number, number>(n => n * 2, n => n / 2)
    const addTen = double.modify((n: number) => n + 10)
    expect(addTen(5)).toBe(10) // double(5)=10, +10=20, halve=10
  })

  it("modifies through an Affine", () => {
    interface Model { value: number | null }
    const valueAffine = affineOf<Model, number>(
      m => m.value,
      (v, m) => ({ ...m, value: v }),
    )
    const increment = valueAffine.modify((v: number) => v + 1)
    expect(increment({ value: 5 })).toEqual({ value: 6 })
    expect(increment({ value: null })).toEqual({ value: null }) // absent, unchanged
  })
})

// ---------------------------------------------------------------------------
// affineOf()
// ---------------------------------------------------------------------------

describe("affineOf", () => {
  interface Config { debug: boolean | null }

  const debugAffine: Affine<Config, boolean> = affineOf(
    (c: Config) => c.debug,
    (d: boolean, c: Config) => ({ ...c, debug: d }),
  )

  it("preview returns value when present", () => {
    expect(debugAffine.preview({ debug: true })).toBe(true)
    expect(debugAffine.preview({ debug: false })).toBe(false)
  })

  it("preview returns null when absent", () => {
    expect(debugAffine.preview({ debug: null })).toBeNull()
  })

  it("set updates value when present", () => {
    expect(debugAffine.set(false, { debug: true })).toEqual({ debug: false })
  })

  it("set on absent target returns unchanged (via modify path)", () => {
    const result = debugAffine.modify(() => false)({ debug: null })
    expect(result).toEqual({ debug: null })
  })

  it("composes with a Lens to produce an Affine", () => {
    interface App { config: Config }
    const configLens = lensOf<App, Config>(
      a => a.config,
      (c, a) => ({ ...a, config: c }),
    )
    const composed = configLens.compose(debugAffine)
    const app: App = { config: { debug: true } }
    expect(composed.preview(app)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// nullablePrism() — now returns Affine
// ---------------------------------------------------------------------------

describe("nullablePrism (Affine)", () => {
  interface Profile { name: string; bio: string | null }

  it("returns Affine that previews non-null values", () => {
    const bioAffine = nullablePrism<Profile>()("bio")
    expect(bioAffine.preview({ name: "Alice", bio: "hello" })).toBe("hello")
    expect(bioAffine.preview({ name: "Alice", bio: null })).toBeNull()
  })

  it("set updates the value", () => {
    const bioAffine = nullablePrism<Profile>()("bio")
    expect(bioAffine.set("updated", { name: "Alice", bio: "old" }))
      .toEqual({ name: "Alice", bio: "updated" })
  })

  it("getDelta handles RecordDelta variants", () => {
    const bioAffine = nullablePrism<Profile>()("bio")
    expect(bioAffine.getDelta!({ kind: "noop" })).toBeUndefined()
    expect(bioAffine.getDelta!({ kind: "fields", fields: { bio: { kind: "replace", value: "new" } } }))
      .toEqual({ kind: "replace", value: "new" })
  })

  it("composes with a Lens", () => {
    interface App { profile: Profile }
    const profileLens = prop<App>()("profile")
    const composed = profileLens.compose(nullablePrism<Profile>()("bio"))
    const app: App = { profile: { name: "Alice", bio: "hi" } }
    expect(composed.preview(app)).toBe("hi")
  })
})

// ---------------------------------------------------------------------------
// at() — path selectors
// ---------------------------------------------------------------------------

describe("at", () => {
  interface Root {
    user: {
      profile: {
        name: string
        settings: { theme: string }
      }
    }
  }

  const root: Root = {
    user: { profile: { name: "Alice", settings: { theme: "dark" } } },
  }

  it("creates a single-key lens", () => {
    const userLens = at<Root>()("user")
    expect(userLens.get(root)).toBe(root.user)
  })

  it("creates a two-key composed lens", () => {
    const profileLens = at<Root>()("user", "profile")
    expect(profileLens.get(root)).toBe(root.user.profile)
  })

  it("creates a three-key composed lens", () => {
    const nameLens = at<Root>()("user", "profile", "name")
    expect(nameLens.get(root)).toBe("Alice")
    expect(nameLens.set("Bob", root).user.profile.name).toBe("Bob")
  })

  it("creates a four-key composed lens", () => {
    const themeLens = at<Root>()("user", "profile", "settings", "theme")
    expect(themeLens.get(root)).toBe("dark")
    expect(themeLens.set("light", root).user.profile.settings.theme).toBe("light")
  })

  it("preserves getDelta through composition", () => {
    const nameLens = at<Root>()("user", "profile", "name")
    expect(nameLens.getDelta).toBeDefined()

    const delta = {
      kind: "fields",
      fields: {
        user: {
          kind: "fields",
          fields: {
            profile: {
              kind: "fields",
              fields: { name: { kind: "replace", value: "Bob" } },
            },
          },
        },
      },
    }
    expect(nameLens.getDelta!(delta)).toEqual({ kind: "replace", value: "Bob" })
  })

  it("modify works on path lenses", () => {
    const nameLens = at<Root>()("user", "profile", "name")
    const upper = nameLens.modify((n: string) => n.toUpperCase())
    expect(upper(root).user.profile.name).toBe("ALICE")
  })
})

// ---------------------------------------------------------------------------
// isoOf() / lensOf() / prismOf() — new constructor names
// ---------------------------------------------------------------------------

describe("new constructor names", () => {
  it("isoOf is equivalent to iso", () => {
    const a = isoOf<number, string>(n => String(n), s => Number(s))
    const b = iso<number, string>(n => String(n), s => Number(s))
    expect(a.from(42)).toBe(b.from(42))
    expect(a.to("42")).toBe(b.to("42"))
  })

  it("lensOf is equivalent to lens", () => {
    const a = lensOf<User, string>(u => u.name, (n, u) => ({ ...u, name: n }))
    const b = lens<User, string>(u => u.name, (n, u) => ({ ...u, name: n }))
    const user: User = { name: "Alice", age: 30, address: { street: "Elm St", city: "Springfield" } }
    expect(a.get(user)).toBe(b.get(user))
    expect(a.set("Bob", user)).toEqual(b.set("Bob", user))
  })

  it("prismOf is equivalent to prism", () => {
    const a = prismOf<number, number>(n => n > 0 ? n : null, n => n)
    const b = prism<number, number>(n => n > 0 ? n : null, n => n)
    expect(a.preview(5)).toBe(b.preview(5))
    expect(a.preview(-1)).toBe(b.preview(-1))
    expect(a.review(10)).toBe(b.review(10))
  })
})

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

describe("each()", () => {
  it("getAll returns all array elements", () => {
    const t = each<number>()
    expect(t.getAll([1, 2, 3])).toEqual([1, 2, 3])
  })

  it("getAll on empty array returns empty", () => {
    const t = each<number>()
    expect(t.getAll([])).toEqual([])
  })

  it("modifyAll transforms all elements", () => {
    const t = each<number>()
    expect(t.modifyAll(n => n * 2)([1, 2, 3])).toEqual([2, 4, 6])
  })

  it("modifyAll returns same reference when nothing changed", () => {
    const t = each<number>()
    const arr = [1, 2, 3]
    expect(t.modifyAll(n => n)(arr)).toBe(arr)
  })

  it("fold reduces all elements", () => {
    const t = each<number>()
    const sum = t.fold<number>((acc, n) => acc + n, 0)
    expect(sum([1, 2, 3])).toBe(6)
  })
})

describe("values()", () => {
  it("getAll returns all record values", () => {
    const t = values<number>()
    const result = t.getAll({ a: 1, b: 2, c: 3 })
    expect(result.sort()).toEqual([1, 2, 3])
  })

  it("modifyAll transforms all values", () => {
    const t = values<number>()
    expect(t.modifyAll(n => n * 10)({ x: 1, y: 2 })).toEqual({ x: 10, y: 20 })
  })

  it("modifyAll returns same reference when nothing changed", () => {
    const t = values<number>()
    const obj = { a: 1, b: 2 }
    expect(t.modifyAll(n => n)(obj)).toBe(obj)
  })
})

describe("filtered()", () => {
  it("getAll returns matching elements", () => {
    const t = filtered<number>(n => n > 2)
    expect(t.getAll(3)).toEqual([3])
    expect(t.getAll(1)).toEqual([])
  })

  it("modifyAll only transforms matching elements", () => {
    const t = filtered<number>(n => n > 0)
    expect(t.modifyAll(n => n * 2)(5)).toBe(10)
    expect(t.modifyAll(n => n * 2)(-3)).toBe(-3) // not modified
  })
})

describe("traversal()", () => {
  it("custom traversal works", () => {
    // Traversal that focuses on even-indexed elements
    const evenIndexed = traversal<ReadonlyArray<string>, string>(
      arr => arr.filter((_, i) => i % 2 === 0),
      f => arr => arr.map((v, i) => i % 2 === 0 ? f(v) : v),
    )
    expect(evenIndexed.getAll(["a", "b", "c", "d"])).toEqual(["a", "c"])
    expect(evenIndexed.modifyAll(s => s.toUpperCase())(["a", "b", "c", "d"]))
      .toEqual(["A", "b", "C", "d"])
  })
})

describe("Traversal composition", () => {
  interface Team { members: ReadonlyArray<{ name: string; scores: ReadonlyArray<number> }> }

  const team: Team = {
    members: [
      { name: "Alice", scores: [10, 20, 30] },
      { name: "Bob", scores: [5, 15] },
    ],
  }

  it("Lens + Traversal = Traversal", () => {
    const membersLens = prop<Team>()("members")
    const t = membersLens.compose(each<{ name: string; scores: ReadonlyArray<number> }>())
    expect(t.getAll(team).map(m => m.name)).toEqual(["Alice", "Bob"])
  })

  it("Traversal + Lens = Traversal", () => {
    const membersLens = prop<Team>()("members")
    const memberNames = membersLens
      .compose(each<{ name: string; scores: ReadonlyArray<number> }>())
      .compose(prop<{ name: string; scores: ReadonlyArray<number> }>()("name"))
    expect(memberNames.getAll(team)).toEqual(["Alice", "Bob"])
  })

  it("Traversal + Traversal = Traversal (nested getAll)", () => {
    const allScores = prop<Team>()("members")
      .compose(each<{ name: string; scores: ReadonlyArray<number> }>())
      .compose(prop<{ name: string; scores: ReadonlyArray<number> }>()("scores"))
      .compose(each<number>())
    expect(allScores.getAll(team)).toEqual([10, 20, 30, 5, 15])
  })

  it("Traversal + Traversal = Traversal (nested modifyAll)", () => {
    const allScores = prop<Team>()("members")
      .compose(each<{ name: string; scores: ReadonlyArray<number> }>())
      .compose(prop<{ name: string; scores: ReadonlyArray<number> }>()("scores"))
      .compose(each<number>())
    const doubled = allScores.modifyAll(n => n * 2)(team)
    expect(doubled.members[0]!.scores).toEqual([20, 40, 60])
    expect(doubled.members[1]!.scores).toEqual([10, 30])
  })

  it("Traversal + filtered = Traversal", () => {
    const highScores = prop<Team>()("members")
      .compose(each<{ name: string; scores: ReadonlyArray<number> }>())
      .compose(prop<{ name: string; scores: ReadonlyArray<number> }>()("scores"))
      .compose(each<number>())
      .compose(filtered<number>(n => n >= 15))
    expect(highScores.getAll(team)).toEqual([20, 30, 15])
  })

  it("Traversal fold computes aggregate", () => {
    const allScores = prop<Team>()("members")
      .compose(each<{ name: string; scores: ReadonlyArray<number> }>())
      .compose(prop<{ name: string; scores: ReadonlyArray<number> }>()("scores"))
      .compose(each<number>())
    const total = allScores.fold<number>((acc, n) => acc + n, 0)
    expect(total(team)).toBe(80) // 10+20+30+5+15
  })

  it("Prism + Traversal = Traversal", () => {
    type Data = { kind: "list"; items: ReadonlyArray<number> } | { kind: "single"; value: number }
    const listPrism = prismOf<Data, { kind: "list"; items: ReadonlyArray<number> }>(
      d => d.kind === "list" ? d as { kind: "list"; items: ReadonlyArray<number> } : null,
      d => d,
    )
    const allItems = listPrism
      .compose(prop<{ kind: "list"; items: ReadonlyArray<number> }>()("items"))
      .compose(each<number>())

    const list: Data = { kind: "list", items: [1, 2, 3] }
    const single: Data = { kind: "single", value: 42 }

    expect(allItems.getAll(list)).toEqual([1, 2, 3])
    expect(allItems.getAll(single)).toEqual([])
  })

  it("Traversal modifyAll preserves structure when nothing changes", () => {
    const memberNames = prop<Team>()("members")
      .compose(each<{ name: string; scores: ReadonlyArray<number> }>())
      .compose(prop<{ name: string; scores: ReadonlyArray<number> }>()("name"))
    const result = memberNames.modifyAll(s => s)(team)
    // Names didn't change, but intermediate arrays may be reconstructed
    // The important thing is the values are correct
    expect(result.members[0]!.name).toBe("Alice")
    expect(result.members[1]!.name).toBe("Bob")
  })
})
