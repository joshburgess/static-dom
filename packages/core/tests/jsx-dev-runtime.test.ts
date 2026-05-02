import { describe, it, expect, afterEach } from "vitest"
import { jsxDEV, Fragment } from "../src/jsx-dev-runtime"
import { createSignal, toUpdateStream } from "../src/observable"
import type { SDOM, Teardown } from "../src/types"

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
// jsxDEV
// ---------------------------------------------------------------------------

describe("jsxDEV", () => {
  it("renders an element like jsx()", () => {
    const view = jsxDEV("div", { children: "hello" })
    mount(view, {})
    expect(container.querySelector("div")!.textContent).toBe("hello")
  })

  it("handles fragments", () => {
    const view = jsxDEV(Fragment, {
      children: [
        jsxDEV("span", { children: "a" }),
        jsxDEV("span", { children: "b" }),
      ],
    })
    mount(view, {})
    expect(container.querySelectorAll("span").length).toBe(2)
  })

  it("handles function components", () => {
    function Greeting(props: { name: string }) {
      return jsxDEV("h1", { children: props.name })
    }
    const view = jsxDEV(Greeting, { name: "World" })
    mount(view, {})
    expect(container.querySelector("h1")!.textContent).toBe("World")
  })

  it("ignores dev-only parameters (source, self, isStatic)", () => {
    const view = jsxDEV(
      "span",
      { children: "dev" },
      undefined,       // key
      true,            // isStatic
      { fileName: "test.tsx", lineNumber: 1, columnNumber: 1 }, // source
      null,            // self
    )
    mount(view, {})
    expect(container.querySelector("span")!.textContent).toBe("dev")
  })

  it("passes key parameter through", () => {
    // Key doesn't affect rendering, just verify it doesn't throw
    const view = jsxDEV("div", { children: "keyed" }, "my-key")
    mount(view, {})
    expect(container.querySelector("div")!.textContent).toBe("keyed")
  })

  it("handles dynamic text children", () => {
    const view = jsxDEV("span", {
      children: (m: { label: string }) => m.label,
    })
    const { signal } = mount(view, { label: "initial" })
    expect(container.querySelector("span")!.textContent).toBe("initial")

    signal.setValue({ label: "updated" })
    expect(container.querySelector("span")!.textContent).toBe("updated")
  })

  it("handles event handlers", () => {
    let clicked = false
    const view = jsxDEV("button", {
      onClick: () => {
        clicked = true
        return null
      },
      children: "click me",
    })
    mount(view, {})
    container.querySelector("button")!.click()
    expect(clicked).toBe(true)
  })
})
