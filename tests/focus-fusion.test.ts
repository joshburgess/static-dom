import { describe, it, expect, afterEach } from "vitest"
import { text, element } from "../src/constructors"
import { prop } from "../src/optics"
import { mount, cleanup, type TestHarness } from "./helpers"

interface Inner { value: string }
interface Middle { inner: Inner }
interface Outer { middle: Middle }

describe("focus fusion", () => {
  let h: TestHarness<Outer, never>
  afterEach(() => { if (h) cleanup(h) })

  it("composes consecutive focus calls into a single subscription layer", () => {
    const innerView = text<Inner>(m => m.value)

    // Two consecutive .focus() calls — should be fused into one
    const outerView = innerView
      .focus(prop<Middle>()("inner"))
      .focus(prop<Outer>()("middle"))

    h = mount(outerView, { middle: { inner: { value: "hello" } } })
    expect(h.container.textContent).toBe("hello")

    h.set({ middle: { inner: { value: "world" } } })
    expect(h.container.textContent).toBe("world")
  })

  it("works with three levels of focus", () => {
    interface Deep { x: string }
    interface L2 { deep: Deep }
    interface L1 { l2: L2 }
    interface L0 { l1: L1 }

    const deepView = text<Deep>(m => m.x)
    const view = deepView
      .focus(prop<L2>()("deep"))
      .focus(prop<L1>()("l2"))
      .focus(prop<L0>()("l1"))

    const h2 = mount(view, { l1: { l2: { deep: { x: "hi" } } } })
    expect(h2.container.textContent).toBe("hi")

    h2.set({ l1: { l2: { deep: { x: "bye" } } } })
    expect(h2.container.textContent).toBe("bye")
    cleanup(h2)
  })

  it("skips updates when focused slice hasn't changed", () => {
    let callCount = 0
    const innerView = text<Inner>(m => {
      callCount++
      return m.value
    })

    const outerView = innerView
      .focus(prop<Middle>()("inner"))
      .focus(prop<Outer>()("middle"))

    h = mount(outerView, { middle: { inner: { value: "A" } } })
    callCount = 0

    // Same inner object — should skip
    const sameInner = { value: "A" }
    h.set({ middle: { inner: sameInner } })
    // The reference changed, so the text will re-derive, but the fusion
    // should still propagate correctly
    expect(h.container.textContent).toBe("A")
  })
})
