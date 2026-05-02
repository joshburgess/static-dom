/**
 * Tests for the lit-html style tagged template module.
 *
 * Verifies innerHTML-based template creation, cloneNode instantiation,
 * attribute vs child interpolation detection, dynamic bindings, events,
 * styles, and template caching.
 */

import { describe, it, expect, vi } from "vitest"
import { html } from "../src/html"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mount<M>(sdom: any, model: M) {
  const container = document.createElement("div")
  const signal = createSignal(model)
  const updates = toUpdateStream(signal)
  const dispatch: Dispatcher<any> = vi.fn()
  const teardown = sdom.attach(container, model, updates, dispatch)
  return { container, signal, dispatch, teardown }
}

// ---------------------------------------------------------------------------
// Basic elements
// ---------------------------------------------------------------------------

describe("basic elements", () => {
  it("creates a simple element with static text", () => {
    const view = html`<div>hello</div>`
    const { container } = mount(view, {})
    const el = container.firstChild as HTMLDivElement
    expect(el.tagName).toBe("DIV")
    expect(el.textContent).toBe("hello")
  })

  it("creates nested elements", () => {
    const view = html`<div><span>inner</span></div>`
    const { container } = mount(view, {})
    const div = container.firstChild as HTMLDivElement
    const span = div.firstChild as HTMLSpanElement
    expect(span.tagName).toBe("SPAN")
    expect(span.textContent).toBe("inner")
  })

  it("handles self-closing tags", () => {
    const view = html`<div><br/></div>`
    const { container } = mount(view, {})
    const div = container.firstChild as HTMLDivElement
    // br should be present as a child
    expect(div.querySelector("br")).not.toBeNull()
  })

  it("handles multiple children", () => {
    const view = html`<ul><li>a</li><li>b</li><li>c</li></ul>`
    const { container } = mount(view, {})
    const ul = container.firstChild as HTMLUListElement
    const lis = ul.querySelectorAll("li")
    expect(lis.length).toBe(3)
    expect(lis[0]!.textContent).toBe("a")
    expect(lis[1]!.textContent).toBe("b")
    expect(lis[2]!.textContent).toBe("c")
  })
})

// ---------------------------------------------------------------------------
// Dynamic text (child interpolation)
// ---------------------------------------------------------------------------

describe("dynamic text", () => {
  it("interpolates dynamic text via function", () => {
    const view = html`<span>${(m: any) => m.name}</span>`
    const { container, signal } = mount(view, { name: "Alice" })
    expect(container.firstChild!.textContent).toBe("Alice")

    signal.setValue({ name: "Bob" })
    expect(container.firstChild!.textContent).toBe("Bob")
  })

  it("interpolates static string values", () => {
    const name = "World"
    const view = html`<span>${name}</span>`
    const { container } = mount(view, {})
    expect(container.firstChild!.textContent).toBe("World")
  })

  it("interpolates number values", () => {
    const count = 42
    const view = html`<span>${count}</span>`
    const { container } = mount(view, {})
    expect(container.firstChild!.textContent).toBe("42")
  })
})

// ---------------------------------------------------------------------------
// Dynamic attributes (attr interpolation)
// ---------------------------------------------------------------------------

describe("dynamic attributes", () => {
  it("interpolates dynamic class", () => {
    const view = html`<div class=${(m: any) => m.cls}>text</div>`
    const { container, signal } = mount(view, { cls: "active" })
    expect((container.firstChild as HTMLDivElement).className).toBe("active")

    signal.setValue({ cls: "inactive" })
    expect((container.firstChild as HTMLDivElement).className).toBe("inactive")
  })

  it("interpolates IDL props (value)", () => {
    const view = html`<input value=${(m: any) => m.val}/>`
    const { container } = mount(view, { val: "hello" })
    expect((container.firstChild as HTMLInputElement).value).toBe("hello")
  })

  it("handles data- attributes", () => {
    const view = html`<div data-id=${(m: any) => m.id}>text</div>`
    const { container } = mount(view, { id: "42" })
    expect((container.firstChild as HTMLDivElement).getAttribute("data-id")).toBe("42")
  })
})

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe("events", () => {
  it("handles onClick", () => {
    const handler = (_e: Event, m: any) => ({ type: "clicked", id: m.id })
    const view = html`<button onClick=${handler}>Go</button>`
    const { container, dispatch } = mount(view, { id: 1 })
    ;(container.firstChild as HTMLButtonElement).click()
    expect(dispatch).toHaveBeenCalledWith({ type: "clicked", id: 1 })
  })

  it("event handler sees updated model", () => {
    const handler = (_e: Event, m: any) => ({ type: "clicked", id: m.id })
    const view = html`<button onClick=${handler}>Go</button>`
    const { container, signal, dispatch } = mount(view, { id: 1 })

    signal.setValue({ id: 2 })
    ;(container.firstChild as HTMLButtonElement).click()
    expect(dispatch).toHaveBeenCalledWith({ type: "clicked", id: 2 })
  })
})

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

describe("styles", () => {
  it("handles style objects", () => {
    const view = html`<div style=${{ backgroundColor: (m: any) => m.bg }}>styled</div>`
    const { container } = mount(view, { bg: "red" })
    const el = container.firstChild as HTMLDivElement
    expect(el.style.getPropertyValue("background-color")).toBe("red")
  })

  it("updates style dynamically", () => {
    const view = html`<div style=${{ color: (m: any) => m.color }}>text</div>`
    const { container, signal } = mount(view, { color: "blue" })
    const el = container.firstChild as HTMLDivElement
    expect(el.style.getPropertyValue("color")).toBe("blue")

    signal.setValue({ color: "green" })
    expect(el.style.getPropertyValue("color")).toBe("green")
  })
})

// ---------------------------------------------------------------------------
// Fragments (multiple roots)
// ---------------------------------------------------------------------------

describe("fragments", () => {
  it("handles multiple root elements", () => {
    const view = html`<span>a</span><span>b</span>`
    const { container } = mount(view, {})
    expect(container.childNodes.length).toBe(2)
    expect(container.childNodes[0]!.textContent).toBe("a")
    expect(container.childNodes[1]!.textContent).toBe("b")
  })
})

// ---------------------------------------------------------------------------
// Template caching
// ---------------------------------------------------------------------------

describe("template caching", () => {
  it("reuses template across calls from same site", () => {
    function makeView() {
      return html`<span>${(m: any) => m.name}</span>`
    }
    const view1 = makeView()
    const view2 = makeView()
    // Both should work correctly — template is cached by strings identity
    const { container: c1 } = mount(view1, { name: "Alice" })
    const { container: c2 } = mount(view2, { name: "Bob" })
    expect(c1.firstChild!.textContent).toBe("Alice")
    expect(c2.firstChild!.textContent).toBe("Bob")
  })
})

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe("teardown", () => {
  it("removes single root on teardown", () => {
    const view = html`<div>test</div>`
    const { container, teardown } = mount(view, {})
    expect(container.childNodes.length).toBe(1)
    teardown.teardown()
    expect(container.childNodes.length).toBe(0)
  })

  it("removes multiple roots on teardown", () => {
    const view = html`<span>a</span><span>b</span>`
    const { container, teardown } = mount(view, {})
    expect(container.childNodes.length).toBe(2)
    teardown.teardown()
    expect(container.childNodes.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Complex nesting
// ---------------------------------------------------------------------------

describe("complex nesting", () => {
  it("handles deeply nested structure with mixed bindings", () => {
    const view = html`
      <div class=${(m: any) => m.cls}>
        <h1>${(m: any) => m.title}</h1>
        <ul>
          <li>Static item</li>
          <li>${(m: any) => m.dynamic}</li>
        </ul>
      </div>
    `
    const { container } = mount(view, { cls: "app", title: "Hello", dynamic: "Dynamic" })
    const div = container.firstChild as HTMLDivElement
    expect(div.className).toBe("app")
    expect(div.querySelector("h1")!.textContent).toBe("Hello")
    const lis = div.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("Static item")
    expect(lis[1]!.textContent).toBe("Dynamic")
  })
})
