import { describe, it, expect, afterEach } from "vitest"
import { jsx, jsxs, Show, For, Optional } from "../src/jsx-runtime"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import type { SDOM, Teardown, KeyedItem } from "../src/types"
import { nullablePrism } from "../src/optics"
import { text } from "../src/constructors"

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
// Function component support
// ---------------------------------------------------------------------------

describe("jsx — function components", () => {
  it("calls function components with props", () => {
    function Greeting(props: { children?: unknown }) {
      return jsx("h1", { children: props.children })
    }

    const view = jsx(Greeting, { children: "Hello!" })
    mount(view, {})
    expect(container.querySelector("h1")!.textContent).toBe("Hello!")
  })

  it("passes all props to function components", () => {
    function Badge(props: { label: string; children?: unknown }) {
      return jsx("span", {
        "data-label": props.label,
        children: props.label,
      })
    }

    const view = jsx(Badge, { label: "new" })
    mount(view, {})
    expect(container.querySelector("span")!.textContent).toBe("new")
    expect(container.querySelector("span")!.getAttribute("data-label")).toBe("new")
  })
})

// ---------------------------------------------------------------------------
// Show component
// ---------------------------------------------------------------------------

describe("Show", () => {
  it("shows children when predicate is true", () => {
    const view = jsx(Show, {
      when: (m: { visible: boolean }) => m.visible,
      children: jsx("div", { children: "content" }),
    })
    mount(view, { visible: true })
    expect(container.textContent).toBe("content")
    // The wrapper span should be visible
    const wrapper = container.querySelector("span")
    expect(wrapper!.style.display).toBe("")
  })

  it("hides children when predicate is false", () => {
    const view = jsx(Show, {
      when: (m: { visible: boolean }) => m.visible,
      children: jsx("div", { children: "content" }),
    })
    mount(view, { visible: false })
    const wrapper = container.querySelector("span")
    expect(wrapper!.style.display).toBe("none")
  })

  it("toggles visibility on model update", () => {
    const view = jsx(Show, {
      when: (m: { visible: boolean }) => m.visible,
      children: jsx("div", { children: "content" }),
    })
    const { signal } = mount(view, { visible: true })
    expect(container.querySelector("span")!.style.display).toBe("")

    signal.setValue({ visible: false })
    expect(container.querySelector("span")!.style.display).toBe("none")

    signal.setValue({ visible: true })
    expect(container.querySelector("span")!.style.display).toBe("")
  })

  it("handles multiple children", () => {
    const view = jsxs(Show, {
      when: () => true,
      children: [
        jsx("em", { children: "a" }),
        jsx("em", { children: "b" }),
      ],
    })
    mount(view, {})
    // showIf wraps in a <span>, and the two children are <em>
    expect(container.querySelectorAll("em").length).toBe(2)
    expect(container.textContent).toBe("ab")
  })
})

// ---------------------------------------------------------------------------
// For component
// ---------------------------------------------------------------------------

describe("For", () => {
  it("renders a keyed list", () => {
    type Model = { items: Array<{ id: string; text: string }> }

    const view = jsx(For, {
      each: (m: Model) => m.items.map(i => ({ key: i.id, model: i })),
      tag: "ul",
      children: jsx("li", {
        children: (m: { id: string; text: string }) => m.text,
      }),
    })

    mount(view, {
      items: [
        { id: "1", text: "first" },
        { id: "2", text: "second" },
      ],
    })

    const lis = container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("first")
    expect(lis[1]!.textContent).toBe("second")
  })

  it("updates items on model change", () => {
    type Model = { items: Array<{ id: string; text: string }> }

    const view = jsx(For, {
      each: (m: Model) => m.items.map(i => ({ key: i.id, model: i })),
      tag: "ul",
      children: jsx("li", {
        children: (m: { id: string; text: string }) => m.text,
      }),
    })

    const { signal } = mount(view, {
      items: [{ id: "1", text: "one" }],
    })

    expect(container.querySelectorAll("li").length).toBe(1)

    signal.setValue({
      items: [
        { id: "1", text: "one" },
        { id: "2", text: "two" },
      ],
    })

    expect(container.querySelectorAll("li").length).toBe(2)
  })

  it("defaults to div container when no tag specified", () => {
    const view = jsx(For, {
      each: () => [{ key: "a", model: { x: 1 } }],
      children: jsx("span", { children: "item" }),
    })
    mount(view, {})
    // The For creates a div container, which contains the item
    expect(container.querySelector("div > span")).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Optional component
// ---------------------------------------------------------------------------

describe("Optional", () => {
  it("renders children when prism matches", () => {
    type Model = { user: { name: string } | null }

    const view = jsx(Optional, {
      prism: nullablePrism<Model>()("user"),
      children: jsx("span", {
        children: (m: { name: string }) => m.name,
      }),
    })

    mount(view, { user: { name: "Alice" } })
    expect(container.querySelector("span")!.textContent).toBe("Alice")
  })

  it("renders nothing when prism doesn't match", () => {
    type Model = { user: { name: string } | null }

    const view = jsx(Optional, {
      prism: nullablePrism<Model>()("user"),
      children: jsx("span", { children: "content" }),
    })

    mount(view, { user: null })
    expect(container.querySelector("span")).toBeNull()
  })

  it("mounts/unmounts on model change", () => {
    type Model = { user: { name: string } | null }

    const view = jsx(Optional, {
      prism: nullablePrism<Model>()("user"),
      children: jsx("span", {
        children: (m: { name: string }) => m.name,
      }),
    })

    const { signal } = mount(view, { user: null } as Model)
    expect(container.querySelector("span")).toBeNull()

    signal.setValue({ user: { name: "Bob" } })
    expect(container.querySelector("span")!.textContent).toBe("Bob")

    signal.setValue({ user: null })
    expect(container.querySelector("span")).toBeNull()
  })
})
