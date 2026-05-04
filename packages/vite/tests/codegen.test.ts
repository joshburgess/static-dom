/**
 * Tests for the sdomCodegen build-time compiler.
 *
 * End-to-end tests compile a tiny .jsx fixture, evaluate the emitted
 * code against happy-dom, and assert that mount + update + teardown
 * behave the same as the runtime path would.
 */

import { describe, it, expect } from "vitest"
import { compileFile } from "../src/codegen/compile"
import { compiled, createSignal, toUpdateStream } from "@static-dom/core"

// Compile + evaluate a fixture, returning the SDOM bound to the `view` const.
function compileAndLoad(src: string): ReturnType<typeof compiled> {
  const result = compileFile(src, "/x.jsx")
  if (result === null) throw new Error("expected compileFile to produce output")
  const body = result.code.replace(/^import [^\n]+\n/m, "")
  const factory = new Function(
    "__sdomCompiled",
    `${body}\nreturn view`,
  ) as (c: typeof compiled) => ReturnType<typeof compiled>
  return factory(compiled)
}

function mountFor<M>(view: ReturnType<typeof compiled>, initial: M) {
  const container = document.createElement("section")
  document.body.appendChild(container)
  const signal = createSignal(initial)
  const updates = toUpdateStream(signal)
  const teardown = view.attach(container, initial, updates, () => {})
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
    expect(out).toContain('"<div class=\\"foo\\" id=\\"root\\"></div>"')
    // No update code for static attrs.
    expect(out).not.toMatch(/__attrFn/)
  })

  it("normalizes className to class for static values", () => {
    const src = `const view = <div className="foo">{(m) => m.x}</div>\n`
    const out = compileFile(src, "/x.jsx")!.code
    expect(out).toContain('"<div class=\\"foo\\"></div>"')
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

  it("leaves event handlers alone (deferred slice)", () => {
    const src = `const view = <button onClick={() => {}}>x</button>\n`
    const result = compileFile(src, "/x.jsx")
    expect(result).toBeNull()
  })

  it("leaves nested elements alone (deferred slice)", () => {
    const src = `const view = <div><span>{(m) => m.x}</span></div>\n`
    const result = compileFile(src, "/x.jsx")
    expect(result).toBeNull()
  })
})
