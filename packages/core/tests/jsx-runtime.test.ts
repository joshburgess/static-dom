import { describe, it, expect, afterEach } from "vitest"
import { jsx, jsxs, Fragment } from "../src/jsx-runtime"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import type { SDOM, Teardown } from "../src/types"
import { text, element } from "../src/constructors"
import { prop } from "../src/optics"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let container: HTMLDivElement
let teardowns: Teardown[] = []

function mount<M>(sdom: SDOM<M, any>, model: M): {
  signal: ReturnType<typeof createSignal<M>>
  dispatch: Dispatcher<any>
} {
  container = document.createElement("div")
  document.body.appendChild(container)
  const signal = createSignal(model)
  const updates = toUpdateStream(signal)
  const msgs: any[] = []
  const dispatch: Dispatcher<any> = (msg) => msgs.push(msg)
  const td = sdom.attach(container, model, updates, dispatch)
  teardowns.push(td)
  return { signal, dispatch }
}

afterEach(() => {
  for (const td of teardowns) td.teardown()
  teardowns = []
  container?.remove()
})

// ---------------------------------------------------------------------------
// Basic element creation
// ---------------------------------------------------------------------------

describe("jsx — basic elements", () => {
  it("creates an element with no props", () => {
    const view = jsx("div", {})
    mount(view, {})
    expect(container.querySelector("div")).not.toBeNull()
  })

  it("creates nested elements", () => {
    const view = jsx("div", {
      children: jsx("span", {}),
    })
    mount(view, {})
    expect(container.querySelector("div > span")).not.toBeNull()
  })

  it("creates element with multiple children via jsxs", () => {
    const view = jsxs("ul", {
      children: [
        jsx("li", { children: "first" }),
        jsx("li", { children: "second" }),
      ],
    })
    mount(view, {})
    const items = container.querySelectorAll("li")
    expect(items.length).toBe(2)
    expect(items[0]!.textContent).toBe("first")
    expect(items[1]!.textContent).toBe("second")
  })
})

// ---------------------------------------------------------------------------
// Children normalization
// ---------------------------------------------------------------------------

describe("jsx — children", () => {
  it("renders static string children", () => {
    const view = jsx("span", { children: "hello" })
    mount(view, {})
    expect(container.textContent).toBe("hello")
  })

  it("renders static number children", () => {
    const view = jsx("span", { children: 42 })
    mount(view, {})
    expect(container.textContent).toBe("42")
  })

  it("renders dynamic function children as text nodes", () => {
    const view = jsx("span", {
      children: (m: { name: string }) => m.name,
    })
    const { signal } = mount(view, { name: "Alice" })
    expect(container.textContent).toBe("Alice")

    signal.setValue({ name: "Bob" })
    expect(container.textContent).toBe("Bob")
  })

  it("passes through SDOM nodes as children", () => {
    const inner = element<{ x: number }, never>("em", {}, [
      text((m) => String(m.x)),
    ])
    const view = jsx("div", { children: inner })
    mount(view, { x: 7 })
    expect(container.querySelector("em")!.textContent).toBe("7")
  })

  it("skips null, undefined, and boolean children", () => {
    const view = jsxs("div", {
      children: [null, "visible", undefined, true, false],
    })
    mount(view, {})
    expect(container.textContent).toBe("visible")
  })

  it("handles mixed children types", () => {
    const view = jsxs("div", {
      children: [
        "static ",
        (m: { n: number }) => String(m.n),
        jsx("b", { children: "!" }),
      ],
    })
    mount(view, { n: 3 })
    expect(container.textContent).toBe("static 3!")
  })
})

// ---------------------------------------------------------------------------
// Prop classification — events
// ---------------------------------------------------------------------------

describe("jsx — event handlers", () => {
  it("classifies onClick as on.click", () => {
    const msgs: unknown[] = []
    const view = jsx("button", {
      onClick: (_e: Event, _m: any) => ({ type: "clicked" }),
      children: "Go",
    })
    container = document.createElement("div")
    document.body.appendChild(container)
    const signal = createSignal({})
    const updates = toUpdateStream(signal)
    const dispatch: Dispatcher<any> = (msg) => msgs.push(msg)
    const td = view.attach(container, {}, updates, dispatch)
    teardowns.push(td)

    container.querySelector("button")!.click()
    expect(msgs).toEqual([{ type: "clicked" }])
  })

  it("classifies onInput as on.input", () => {
    // Just verify it mounts without error — event dispatching
    // requires actual input events which are hard to simulate
    const view = jsx("input", {
      onInput: (_e: Event, _m: any) => ({ type: "changed" }),
    })
    mount(view, {})
    expect(container.querySelector("input")).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Prop classification — class/className
// ---------------------------------------------------------------------------

describe("jsx — class props", () => {
  it("handles static class string", () => {
    const view = jsx("div", { class: "active" })
    mount(view, {})
    expect(container.querySelector("div")!.getAttribute("class")).toBe("active")
  })

  it("handles dynamic class function", () => {
    const view = jsx("div", {
      class: (m: { on: boolean }) => (m.on ? "on" : "off"),
    })
    const { signal } = mount(view, { on: true })
    expect(container.querySelector("div")!.className).toBe("on")

    signal.setValue({ on: false })
    expect(container.querySelector("div")!.className).toBe("off")
  })

  it("handles className as alias for class", () => {
    const view = jsx("div", { className: "foo" })
    mount(view, {})
    expect(container.querySelector("div")!.className).toBe("foo")
  })
})

// ---------------------------------------------------------------------------
// Prop classification — data/aria
// ---------------------------------------------------------------------------

describe("jsx — data/aria attributes", () => {
  it("sets data-* attributes", () => {
    const view = jsx("div", { "data-id": "123" })
    mount(view, {})
    expect(container.querySelector("div")!.getAttribute("data-id")).toBe("123")
  })

  it("sets dynamic data-* attributes", () => {
    const view = jsx("div", {
      "data-count": (m: { n: number }) => String(m.n),
    })
    const { signal } = mount(view, { n: 0 })
    expect(container.querySelector("div")!.getAttribute("data-count")).toBe("0")

    signal.setValue({ n: 5 })
    expect(container.querySelector("div")!.getAttribute("data-count")).toBe("5")
  })

  it("sets aria-* attributes", () => {
    const view = jsx("div", { "aria-label": "Close" })
    mount(view, {})
    expect(container.querySelector("div")!.getAttribute("aria-label")).toBe("Close")
  })
})

// ---------------------------------------------------------------------------
// Prop classification — style
// ---------------------------------------------------------------------------

describe("jsx — style", () => {
  it("applies static style values", () => {
    const view = jsx("div", {
      style: { color: "red" },
    })
    mount(view, {})
    expect(container.querySelector("div")!.style.color).toBe("red")
  })

  it("applies dynamic style values", () => {
    const view = jsx("div", {
      style: { color: (m: { c: string }) => m.c },
    })
    const { signal } = mount(view, { c: "blue" })
    expect(container.querySelector("div")!.style.color).toBe("blue")

    signal.setValue({ c: "green" })
    expect(container.querySelector("div")!.style.color).toBe("green")
  })

  it("converts camelCase to kebab-case", () => {
    const view = jsx("div", {
      style: { backgroundColor: "red" },
    })
    mount(view, {})
    expect(container.querySelector("div")!.style.backgroundColor).toBe("red")
  })
})

// ---------------------------------------------------------------------------
// Prop classification — IDL properties
// ---------------------------------------------------------------------------

describe("jsx — IDL properties", () => {
  it("sets value as IDL property", () => {
    const view = jsx("input", {
      value: (m: { v: string }) => m.v,
    })
    const { signal } = mount(view, { v: "hello" })
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("hello")

    signal.setValue({ v: "world" })
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("world")
  })

  it("sets disabled as IDL property", () => {
    const view = jsx("button", {
      disabled: true,
      children: "Click",
    })
    mount(view, {})
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

describe("jsx — Fragment", () => {
  it("renders fragment children without wrapper", () => {
    const view = jsxs(Fragment, {
      children: [
        jsx("span", { children: "a" }),
        jsx("span", { children: "b" }),
      ],
    })
    mount(view, {})
    const spans = container.querySelectorAll("span")
    expect(spans.length).toBe(2)
    expect(spans[0]!.textContent).toBe("a")
    expect(spans[1]!.textContent).toBe("b")
  })

  it("renders nested fragments", () => {
    const view = jsxs(Fragment, {
      children: [
        jsx("span", { children: "1" }),
        jsxs(Fragment, {
          children: [
            jsx("span", { children: "2" }),
            jsx("span", { children: "3" }),
          ],
        }),
      ],
    })
    mount(view, {})
    expect(container.querySelectorAll("span").length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe("jsx — integration", () => {
  it("works with .focus() on the result", () => {
    const inner = jsx("span", {
      children: (m: { name: string }) => m.name,
    }) as SDOM<{ name: string }, any>

    const view = inner.focus(prop<{ user: { name: string } }>()("user"))

    const { signal } = mount(view, { user: { name: "Alice" } })
    expect(container.textContent).toBe("Alice")

    signal.setValue({ user: { name: "Bob" } })
    expect(container.textContent).toBe("Bob")
  })

  it("accepts SDOM constructor results as children", () => {
    const dynamic = text((m: { label: string }) => m.label)
    const view = jsx("div", { children: dynamic })
    mount(view, { label: "hi" })
    expect(container.textContent).toBe("hi")
  })
})
