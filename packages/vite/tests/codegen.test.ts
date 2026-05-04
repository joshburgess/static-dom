/**
 * Tests for the sdomCodegen build-time compiler.
 *
 * End-to-end tests compile a tiny .jsx fixture, evaluate the emitted
 * code against happy-dom, and assert that mount + update + teardown
 * behave the same as the runtime path would.
 */

import { describe, it, expect } from "vitest"
import { compileFile } from "../src/codegen/compile"
import {
  compiled,
  createSignal,
  registerEvent,
  toUpdateStream,
} from "@static-dom/core"

// Compile + evaluate a fixture, returning the SDOM bound to the `view` const.
function compileAndLoad(src: string): ReturnType<typeof compiled> {
  const result = compileFile(src, "/x.jsx")
  if (result === null) throw new Error("expected compileFile to produce output")
  const body = result.code.replace(/^import [^\n]+\n/gm, "")
  const factory = new Function(
    "__sdomCompiled",
    "__sdomRegisterEvent",
    `${body}\nreturn view`,
  ) as (
    c: typeof compiled,
    r: typeof registerEvent,
  ) => ReturnType<typeof compiled>
  return factory(compiled, registerEvent)
}

function mountFor<M>(
  view: ReturnType<typeof compiled>,
  initial: M,
  dispatch: (msg: unknown) => void = () => {},
) {
  const container = document.createElement("section")
  document.body.appendChild(container)
  const signal = createSignal(initial)
  const updates = toUpdateStream(signal)
  const teardown = view.attach(container, initial, updates, dispatch)
  return { container, signal, teardown }
}

describe("sdomCodegen / compileFile", () => {
  it("returns null for non-JSX files", () => {
    expect(compileFile("const x = 1", "/x.ts")).toBeNull()
  })

  it("returns null when the file has no compilable JSX", () => {
    const src = `const x = 1\nconst y = "foo"\n`
    expect(compileFile(src, "/x.jsx")).toBeNull()
  })

  it("emits a hoisted compiled() call for <tag>{fn}</tag>", () => {
    const src = `const view = <div>{(m) => m.x}</div>\n`
    const result = compileFile(src, "/x.jsx")
    expect(result).not.toBeNull()
    const out = result!.code
    expect(out).toContain("__sdom_tpl_0")
    expect(out).toContain("__sdom_compiled_0")
    expect(out).toContain('document.createElement("template")')
    expect(out).toContain('cloneNode(true)')
    expect(out).toContain("__textNode0.nodeValue")
    expect(out).toContain("const view = __sdom_compiled_0")
    expect(out).not.toMatch(/<div>\{/)
    expect(out).not.toMatch(/<\/div>$/m)
  })

  it("compiles multiple JSX sites in the same file", () => {
    const src = [
      `const a = <span>{(m) => m.label}</span>`,
      `const b = <p>{(m) => m.body}</p>`,
      ``,
    ].join("\n")
    const result = compileFile(src, "/x.jsx")!
    expect(result.code).toContain("__sdom_compiled_0")
    expect(result.code).toContain("__sdom_compiled_1")
    expect(result.code).toContain("const a = __sdom_compiled_0")
    expect(result.code).toContain("const b = __sdom_compiled_1")
  })

  it("end-to-end: dynamic text mounts, updates, and tears down", () => {
    const view = compileAndLoad(`const view = <span>{(m) => m.label}</span>\n`)
    const { container, signal, teardown } = mountFor(view, { label: "alpha" })

    expect(container.firstElementChild?.tagName).toBe("SPAN")
    expect(container.firstElementChild?.textContent).toBe("alpha")

    signal.setValue({ label: "beta" })
    expect(container.firstElementChild?.textContent).toBe("beta")

    signal.setValue({ label: "beta" })
    expect(container.firstElementChild?.textContent).toBe("beta")

    teardown.teardown()
    expect(container.firstElementChild).toBeNull()
    container.remove()
  })

  // ---------------------------------------------------------------------------
  // Static attributes -> baked into the template's innerHTML.
  // ---------------------------------------------------------------------------

  it("bakes static string attributes into the template innerHTML", () => {
    const src = `const view = <div class="foo" id="root">{(m) => m.x}</div>\n`
    const out = compileFile(src, "/x.jsx")!.code
    expect(out).toContain('"<div class=\\"foo\\" id=\\"root\\"> </div>"')
    // No update code for static attrs.
    expect(out).not.toMatch(/__attrFn/)
  })

  it("normalizes className to class for static values", () => {
    const src = `const view = <div className="foo">{(m) => m.x}</div>\n`
    const out = compileFile(src, "/x.jsx")!.code
    expect(out).toContain('"<div class=\\"foo\\"> </div>"')
  })

  it("escapes static attribute values for HTML", () => {
    const src = `const view = <div data-x={"a&b\\"c"}>{(m) => m.x}</div>\n`
    const out = compileFile(src, "/x.jsx")!.code
    // The innerHTML string literal escapes its quotes for JS, so the
    // emitted form is `data-x=\"a&amp;b&quot;c\"` inside the source.
    expect(out).toContain('data-x=\\"a&amp;b&quot;c\\"')
  })

  it("end-to-end: static class is rendered", () => {
    const view = compileAndLoad(
      `const view = <div class="badge">{(m) => m.label}</div>\n`,
    )
    const { container, teardown } = mountFor(view, { label: "x" })
    expect(container.firstElementChild?.getAttribute("class")).toBe("badge")
    teardown.teardown()
    container.remove()
  })

  // ---------------------------------------------------------------------------
  // Dynamic attributes -> emitted as per-attr update binding.
  // ---------------------------------------------------------------------------

  it("emits IDL-property assignment for dynamic IDL attrs", () => {
    const src = `const view = <input id={(m) => m.id}/>\n`
    const out = compileFile(src, "/x.jsx")!.code
    expect(out).toContain("root.id = __attrLast0")
    expect(out).toContain("root.id = __attrV0")
  })

  it("emits className assignment for dynamic class attribute", () => {
    const src = `const view = <div class={(m) => m.cls}>{(m) => m.x}</div>\n`
    const out = compileFile(src, "/x.jsx")!.code
    expect(out).toContain("root.className = __attrLast0")
    expect(out).toContain("root.className = __attrV0")
  })

  it("emits setAttribute for dynamic data-* attributes", () => {
    const src = `const view = <div data-id={(m) => m.id}>{(m) => m.x}</div>\n`
    const out = compileFile(src, "/x.jsx")!.code
    expect(out).toContain('root.setAttribute("data-id", __attrLast0)')
    expect(out).toContain('root.setAttribute("data-id", __attrV0)')
  })

  it("end-to-end: dynamic class updates the DOM property, not the attribute", () => {
    const view = compileAndLoad(
      `const view = <div class={(m) => m.cls}>{(m) => m.label}</div>\n`,
    )
    const { container, signal, teardown } = mountFor(view, { cls: "a", label: "L1" })
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toBe("a")
    expect(el.textContent).toBe("L1")

    signal.setValue({ cls: "b", label: "L2" })
    expect(el.className).toBe("b")
    expect(el.textContent).toBe("L2")

    teardown.teardown()
    container.remove()
  })

  // ---------------------------------------------------------------------------
  // Mixed children: static text + dynamic text in the same element.
  // ---------------------------------------------------------------------------

  it("end-to-end: static text and dynamic text render in source order", () => {
    const view = compileAndLoad(
      `const view = <p>Hello, {(m) => m.name}!</p>\n`,
    )
    const { container, signal, teardown } = mountFor(view, { name: "world" })
    expect(container.firstElementChild?.textContent).toBe("Hello, world!")

    signal.setValue({ name: "static-dom" })
    expect(container.firstElementChild?.textContent).toBe("Hello, static-dom!")

    teardown.teardown()
    container.remove()
  })

  // ---------------------------------------------------------------------------
  // Void elements: emit `<tag>` with no closing in innerHTML.
  // ---------------------------------------------------------------------------

  it("emits void elements without a closing tag", () => {
    const src = `const view = <input id={(m) => m.id}/>\n`
    const out = compileFile(src, "/x.jsx")!.code
    expect(out).toContain('"<input>"')
    expect(out).not.toContain("</input>")
  })

  // ---------------------------------------------------------------------------
  // Out-of-slice cases still bypass codegen.
  // ---------------------------------------------------------------------------

  it("rejects mixing dynamic text and element children at the same level", () => {
    // This shape needs a comment-marker / insertBefore approach; deferred.
    const src = `const view = <div>{(m) => m.label}<span>x</span></div>\n`
    const result = compileFile(src, "/x.jsx")
    expect(result).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Nested elements: subtree bakes into innerHTML; only descendants with
  // bindings get walker aliases.
  // ---------------------------------------------------------------------------

  it("bakes nested element structure into a single innerHTML string", () => {
    const src = `const view = <div><span>{(m) => m.x}</span></div>\n`
    const out = compileFile(src, "/x.jsx")!.code
    // The span pre-bakes a placeholder text node so cloneNode produces
    // it; setup walks via firstChild instead of appending at runtime.
    expect(out).toContain('"<div><span> </span></div>"')
    // The inner span needs JS work, so it gets a walker alias.
    expect(out).toContain("const __el_0 = root.firstChild")
    // Dynamic text walks to the pre-baked placeholder, not an appended node.
    expect(out).toContain("const __textNode0 = __el_0.firstChild")
    expect(out).not.toContain("appendChild(document.createTextNode")
  })

  it("does not allocate walker aliases for purely static descendants", () => {
    const src = `const view = <div><i>icon</i><span>{(m) => m.x}</span></div>\n`
    const out = compileFile(src, "/x.jsx")!.code
    expect(out).toContain('"<div><i>icon</i><span> </span></div>"')
    // Only the span needs work; the <i> is fully baked.
    expect(out).toContain("const __el_0 = root.firstChild.nextSibling")
    expect(out).not.toContain("__el_1")
  })

  it("end-to-end: nested element with dynamic text mounts and updates", () => {
    const view = compileAndLoad(
      `const view = <div><span>{(m) => m.label}</span></div>\n`,
    )
    const { container, signal, teardown } = mountFor(view, { label: "alpha" })
    const root = container.firstElementChild as HTMLElement
    expect(root.tagName).toBe("DIV")
    expect(root.firstElementChild?.tagName).toBe("SPAN")
    expect(root.firstElementChild?.textContent).toBe("alpha")

    signal.setValue({ label: "beta" })
    expect(root.firstElementChild?.textContent).toBe("beta")

    teardown.teardown()
    container.remove()
  })

  it("end-to-end: krausest-style row with multiple dynamic descendants", () => {
    const view = compileAndLoad(
      [
        `const view = <tr class={(m) => m.cls}>`,
        `<td class="col-md-1">{(m) => m.id}</td>`,
        `<td class="col-md-4"><a>{(m) => m.label}</a></td>`,
        `<td class="col-md-1"><a><span class="glyphicon glyphicon-remove"/></a></td>`,
        `<td class="col-md-6"/>`,
        `</tr>\n`,
      ].join(""),
    )
    const { container, signal, teardown } = mountFor(view, {
      cls: "",
      id: 1,
      label: "first",
    })
    const tr = container.firstElementChild as HTMLElement
    expect(tr.tagName).toBe("TR")
    expect(tr.children.length).toBe(4)
    expect(tr.children[0]?.textContent).toBe("1")
    expect(tr.children[1]?.firstElementChild?.tagName).toBe("A")
    expect(tr.children[1]?.textContent).toBe("first")
    expect(tr.children[2]?.firstElementChild?.firstElementChild?.getAttribute("class"))
      .toBe("glyphicon glyphicon-remove")

    signal.setValue({ cls: "danger", id: 42, label: "updated" })
    expect(tr.className).toBe("danger")
    expect(tr.children[0]?.textContent).toBe("42")
    expect(tr.children[1]?.textContent).toBe("updated")

    teardown.teardown()
    container.remove()
  })

  // ---------------------------------------------------------------------------
  // Event handlers: registered via registerEvent, dispatched messages flow.
  // ---------------------------------------------------------------------------

  it("emits a registerEvent call for onClick", () => {
    const src = `const view = <button onClick={(e, m) => ({ type: "go" })}>x</button>\n`
    const out = compileFile(src, "/x.jsx")!.code
    expect(out).toContain("registerEvent as __sdomRegisterEvent")
    expect(out).toContain('__sdomRegisterEvent(root, "click",')
    expect(out).toContain("let __evtModel = initialModel")
    expect(out).toContain("__evtModel = next")
  })

  it("end-to-end: event handler dispatches and sees the live model", () => {
    const dispatched: unknown[] = []
    const view = compileAndLoad(
      `const view = <button onClick={(e, m) => ({ type: "click", id: m.id })}>{(m) => m.label}</button>\n`,
    )
    const { container, signal, teardown } = mountFor(
      view,
      { id: 1, label: "L1" },
      (msg) => dispatched.push(msg),
    )
    const btn = container.firstElementChild as HTMLButtonElement
    btn.click()
    expect(dispatched).toEqual([{ type: "click", id: 1 }])

    signal.setValue({ id: 2, label: "L2" })
    btn.click()
    expect(dispatched).toEqual([
      { type: "click", id: 1 },
      { type: "click", id: 2 },
    ])

    teardown.teardown()
    // After teardown the listener is removed; clicking the detached node
    // (the click happens before insertion to avoid happy-dom's event path
    // requiring a connected element) should not dispatch.
    container.remove()
  })

  it("end-to-end: handler returning null/undefined does not dispatch", () => {
    const dispatched: unknown[] = []
    const view = compileAndLoad(
      `const view = <button onClick={(e, m) => null}>x</button>\n`,
    )
    const { container, teardown } = mountFor(
      view,
      { x: 1 },
      (msg) => dispatched.push(msg),
    )
    const btn = container.firstElementChild as HTMLButtonElement
    btn.click()
    expect(dispatched).toEqual([])

    teardown.teardown()
    container.remove()
  })

  it("end-to-end: event handler on nested element still gets registered", () => {
    const dispatched: unknown[] = []
    const view = compileAndLoad(
      `const view = <div><button onClick={(e, m) => ({ type: "tap", v: m.v })}>{(m) => m.label}</button></div>\n`,
    )
    const { container, teardown } = mountFor(
      view,
      { v: 7, label: "go" },
      (msg) => dispatched.push(msg),
    )
    const btn = container.querySelector("button") as HTMLButtonElement
    btn.click()
    expect(dispatched).toEqual([{ type: "tap", v: 7 }])

    teardown.teardown()
    container.remove()
  })

  it("end-to-end: teardown removes the event listener", () => {
    const dispatched: unknown[] = []
    const view = compileAndLoad(
      `const view = <button onClick={(e, m) => ({ type: "click" })}>x</button>\n`,
    )
    const { container, teardown } = mountFor(view, {}, (msg) => dispatched.push(msg))
    const btn = container.firstElementChild as HTMLButtonElement
    btn.click()
    expect(dispatched.length).toBe(1)

    teardown.teardown()
    // Element is detached after teardown; manually re-insert and click to
    // confirm the listener is gone.
    container.appendChild(btn)
    btn.click()
    expect(dispatched.length).toBe(1)
    container.remove()
  })
})
