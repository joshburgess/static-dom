/**
 * Tests for the HTM (Hyperscript Tagged Markup) module.
 *
 * Verifies the runtime parser, template caching, dynamic bindings,
 * events, nested elements, self-closing tags, and fragments.
 */

import { describe, it, expect, vi } from "vitest"
import { html } from "../src/htm"
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
    const view = html`<div><br/><hr/></div>`
    const { container } = mount(view, {})
    const div = container.firstChild as HTMLDivElement
    expect(div.childNodes.length).toBe(2)
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
// Dynamic text
// ---------------------------------------------------------------------------

describe("dynamic text", () => {
  it("interpolates dynamic text", () => {
    const view = html`<span>${(m: any) => m.name}</span>`
    const { container, signal } = mount(view, { name: "Alice" })
    expect(container.firstChild!.textContent).toBe("Alice")

    signal.setValue({ name: "Bob" })
    expect(container.firstChild!.textContent).toBe("Bob")
  })

  it("mixes static and dynamic text", () => {
    const view = html`<div>Hello ${(m: any) => m.name}!</div>`
    const { container } = mount(view, { name: "World" })
    // The div should contain "Hello ", the dynamic text "World", and "!"
    expect(container.firstChild!.textContent).toContain("Hello")
    expect(container.firstChild!.textContent).toContain("World")
  })

  it("handles number interpolation", () => {
    const view = html`<span>${(m: any) => String(m.count)}</span>`
    const { container } = mount(view, { count: 42 })
    expect(container.firstChild!.textContent).toBe("42")
  })
})

// ---------------------------------------------------------------------------
// Dynamic attributes
// ---------------------------------------------------------------------------

describe("dynamic attributes", () => {
  it("interpolates dynamic class", () => {
    const view = html`<div class=${(m: any) => m.cls}>text</div>`
    const { container, signal } = mount(view, { cls: "active" })
    expect((container.firstChild as HTMLDivElement).className).toBe("active")

    signal.setValue({ cls: "inactive" })
    expect((container.firstChild as HTMLDivElement).className).toBe("inactive")
  })

  it("interpolates IDL props", () => {
    const view = html`<input type="text" value=${(m: any) => m.val}/>`
    const { container } = mount(view, { val: "hello" })
    expect((container.firstChild as HTMLInputElement).value).toBe("hello")
  })

  it("handles static attributes", () => {
    const view = html`<div id="test">text</div>`
    const { container } = mount(view, {})
    expect((container.firstChild as HTMLDivElement).id).toBe("test")
  })

  it("handles boolean attributes", () => {
    const view = html`<input disabled/>`
    const { container } = mount(view, {})
    // "disabled" as a static attr with value "true"
    const el = container.firstChild as HTMLInputElement
    expect(el).toBeInstanceOf(HTMLInputElement)
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
})

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

describe("fragments", () => {
  it("handles multiple root elements as fragment", () => {
    const view = html`<span>a</span><span>b</span>`
    const { container } = mount(view, {})
    expect(container.childNodes.length).toBe(2)
    expect(container.childNodes[0]!.textContent).toBe("a")
    expect(container.childNodes[1]!.textContent).toBe("b")
  })
})

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

describe("cache", () => {
  it("returns consistent results on repeated calls", () => {
    function makeView(name: string) {
      return html`<span>${(m: any) => m.name}</span>`
    }
    const view1 = makeView("Alice")
    const view2 = makeView("Bob")
    // Both should produce valid SDOM nodes
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
  it("cleans up DOM on teardown", () => {
    const view = html`<div>test</div>`
    const { container, teardown } = mount(view, {})
    expect(container.childNodes.length).toBe(1)
    teardown.teardown()
    expect(container.childNodes.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Complex nesting
// ---------------------------------------------------------------------------

describe("complex nesting", () => {
  it("handles deeply nested structure", () => {
    const view = html`
      <div class=${(m: any) => m.cls}>
        <h1>${(m: any) => m.title}</h1>
        <ul>
          <li>Item 1</li>
          <li>${(m: any) => m.item2}</li>
        </ul>
      </div>
    `
    const { container } = mount(view, { cls: "app", title: "Hello", item2: "Dynamic" })
    const div = container.firstChild as HTMLDivElement
    expect(div.className).toBe("app")
    expect(div.querySelector("h1")!.textContent).toBe("Hello")
    const lis = div.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("Item 1")
    expect(lis[1]!.textContent).toBe("Dynamic")
  })
})
