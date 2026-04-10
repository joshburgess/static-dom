import { describe, it, expect, afterEach } from "vitest"
import { element, text } from "../src/constructors"
import { prop } from "../src/optics"
import type { SDOM } from "../src/types"
import { mount, cleanup, type TestHarness } from "./helpers"

let h: TestHarness<any, any>
afterEach(() => { if (h) cleanup(h) })

describe("focus", () => {
  it("narrows model via a lens", () => {
    interface Outer { inner: { value: string } }
    const inner = element<"span", { value: string }, never>("span", {}, [
      text(m => m.value),
    ])
    const focused = inner.focus(prop<Outer>()("inner"))
    h = mount(focused, { inner: { value: "hello" } })
    expect(h.container.querySelector("span")!.textContent).toBe("hello")
  })

  it("updates when focused slice changes", () => {
    interface Outer { inner: { value: string }; other: number }
    const inner = element<"span", { value: string }, never>("span", {}, [
      text(m => m.value),
    ])
    const focused = inner.focus(prop<Outer>()("inner"))
    h = mount(focused, { inner: { value: "v1" }, other: 0 })
    h.set({ inner: { value: "v2" }, other: 0 })
    expect(h.container.querySelector("span")!.textContent).toBe("v2")
  })

  it("does not fire inner subscription when unrelated slice changes", () => {
    interface Outer { inner: { value: string }; other: number }
    let innerUpdateCount = 0
    const inner = text<{ value: string }>(m => {
      innerUpdateCount++
      return m.value
    })
    const focused = inner.focus(prop<Outer>()("inner"))
    const innerObj = { value: "same" }
    h = mount(focused, { inner: innerObj, other: 0 })
    innerUpdateCount = 0 // reset after initial render

    // Change only the unrelated slice — same inner reference
    h.set({ inner: innerObj, other: 1 })
    expect(innerUpdateCount).toBe(0)

    // Change the focused slice
    h.set({ inner: { value: "changed" }, other: 1 })
    expect(innerUpdateCount).toBe(1)
  })
})

describe("contramap", () => {
  it("narrows model via a function (read-only)", () => {
    interface Outer { nested: { label: string } }
    const inner = text<{ label: string }>(m => m.label)
    const mapped = inner.contramap<Outer>(o => o.nested)
    h = mount(mapped, { nested: { label: "hello" } })
    expect(h.container.textContent).toBe("hello")

    h.set({ nested: { label: "updated" } })
    expect(h.container.textContent).toBe("updated")
  })
})

describe("mapMsg", () => {
  it("transforms outgoing messages", () => {
    type Inner = { type: "raw" }
    type Outer = { type: "wrapped"; inner: Inner }
    const inner: SDOM<{}, Inner> = element<"button", {}, Inner>("button", {
      on: { click: () => ({ type: "raw" }) },
    }, [])
    const mapped = inner.mapMsg<Outer>(msg => ({ type: "wrapped", inner: msg }))
    h = mount(mapped, {})
    h.container.querySelector("button")!.click()
    expect(h.dispatched).toEqual([{ type: "wrapped", inner: { type: "raw" } }])
  })
})

describe("showIf", () => {
  it("shows element when predicate is true", () => {
    const sdom = element<"div", { visible: boolean }, never>("div", {}, [
      text(() => "content"),
    ]).showIf(m => m.visible)
    h = mount(sdom, { visible: true })
    const wrapper = h.container.querySelector("span")!
    expect(wrapper.style.display).toBe("")
  })

  it("hides element when predicate is false", () => {
    const sdom = element<"div", { visible: boolean }, never>("div", {}, [
      text(() => "content"),
    ]).showIf(m => m.visible)
    h = mount(sdom, { visible: false })
    const wrapper = h.container.querySelector("span")!
    expect(wrapper.style.display).toBe("none")
  })

  it("toggles visibility on model change", () => {
    const sdom = element<"div", { visible: boolean }, never>("div", {}, [
      text(() => "content"),
    ]).showIf(m => m.visible)
    h = mount(sdom, { visible: false })
    const wrapper = h.container.querySelector("span")!
    expect(wrapper.style.display).toBe("none")

    h.set({ visible: true })
    expect(wrapper.style.display).toBe("")

    h.set({ visible: false })
    expect(wrapper.style.display).toBe("none")
  })
})
