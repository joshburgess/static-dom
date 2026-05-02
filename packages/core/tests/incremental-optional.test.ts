import { describe, it, expect, afterEach } from "vitest"
import { optional, text, element } from "../src/constructors"
import { nullablePrism, prism } from "../src/optics"
import { createSignal, toUpdateStream } from "../src/observable"
import type { Teardown } from "../src/types"
import type { Observer, Update } from "../src/observable"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let container: HTMLDivElement
let teardowns: Teardown[] = []

function mount<M>(sdom: ReturnType<typeof optional>, model: M) {
  container = document.createElement("div")
  document.body.appendChild(container)
  const signal = createSignal(model)
  const updates = toUpdateStream(signal)
  const td = sdom.attach(container, model, updates, () => {})
  teardowns.push(td)
  return { signal }
}

/**
 * Create a custom update stream that carries deltas.
 */
function createDeltaStream<M>(initial: M) {
  const observers = new Set<Observer<Update<M>>>()
  const updates = {
    subscribe(obs: Observer<Update<M>>) {
      observers.add(obs)
      return () => { observers.delete(obs) }
    },
  }
  return {
    updates,
    push(prev: M, next: M, delta?: unknown) {
      for (const obs of observers) obs({ prev, next, delta })
    },
  }
}

afterEach(() => {
  for (const td of teardowns) td.teardown()
  teardowns = []
  container?.remove()
})

// ---------------------------------------------------------------------------
// nullablePrism getDelta
// ---------------------------------------------------------------------------

describe("nullablePrism getDelta", () => {
  it("returns undefined for noop delta", () => {
    const p = nullablePrism<{ user: { name: string } | null }>()("user")
    expect(p.getDelta!({ kind: "noop" })).toBeUndefined()
  })

  it("extracts field delta from fields variant", () => {
    const p = nullablePrism<{ user: { name: string } | null }>()("user")
    const delta = { kind: "fields", fields: { user: { kind: "replace", value: { name: "Bob" } } } }
    expect(p.getDelta!(delta)).toEqual({ kind: "replace", value: { name: "Bob" } })
  })

  it("returns undefined when field is absent from fields variant", () => {
    const p = nullablePrism<{ user: { name: string } | null; count: number }>()("user")
    const delta = { kind: "fields", fields: { count: { kind: "replace", value: 5 } } }
    expect(p.getDelta!(delta)).toBeUndefined()
  })

  it("extracts from replace variant", () => {
    const p = nullablePrism<{ user: { name: string } | null }>()("user")
    const delta = { kind: "replace", value: { user: { name: "Alice" } } }
    expect(p.getDelta!(delta)).toEqual({ kind: "replace", value: { name: "Alice" } })
  })
})

// ---------------------------------------------------------------------------
// optional with delta support
// ---------------------------------------------------------------------------

describe("optional — delta fast path", () => {
  it("skips mount/unmount check when delta says field unchanged", () => {
    type Model = { user: { name: string } | null; count: number }

    const p = nullablePrism<Model>()("user")
    const view = optional(p, text((m: { name: string }) => m.name))

    container = document.createElement("div")
    document.body.appendChild(container)

    const initial: Model = { user: { name: "Alice" }, count: 0 }
    const stream = createDeltaStream(initial)

    const td = view.attach(container, initial, stream.updates, () => {})
    teardowns.push(td)

    expect(container.textContent).toBe("Alice")

    // Update count only (user unchanged) — delta says user field not touched
    const next: Model = { user: { name: "Alice" }, count: 1 }
    stream.push(initial, next, { kind: "fields", fields: { count: { kind: "replace", value: 1 } } })

    // Content still shows Alice (was not remounted or modified)
    expect(container.textContent).toBe("Alice")
  })

  it("propagates inner delta to child when field changed", () => {
    type Model = { user: { name: string } | null; count: number }

    const p = nullablePrism<Model>()("user")
    const view = optional(p, text((m: { name: string }) => m.name))

    container = document.createElement("div")
    document.body.appendChild(container)

    const initial: Model = { user: { name: "Alice" }, count: 0 }
    const stream = createDeltaStream(initial)

    const td = view.attach(container, initial, stream.updates, () => {})
    teardowns.push(td)

    expect(container.textContent).toBe("Alice")

    // Update user — delta says user field changed
    const next: Model = { user: { name: "Bob" }, count: 0 }
    stream.push(initial, next, {
      kind: "fields",
      fields: { user: { kind: "replace", value: { name: "Bob" } } },
    })

    expect(container.textContent).toBe("Bob")
  })

  it("handles mount transition with delta", () => {
    type Model = { user: { name: string } | null }

    const p = nullablePrism<Model>()("user")
    const view = optional(p, text((m: { name: string }) => m.name))

    container = document.createElement("div")
    document.body.appendChild(container)

    const initial: Model = { user: null }
    const stream = createDeltaStream(initial)

    const td = view.attach(container, initial, stream.updates, () => {})
    teardowns.push(td)

    expect(container.textContent).toBe("")

    // user goes from null to present
    const next: Model = { user: { name: "Alice" } }
    stream.push(initial, next, {
      kind: "fields",
      fields: { user: { kind: "replace", value: { name: "Alice" } } },
    })

    expect(container.textContent).toBe("Alice")
  })

  it("handles unmount transition with delta", () => {
    type Model = { user: { name: string } | null }

    const p = nullablePrism<Model>()("user")
    const view = optional(p, text((m: { name: string }) => m.name))

    container = document.createElement("div")
    document.body.appendChild(container)

    const initial: Model = { user: { name: "Alice" } }
    const stream = createDeltaStream(initial)

    const td = view.attach(container, initial, stream.updates, () => {})
    teardowns.push(td)

    expect(container.textContent).toBe("Alice")

    // user goes from present to null
    const next: Model = { user: null }
    stream.push(initial, next, {
      kind: "fields",
      fields: { user: { kind: "replace", value: null } },
    })

    expect(container.textContent).toBe("")
  })

  it("falls back to reference equality without delta", () => {
    type Model = { user: { name: string } | null }

    const p = nullablePrism<Model>()("user")
    const view = optional(p, text((m: { name: string }) => m.name))

    const { signal } = mount(view, { user: { name: "Alice" } } as Model)
    expect(container.textContent).toBe("Alice")

    signal.setValue({ user: { name: "Bob" } })
    expect(container.textContent).toBe("Bob")

    signal.setValue({ user: null })
    expect(container.textContent).toBe("")
  })
})
