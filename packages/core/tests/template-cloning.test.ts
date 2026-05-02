/**
 * Tests for the template cloning engine.
 *
 * Verifies that the JSX compiled path (which now uses template cloning)
 * produces correct DOM, wires up dynamic bindings, and shares templates
 * across multiple attaches (e.g., in array()).
 */

import { describe, it, expect, vi } from "vitest"
import { jsx, Fragment, compileSpec } from "../src/jsx-runtime"
import { array } from "../src/constructors"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { buildTemplate, instantiateTemplate } from "../src/template"
import type { JsxSpec } from "../src/shared"

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
// buildTemplate + instantiateTemplate
// ---------------------------------------------------------------------------

describe("buildTemplate", () => {
  it("creates a TemplateCache from a JsxSpec", () => {
    const spec: JsxSpec = {
      tag: "div",
      classified: {},
      children: [{ kind: "static", text: "hello" }],
    }
    const cache = buildTemplate(spec)
    expect(cache.template).toBeInstanceOf(HTMLTemplateElement)
    expect(cache.template.content.firstChild).toBeInstanceOf(HTMLDivElement)
    expect(cache.template.content.firstChild!.textContent).toBe("hello")
  })

  it("records bindings for dynamic text", () => {
    const fn = (m: any) => m.name
    const spec: JsxSpec = {
      tag: "span",
      classified: {},
      children: [{ kind: "dynamic", fn }],
    }
    const cache = buildTemplate(spec)
    expect(cache.bindings).toHaveLength(1)
    expect(cache.bindings[0]!.kind).toBe("dynamicText")
  })

  it("records bindings for attrs, rawAttrs, styles, classMap, events", () => {
    const spec: JsxSpec = {
      tag: "input",
      classified: {
        attrs: { value: (m: any) => m.val },
        rawAttrs: { class: (m: any) => m.cls },
        style: { color: (m: any) => m.color },
        classes: (m: any) => ({ active: m.active }),
        on: { click: (e: Event, m: any) => ({ type: "clicked" }) },
      },
      children: [],
    }
    const cache = buildTemplate(spec)
    const kinds = cache.bindings.map(b => b.kind).sort()
    expect(kinds).toEqual(["classMap", "event", "prop", "rawAttr", "style"])
  })

  it("handles nested elements", () => {
    const spec: JsxSpec = {
      tag: "div",
      classified: {},
      children: [{
        kind: "element",
        spec: {
          tag: "span",
          classified: {},
          children: [{ kind: "static", text: "inner" }],
        },
      }],
    }
    const cache = buildTemplate(spec)
    const div = cache.template.content.firstChild as HTMLDivElement
    expect(div.firstChild).toBeInstanceOf(HTMLSpanElement)
    expect(div.firstChild!.textContent).toBe("inner")
  })
})

describe("instantiateTemplate", () => {
  it("clones template and wires dynamic text", () => {
    const spec: JsxSpec = {
      tag: "span",
      classified: {},
      children: [{ kind: "dynamic", fn: (m: any) => m.name }],
    }
    const cache = buildTemplate(spec)
    const eventCleanups: Array<() => void> = []

    const { el, update } = instantiateTemplate(cache, { name: "Alice" }, () => {}, eventCleanups)
    expect(el.tagName).toBe("SPAN")
    expect(el.textContent).toBe("Alice")

    update({ name: "Bob" })
    expect(el.textContent).toBe("Bob")
  })

  it("clones template and wires IDL props", () => {
    const spec: JsxSpec = {
      tag: "input",
      classified: { attrs: { value: (m: any) => m.val } },
      children: [],
    }
    const cache = buildTemplate(spec)

    const { el, update } = instantiateTemplate(cache, { val: "hello" }, () => {}, [])
    expect((el as HTMLInputElement).value).toBe("hello")

    update({ val: "world" })
    expect((el as HTMLInputElement).value).toBe("world")
  })

  it("clones template and wires events", () => {
    const handler = vi.fn((_e: Event, m: any) => ({ type: "click", id: m.id }))
    const spec: JsxSpec = {
      tag: "button",
      classified: { on: { click: handler } },
      children: [{ kind: "static", text: "Go" }],
    }
    const cache = buildTemplate(spec)
    const eventCleanups: Array<() => void> = []
    const dispatch = vi.fn()

    const { el, update } = instantiateTemplate(cache, { id: 1 }, dispatch, eventCleanups)
    el.dispatchEvent(new Event("click"))

    expect(dispatch).toHaveBeenCalledWith({ type: "click", id: 1 })

    update({ id: 2 })
    el.dispatchEvent(new Event("click"))
    expect(dispatch).toHaveBeenCalledWith({ type: "click", id: 2 })
  })

  it("produces independent clones from same cache", () => {
    const spec: JsxSpec = {
      tag: "span",
      classified: {},
      children: [{ kind: "dynamic", fn: (m: any) => m.name }],
    }
    const cache = buildTemplate(spec)

    const r1 = instantiateTemplate(cache, { name: "A" }, () => {}, [])
    const r2 = instantiateTemplate(cache, { name: "B" }, () => {}, [])

    expect(r1.el.textContent).toBe("A")
    expect(r2.el.textContent).toBe("B")

    r1.update({ name: "A2" })
    expect(r1.el.textContent).toBe("A2")
    expect(r2.el.textContent).toBe("B")
  })
})

// ---------------------------------------------------------------------------
// JSX compileSpec integration
// ---------------------------------------------------------------------------

describe("compileSpec with template cloning", () => {
  it("produces correct DOM via JSX", () => {
    const view = jsx("div", {
      class: (m: any) => m.cls,
      children: [jsx("span", { children: (m: any) => m.text })]
    })
    const { container } = mount(view, { cls: "test", text: "hello" })
    const div = container.firstChild as HTMLDivElement
    expect(div.className).toBe("test")
    expect(div.firstChild!.textContent).toBe("hello")
  })

  it("updates dynamic values correctly", () => {
    const view = jsx("span", { children: (m: any) => m.name })
    const { container, signal } = mount(view, { name: "Alice" })
    expect(container.firstChild!.textContent).toBe("Alice")

    signal.setValue({ name: "Bob" })
    expect(container.firstChild!.textContent).toBe("Bob")
  })

  it("shares template across array items", () => {
    interface Item { id: string; label: string }
    const itemView = jsx("li", { children: (m: any) => m.label })

    const view = array<{ items: Item[] }, Item, never>(
      "ul",
      (m) => m.items.map(i => ({ key: i.id, model: i })),
      itemView as any,
    )

    const items = Array.from({ length: 100 }, (_, i) => ({
      id: String(i), label: `Item ${i}`,
    }))

    const { container } = mount(view, { items })
    const ul = container.firstChild as HTMLUListElement
    // Each item should be an LI with correct text
    const lis = ul.querySelectorAll("li")
    expect(lis.length).toBe(100)
    expect(lis[0]!.textContent).toBe("Item 0")
    expect(lis[99]!.textContent).toBe("Item 99")
  })

  it("handles events in compiled templates", () => {
    const view = jsx("button", {
      onClick: (_e: Event, m: any) => ({ type: "clicked", id: m.id }),
      children: "Click",
    })
    const { container, dispatch } = mount(view, { id: 42 })
    const button = container.firstChild as HTMLButtonElement
    button.click()
    expect(dispatch).toHaveBeenCalledWith({ type: "clicked", id: 42 })
  })

  it("handles styles in compiled templates", () => {
    const view = jsx("div", {
      style: { backgroundColor: (m: any) => m.bg },
      children: "styled",
    })
    const { container } = mount(view, { bg: "red" })
    const div = container.firstChild as HTMLDivElement
    expect(div.style.getPropertyValue("background-color")).toBe("red")
  })

  it("cleans up on teardown", () => {
    const view = jsx("div", { children: "test" })
    const { container, teardown } = mount(view, {})
    expect(container.childNodes.length).toBe(1)
    teardown.teardown()
    expect(container.childNodes.length).toBe(0)
  })
})
