/**
 * Tests for the hyperscript API.
 *
 * Verifies that h() and shorthand tag helpers produce correct DOM,
 * classify props properly, handle events, and use the compiled
 * template path when children are compilable.
 */

import { describe, it, expect, vi } from "vitest"
import {
  h, frag, div, span, p, button, input, ul, li, a, section,
  label, select, option, table, thead, tbody, tr, th, td,
  img, br, hr, form, textarea, header, footer, main, nav,
  aside, article, h1, h2, h3, h4, h5, h6, em, strong,
  small, pre, code, ol, video, audio, canvas,
} from "../src/hyperscript"
import { array } from "../src/constructors"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { _TEMPLATE_SPEC } from "../src/shared"

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
// h() — core hyperscript function
// ---------------------------------------------------------------------------

describe("h()", () => {
  it("creates a simple element with static text", () => {
    const view = h("div", null, ["hello"])
    const { container } = mount(view, {})
    const el = container.firstChild as HTMLDivElement
    expect(el.tagName).toBe("DIV")
    expect(el.textContent).toBe("hello")
  })

  it("creates an element with dynamic text child", () => {
    const view = h("span", null, [(m: any) => m.name])
    const { container, signal } = mount(view, { name: "Alice" })
    expect(container.firstChild!.textContent).toBe("Alice")

    signal.setValue({ name: "Bob" })
    expect(container.firstChild!.textContent).toBe("Bob")
  })

  it("creates an element with no props or children", () => {
    const view = h("div")
    const { container } = mount(view, {})
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement)
  })

  it("creates an element with props only", () => {
    const view = h("div", { class: (m: any) => m.cls })
    const { container } = mount(view, { cls: "test" })
    const el = container.firstChild as HTMLDivElement
    expect(el.className).toBe("test")
  })

  it("creates an element with children only (null props)", () => {
    const view = h("p", null, ["text"])
    const { container } = mount(view, {})
    expect(container.firstChild!.textContent).toBe("text")
  })

  it("handles number children", () => {
    const view = h("span", null, [42])
    const { container } = mount(view, {})
    expect(container.firstChild!.textContent).toBe("42")
  })

  it("skips null/undefined/boolean children", () => {
    const view = h("div", null, [null, undefined, true, false, "visible"])
    const { container } = mount(view, {})
    expect(container.firstChild!.textContent).toBe("visible")
  })

  it("handles nested h() calls", () => {
    const view = h("div", null, [
      h("span", null, ["inner"]),
    ])
    const { container } = mount(view, {})
    const div = container.firstChild as HTMLDivElement
    const span = div.firstChild as HTMLSpanElement
    expect(span.tagName).toBe("SPAN")
    expect(span.textContent).toBe("inner")
  })
})

// ---------------------------------------------------------------------------
// Prop classification
// ---------------------------------------------------------------------------

describe("prop classification", () => {
  it("class prop sets className", () => {
    const view = h("div", { class: "test" })
    const { container } = mount(view, {})
    expect((container.firstChild as HTMLDivElement).className).toBe("test")
  })

  it("dynamic class prop", () => {
    const view = h("div", { class: (m: any) => m.active ? "active" : "" })
    const { container, signal } = mount(view, { active: true })
    expect((container.firstChild as HTMLDivElement).className).toBe("active")

    signal.setValue({ active: false })
    expect((container.firstChild as HTMLDivElement).className).toBe("")
  })

  it("IDL props (value, checked, etc.) set properties directly", () => {
    const view = h("input", { value: (m: any) => m.val, type: "text" })
    const { container } = mount(view, { val: "hello" })
    const el = container.firstChild as HTMLInputElement
    expect(el.value).toBe("hello")
    expect(el.type).toBe("text")
  })

  it("style prop sets inline styles", () => {
    const view = h("div", {
      style: { backgroundColor: (m: any) => m.bg },
    }, ["styled"])
    const { container } = mount(view, { bg: "red" })
    const el = container.firstChild as HTMLDivElement
    expect(el.style.getPropertyValue("background-color")).toBe("red")
  })

  it("classes prop sets class map", () => {
    const view = h("div", {
      classes: (m: any) => ({ active: m.active, disabled: m.disabled }),
    })
    const { container } = mount(view, { active: true, disabled: false })
    const el = container.firstChild as HTMLDivElement
    expect(el.classList.contains("active")).toBe(true)
    expect(el.classList.contains("disabled")).toBe(false)
  })

  it("data- attributes use setAttribute", () => {
    const view = h("div", { "data-id": (m: any) => m.id })
    const { container } = mount(view, { id: "42" })
    expect((container.firstChild as HTMLDivElement).getAttribute("data-id")).toBe("42")
  })

  it("aria- attributes use setAttribute", () => {
    const view = h("div", { "aria-label": "test" })
    const { container } = mount(view, {})
    expect((container.firstChild as HTMLDivElement).getAttribute("aria-label")).toBe("test")
  })
})

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe("events", () => {
  it("onClick dispatches messages", () => {
    const view = h("button", {
      onClick: (_e: Event, m: any) => ({ type: "clicked", id: m.id }),
    }, ["Go"])
    const { container, dispatch } = mount(view, { id: 1 })
    ;(container.firstChild as HTMLButtonElement).click()
    expect(dispatch).toHaveBeenCalledWith({ type: "clicked", id: 1 })
  })

  it("event handler sees updated model", () => {
    const view = h("button", {
      onClick: (_e: Event, m: any) => ({ type: "clicked", id: m.id }),
    }, ["Go"])
    const { container, signal, dispatch } = mount(view, { id: 1 })

    signal.setValue({ id: 2 })
    ;(container.firstChild as HTMLButtonElement).click()
    expect(dispatch).toHaveBeenCalledWith({ type: "clicked", id: 2 })
  })
})

// ---------------------------------------------------------------------------
// Compiled template path
// ---------------------------------------------------------------------------

describe("compiled template path", () => {
  it("marks compilable nodes with _TEMPLATE_SPEC", () => {
    const view = h("div", null, ["text"])
    expect((view as any)[_TEMPLATE_SPEC]).toBeDefined()
  })

  it("nested compilable h() calls use compiled path", () => {
    const view = h("div", null, [
      h("span", null, ["inner"]),
    ])
    expect((view as any)[_TEMPLATE_SPEC]).toBeDefined()
    expect((view as any)[_TEMPLATE_SPEC].children[0].kind).toBe("element")
  })

  it("works with array() for list rendering", () => {
    interface Item { id: string; label: string }
    const itemView = h("li", null, [(m: any) => m.label])

    const view = array<{ items: Item[] }, Item, never>(
      "ul",
      (m) => m.items.map(i => ({ key: i.id, model: i })),
      itemView as any,
    )

    const items = Array.from({ length: 50 }, (_, i) => ({
      id: String(i), label: `Item ${i}`,
    }))

    const { container } = mount(view, { items })
    const ul = container.firstChild as HTMLUListElement
    const lis = ul.querySelectorAll("li")
    expect(lis.length).toBe(50)
    expect(lis[0]!.textContent).toBe("Item 0")
    expect(lis[49]!.textContent).toBe("Item 49")
  })
})

// ---------------------------------------------------------------------------
// frag()
// ---------------------------------------------------------------------------

describe("frag()", () => {
  it("renders multiple children without a wrapper", () => {
    const view = frag([
      h("span", null, ["a"]),
      h("span", null, ["b"]),
    ])
    const { container } = mount(view, {})
    expect(container.childNodes.length).toBe(2)
    expect(container.childNodes[0]!.textContent).toBe("a")
    expect(container.childNodes[1]!.textContent).toBe("b")
  })
})

// ---------------------------------------------------------------------------
// Shorthand tag helpers
// ---------------------------------------------------------------------------

describe("shorthand tag helpers", () => {
  it("div creates a DIV element", () => {
    const { container } = mount(div(null, ["test"]), {})
    expect((container.firstChild as HTMLElement).tagName).toBe("DIV")
  })

  it("span creates a SPAN element", () => {
    const { container } = mount(span(null, ["test"]), {})
    expect((container.firstChild as HTMLElement).tagName).toBe("SPAN")
  })

  it("button creates a BUTTON element", () => {
    const { container } = mount(button(null, ["click me"]), {})
    expect((container.firstChild as HTMLElement).tagName).toBe("BUTTON")
  })

  it("input creates an INPUT element", () => {
    const { container } = mount(input({ type: "text", value: "hi" }), {})
    const el = container.firstChild as HTMLInputElement
    expect(el.tagName).toBe("INPUT")
    expect(el.value).toBe("hi")
  })

  it("all shorthand helpers create correct elements", () => {
    const helpers: [Function, string][] = [
      [div, "DIV"], [span, "SPAN"], [p, "P"], [section, "SECTION"],
      [article, "ARTICLE"], [header, "HEADER"], [footer, "FOOTER"],
      [main, "MAIN"], [nav, "NAV"], [aside, "ASIDE"],
      [h1, "H1"], [h2, "H2"], [h3, "H3"], [h4, "H4"], [h5, "H5"], [h6, "H6"],
      [em, "EM"], [strong, "STRONG"], [small, "SMALL"], [pre, "PRE"], [code, "CODE"],
      [a, "A"], [button, "BUTTON"], [textarea, "TEXTAREA"],
      [select, "SELECT"], [option, "OPTION"], [label, "LABEL"], [form, "FORM"],
      [ul, "UL"], [ol, "OL"], [li, "LI"],
      [table, "TABLE"], [thead, "THEAD"], [tbody, "TBODY"],
      [tr, "TR"], [th, "TH"], [td, "TD"],
      [img, "IMG"], [video, "VIDEO"], [audio, "AUDIO"], [canvas, "CANVAS"],
      [br, "BR"], [hr, "HR"],
    ]

    for (const [helper, expected] of helpers) {
      const view = helper(null)
      const { container } = mount(view, {})
      expect((container.firstChild as HTMLElement).tagName).toBe(expected)
    }
  })

  it("shorthand helpers accept props and children", () => {
    const view = div({ class: "wrapper" }, [
      span(null, [(m: any) => m.text]),
      button({ onClick: (_e: Event) => ({ type: "click" }) }, ["Go"]),
    ])
    const { container } = mount(view, { text: "hello" })
    const wrapper = container.firstChild as HTMLDivElement
    expect(wrapper.className).toBe("wrapper")
    expect(wrapper.querySelector("span")!.textContent).toBe("hello")
    expect(wrapper.querySelector("button")!.textContent).toBe("Go")
  })
})

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe("teardown", () => {
  it("removes DOM on teardown", () => {
    const view = h("div", null, ["test"])
    const { container, teardown } = mount(view, {})
    expect(container.childNodes.length).toBe(1)
    teardown.teardown()
    expect(container.childNodes.length).toBe(0)
  })
})
