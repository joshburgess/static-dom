/**
 * Tests for the sdomCodegen build-time compiler.
 *
 * The end-to-end test compiles a tiny .jsx fixture, evaluates the
 * emitted code against happy-dom, and asserts that mount + update +
 * teardown behave the same as the runtime path would.
 */

import { describe, it, expect } from "vitest"
import { compileFile } from "../src/codegen/compile"
import { compiled, createSignal, toUpdateStream } from "@static-dom/core"

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
    expect(out).toContain("text0.nodeValue")
    // The original JSX site has been replaced with a reference.
    expect(out).toContain("const view = __sdom_compiled_0")
    // The JSX expression form is gone (template's innerHTML may still
    // contain `"<div></div>"` as a string literal, which is fine).
    expect(out).not.toMatch(/<div>\{/)
    expect(out).not.toMatch(/<\/div>$/m)
  })

  it("end-to-end: emitted code mounts, updates, and tears down", () => {
    const src = `const view = <span>{(m) => m.label}</span>\n`
    const result = compileFile(src, "/x.jsx")!

    // Strip the import — we'll inject `compiled` by parameter.
    const body = result.code.replace(/^import [^\n]+\n/m, "")

    // Wrap in a function that returns the compiled SDOM.
    const factory = new Function(
      "__sdomCompiled",
      `${body}\nreturn view`,
    ) as (c: typeof compiled) => ReturnType<typeof compiled>

    const view = factory(compiled)

    // Mount.
    const container = document.createElement("section")
    document.body.appendChild(container)

    const initial = { label: "alpha" }
    const signal = createSignal(initial)
    const updates = toUpdateStream(signal)
    const teardown = view.attach(container, initial, updates, () => {})

    expect(container.firstElementChild?.tagName).toBe("SPAN")
    expect(container.firstElementChild?.textContent).toBe("alpha")

    // Update.
    signal.setValue({ label: "beta" })
    expect(container.firstElementChild?.textContent).toBe("beta")

    // Same value — no-op write but still correct.
    signal.setValue({ label: "beta" })
    expect(container.firstElementChild?.textContent).toBe("beta")

    // Teardown removes the rendered subtree.
    teardown.teardown()
    expect(container.firstElementChild).toBeNull()

    container.remove()
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

  it("leaves JSX with attributes alone (out of slice scope)", () => {
    const src = `const view = <div class="foo">{(m) => m.x}</div>\n`
    const result = compileFile(src, "/x.jsx")
    // No compilable site in this slice; plugin returns null.
    expect(result).toBeNull()
  })
})
