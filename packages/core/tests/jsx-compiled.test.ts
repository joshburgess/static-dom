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

function mountWithMsgs<M>(sdom: SDOM<M, any>, model: M) {
  container = document.createElement("div")
  document.body.appendChild(container)
  const signal = createSignal(model)
  const updates = toUpdateStream(signal)
  const msgs: any[] = []
  const dispatch: Dispatcher<any> = (msg) => msgs.push(msg)
  const td = sdom.attach(container, model, updates, dispatch)
  teardowns.push(td)
  return { signal, dispatch, msgs }
}

afterEach(() => {
  for (const td of teardowns) td.teardown()
  teardowns = []
  container?.remove()
})

// ---------------------------------------------------------------------------
// Compiled template verification
//
// These tests verify that the JSX compiled template optimization produces
// the same DOM output and update behavior as element()-based rendering.
// The key difference is internal: compiled templates use a single
// subscription instead of per-attr/per-child subscriptions.
// ---------------------------------------------------------------------------

describe("jsx compiled templates — basic rendering", () => {
  it("renders a simple element with no props", () => {
    const view = jsx("div", {})
    mount(view, {})
    expect(container.querySelector("div")).not.toBeNull()
  })

  it("renders static text children", () => {
    const view = jsx("span", { children: "hello" })
    mount(view, {})
    expect(container.textContent).toBe("hello")
  })

  it("renders numeric children", () => {
    const view = jsx("span", { children: 42 })
    mount(view, {})
    expect(container.textContent).toBe("42")
  })

  it("renders nested elements (compiled across nesting)", () => {
    const view = jsx("div", {
      children: jsx("span", { children: "inner" }),
    })
    mount(view, {})
    expect(container.querySelector("div > span")!.textContent).toBe("inner")
  })

  it("renders deeply nested compiled trees", () => {
    const view = jsx("div", {
      children: jsx("ul", {
        children: jsx("li", {
          children: jsx("span", { children: "deep" }),
        }),
      }),
    })
    mount(view, {})
    expect(container.querySelector("div > ul > li > span")!.textContent).toBe("deep")
  })
})

describe("jsx compiled templates — dynamic updates", () => {
  it("updates dynamic text children", () => {
    const view = jsx("span", {
      children: (m: { name: string }) => m.name,
    })
    const { signal } = mount(view, { name: "Alice" })
    expect(container.textContent).toBe("Alice")

    signal.setValue({ name: "Bob" })
    expect(container.textContent).toBe("Bob")
  })

  it("updates dynamic class", () => {
    const view = jsx("div", {
      class: (m: { on: boolean }) => (m.on ? "on" : "off"),
    })
    const { signal } = mount(view, { on: true })
    expect(container.querySelector("div")!.className).toBe("on")

    signal.setValue({ on: false })
    expect(container.querySelector("div")!.className).toBe("off")
  })

  it("updates dynamic data attributes", () => {
    const view = jsx("div", {
      "data-count": (m: { n: number }) => String(m.n),
    })
    const { signal } = mount(view, { n: 0 })
    expect(container.querySelector("div")!.getAttribute("data-count")).toBe("0")

    signal.setValue({ n: 5 })
    expect(container.querySelector("div")!.getAttribute("data-count")).toBe("5")
  })

  it("updates dynamic style values", () => {
    const view = jsx("div", {
      style: { color: (m: { c: string }) => m.c },
    })
    const { signal } = mount(view, { c: "blue" })
    expect(container.querySelector("div")!.style.color).toBe("blue")

    signal.setValue({ c: "green" })
    expect(container.querySelector("div")!.style.color).toBe("green")
  })

  it("updates IDL properties", () => {
    const view = jsx("input", {
      value: (m: { v: string }) => m.v,
    })
    const { signal } = mount(view, { v: "hello" })
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("hello")

    signal.setValue({ v: "world" })
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("world")
  })

  it("updates nested dynamic text across compiled tree", () => {
    const view = jsx("div", {
      children: jsx("span", {
        children: (m: { label: string }) => m.label,
      }),
    })
    const { signal } = mount(view, { label: "A" })
    expect(container.querySelector("span")!.textContent).toBe("A")

    signal.setValue({ label: "B" })
    expect(container.querySelector("span")!.textContent).toBe("B")
  })
})

describe("jsx compiled templates — events", () => {
  it("dispatches events from compiled templates", () => {
    const view = jsx("button", {
      onClick: (_e: Event, _m: any) => ({ type: "clicked" }),
      children: "Go",
    })
    const { msgs } = mountWithMsgs(view, {})

    container.querySelector("button")!.click()
    expect(msgs).toEqual([{ type: "clicked" }])
  })

  it("event handlers see updated model", () => {
    const view = jsx("button", {
      onClick: (_e: Event, m: { count: number }) => ({ type: "click", count: m.count }),
      children: "Go",
    })
    const { signal, msgs } = mountWithMsgs(view, { count: 0 })

    container.querySelector("button")!.click()
    expect(msgs[0]).toEqual({ type: "click", count: 0 })

    signal.setValue({ count: 5 })
    container.querySelector("button")!.click()
    expect(msgs[1]).toEqual({ type: "click", count: 5 })
  })
})

describe("jsx compiled templates — mixed children", () => {
  it("handles multiple children with jsxs", () => {
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

  it("skips null/undefined/boolean children", () => {
    const view = jsxs("div", {
      children: [null, "visible", undefined, true, false],
    })
    mount(view, {})
    expect(container.textContent).toBe("visible")
  })
})

describe("jsx compiled templates — fallback to element()", () => {
  it("falls back when children include pre-existing SDOM nodes", () => {
    // Create an SDOM node outside of JSX (no _JSX_SPEC tag)
    const inner = element<"em", { x: number }, never>("em", {}, [
      text((m) => String(m.x)),
    ])
    const view = jsx("div", { children: inner })
    mount(view, { x: 7 })
    expect(container.querySelector("em")!.textContent).toBe("7")
  })
})

describe("jsx compiled templates — integration with .focus()", () => {
  it("compiled JSX nodes work with .focus()", () => {
    const inner = jsx("span", {
      children: (m: { name: string }) => m.name,
    }) as SDOM<{ name: string }, any>

    const view = inner.focus(prop<{ user: { name: string } }>()("user"))

    const { signal } = mount(view, { user: { name: "Alice" } })
    expect(container.textContent).toBe("Alice")

    signal.setValue({ user: { name: "Bob" } })
    expect(container.textContent).toBe("Bob")
  })
})
