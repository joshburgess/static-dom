import { describe, it, expect, afterEach, beforeAll } from "vitest"
import { createElement, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { SDOMBoundary, useSDOMBoundary } from "../src/react"
import { text, element } from "../src/constructors"
import type { SDOM } from "../src/types"

beforeAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let root: Root
let container: HTMLDivElement

function mount(el: ReturnType<typeof createElement>) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(el)
  })
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
})

// Simple SDOM views for testing
const counterView = element<{ count: number }, never>("span", {}, [
  text((m) => String(m.count)),
])

const labelView = element<{ label: string }, never>("span", {}, [
  text((m) => m.label),
])

// ---------------------------------------------------------------------------
// SDOMBoundary component tests
// ---------------------------------------------------------------------------

describe("SDOMBoundary", () => {
  it("mounts SDOM view into the container", () => {
    mount(
      createElement(SDOMBoundary, {
        sdom: counterView as SDOM<{ count: number }, unknown>,
        model: { count: 42 },
      })
    )

    expect(container.textContent).toBe("42")
  })

  it("updates DOM when model prop changes", () => {
    function App({ count }: { count: number }) {
      return createElement(SDOMBoundary, {
        sdom: counterView as SDOM<{ count: number }, unknown>,
        model: { count },
      })
    }

    mount(createElement(App, { count: 1 }))
    expect(container.textContent).toBe("1")

    act(() => {
      root.render(createElement(App, { count: 2 }))
    })
    expect(container.textContent).toBe("2")

    act(() => {
      root.render(createElement(App, { count: 99 }))
    })
    expect(container.textContent).toBe("99")
  })

  it("calls onMsg when SDOM dispatches a message", () => {
    type Msg = { type: "clicked" }
    const clickView = element<{ label: string }, Msg>(
      "button",
      {
        on: { click: () => ({ type: "clicked" }) },
      },
      [text((m) => m.label)]
    )

    const messages: Msg[] = []

    mount(
      createElement(SDOMBoundary, {
        sdom: clickView as SDOM<{ label: string }, unknown>,
        model: { label: "Click me" },
        onMsg: (msg: unknown) => messages.push(msg as Msg),
      })
    )

    const button = container.querySelector("button")!
    act(() => {
      button.click()
    })

    expect(messages).toEqual([{ type: "clicked" }])
  })

  it("uses the latest onMsg callback (no stale closure)", () => {
    type Msg = { type: "clicked" }
    const clickView = element<{ label: string }, Msg>(
      "button",
      {
        on: { click: () => ({ type: "clicked" }) },
      },
      [text((m) => m.label)]
    )

    const log: string[] = []

    function App({ tag }: { tag: string }) {
      return createElement(SDOMBoundary, {
        sdom: clickView as SDOM<{ label: string }, unknown>,
        model: { label: "btn" },
        onMsg: () => log.push(tag),
      })
    }

    mount(createElement(App, { tag: "first" }))
    act(() => {
      root.render(createElement(App, { tag: "second" }))
    })

    const button = container.querySelector("button")!
    act(() => {
      button.click()
    })

    // Should use the latest callback, not the first one
    expect(log).toEqual(["second"])
  })

  it("tears down SDOM on unmount", () => {
    mount(
      createElement(SDOMBoundary, {
        sdom: counterView as SDOM<{ count: number }, unknown>,
        model: { count: 1 },
      })
    )

    expect(container.querySelector("span")).not.toBeNull()

    act(() => {
      root.render(null)
    })

    // After unmount, the SDOM nodes should be gone (React unmounts the
    // container div, and SDOM's teardown is called)
    expect(container.querySelector("span")).toBeNull()
  })

  it("remounts when sdom prop changes", () => {
    function App({ useLabel }: { useLabel: boolean }) {
      const sdom = useLabel ? labelView : counterView
      const model = useLabel ? { label: "hello" } : { count: 7 }
      return createElement(SDOMBoundary, {
        sdom: sdom as SDOM<any, unknown>,
        model,
      })
    }

    mount(createElement(App, { useLabel: false }))
    expect(container.textContent).toBe("7")

    act(() => {
      root.render(createElement(App, { useLabel: true }))
    })
    expect(container.textContent).toBe("hello")
  })

  it("renders with custom container tag via 'as' prop", () => {
    mount(
      createElement(SDOMBoundary, {
        sdom: counterView as SDOM<{ count: number }, unknown>,
        model: { count: 5 },
        as: "section",
      })
    )

    expect(container.querySelector("section")).not.toBeNull()
    expect(container.querySelector("section")!.textContent).toBe("5")
  })
})

// ---------------------------------------------------------------------------
// useSDOMBoundary hook tests
// ---------------------------------------------------------------------------

describe("useSDOMBoundary", () => {
  it("mounts SDOM into the ref element", () => {
    function App({ count }: { count: number }) {
      const ref = useSDOMBoundary(
        counterView as SDOM<{ count: number }, unknown>,
        { count }
      )
      return createElement("div", { ref })
    }

    mount(createElement(App, { count: 10 }))
    expect(container.textContent).toBe("10")
  })

  it("updates DOM when model changes", () => {
    function App({ count }: { count: number }) {
      const ref = useSDOMBoundary(
        counterView as SDOM<{ count: number }, unknown>,
        { count }
      )
      return createElement("div", { ref })
    }

    mount(createElement(App, { count: 1 }))
    expect(container.textContent).toBe("1")

    act(() => {
      root.render(createElement(App, { count: 42 }))
    })
    expect(container.textContent).toBe("42")
  })

  it("dispatches messages via onMsg", () => {
    type Msg = { type: "clicked" }
    const clickView = element<{ label: string }, Msg>(
      "button",
      {
        on: { click: () => ({ type: "clicked" }) },
      },
      [text((m) => m.label)]
    )

    const messages: Msg[] = []

    function App() {
      const ref = useSDOMBoundary(
        clickView as SDOM<{ label: string }, unknown>,
        { label: "Go" },
        (msg: unknown) => messages.push(msg as Msg)
      )
      return createElement("div", { ref })
    }

    mount(createElement(App))

    const button = container.querySelector("button")!
    act(() => {
      button.click()
    })

    expect(messages).toEqual([{ type: "clicked" }])
  })
})
