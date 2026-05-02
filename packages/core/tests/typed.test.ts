import { describe, it, expect, afterEach } from "vitest"
import { typed, Show, For, Optional } from "../src/jsx-runtime"
import { jsx } from "../src/jsx-runtime"
import { createSignal, toUpdateStream } from "../src/observable"
import type { SDOM, Teardown } from "../src/types"
import { nullablePrism } from "../src/optics"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let container: HTMLDivElement
let teardowns: Teardown[] = []

function mount<M>(sdom: SDOM<M, any>, model: M) {
  container = document.createElement("div")
  document.body.appendChild(container)
  const signal = createSignal(model)
  const updates = toUpdateStream(signal)
  const td = sdom.attach(container, model, updates, () => {})
  teardowns.push(td)
  return { signal }
}

afterEach(() => {
  for (const td of teardowns) td.teardown()
  teardowns = []
  container?.remove()
})

// ---------------------------------------------------------------------------
// typed()
// ---------------------------------------------------------------------------

describe("typed()", () => {
  it("returns the same SDOM node with asserted types", () => {
    type Model = { label: string }
    type Msg = { type: "click" }

    const raw = jsx("span", { children: (m: Model) => m.label })
    const view: SDOM<Model, Msg> = typed<Model, Msg>(raw)

    mount(view, { label: "hello" })
    expect(container.querySelector("span")!.textContent).toBe("hello")
  })

  it("preserves reactive updates through typed wrapper", () => {
    type Model = { count: number }

    const raw = jsx("span", { children: (m: Model) => String(m.count) })
    const view = typed<Model>(raw)

    const { signal } = mount(view, { count: 0 })
    expect(container.querySelector("span")!.textContent).toBe("0")

    signal.setValue({ count: 42 })
    expect(container.querySelector("span")!.textContent).toBe("42")
  })

  it("defaults Msg to never when not specified", () => {
    type Model = { x: number }
    // This should compile — Msg defaults to never
    const view: SDOM<Model, never> = typed<Model>(
      jsx("div", { children: "static" })
    )
    mount(view, { x: 1 })
    expect(container.textContent).toBe("static")
  })
})

// ---------------------------------------------------------------------------
// Generic Show
// ---------------------------------------------------------------------------

describe("Show — generic type parameter", () => {
  it("infers model type from when predicate", () => {
    type Model = { visible: boolean; label: string }

    // Show<Model> is inferred from the callback annotation
    const view = Show<Model>({
      when: m => m.visible,
      children: jsx("span", { children: (m: Model) => m.label }),
    })

    mount(view, { visible: true, label: "typed!" })
    expect(container.querySelector("span")!.textContent).toBe("typed!")
  })
})

// ---------------------------------------------------------------------------
// Generic For
// ---------------------------------------------------------------------------

describe("For — generic type parameters", () => {
  it("infers model and item types", () => {
    type Model = { items: Array<{ id: string; name: string }> }
    type Item = { id: string; name: string }

    const view = For<Model, Item>({
      each: m => m.items.map(i => ({ key: i.id, model: i })),
      tag: "ul",
      children: jsx("li", { children: (m: Item) => m.name }),
    })

    mount(view, {
      items: [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ],
    })

    const lis = container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("Alice")
  })
})

// ---------------------------------------------------------------------------
// Generic Optional
// ---------------------------------------------------------------------------

describe("Optional — generic type parameters", () => {
  it("infers source and focus types from prism", () => {
    type Model = { user: { name: string } | null }

    const view = Optional<Model, { name: string }>({
      prism: nullablePrism<Model>()("user"),
      children: jsx("span", {
        children: (m: { name: string }) => m.name,
      }),
    })

    mount(view, { user: { name: "Carol" } })
    expect(container.querySelector("span")!.textContent).toBe("Carol")
  })
})
