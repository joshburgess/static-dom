import { describe, it, expect, afterEach } from "vitest"
import { element, text } from "../src/constructors"
import type { SDOM } from "../src/types"
import { mount, cleanup, type TestHarness } from "./helpers"

interface M { name: string; active: boolean; count: number }
type Msg = { type: "clicked" } | { type: "hovered" }

let h: TestHarness<any, any>
afterEach(() => { if (h) cleanup(h) })

describe("element", () => {
  it("creates the correct tag", () => {
    const sdom = element<"section", M, never>("section", {}, [])
    h = mount(sdom, { name: "", active: false, count: 0 })
    expect(h.container.querySelector("section")).not.toBeNull()
  })

  it("sets rawAttrs from model", () => {
    const sdom = element<"div", M, never>("div", {
      rawAttrs: { "data-name": m => m.name },
    }, [])
    h = mount(sdom, { name: "test", active: false, count: 0 })
    const el = h.container.querySelector("div")!
    expect(el.getAttribute("data-name")).toBe("test")

    h.set({ name: "updated", active: false, count: 0 })
    expect(el.getAttribute("data-name")).toBe("updated")
  })

  it("sets prop attrs (IDL properties)", () => {
    const sdom = element<"input", M, never>("input", {
      attrs: { value: m => m.name, disabled: m => m.active },
    }, [])
    h = mount(sdom, { name: "hello", active: false, count: 0 })
    const input = h.container.querySelector("input")!
    expect(input.value).toBe("hello")
    expect(input.disabled).toBe(false)

    h.set({ name: "world", active: true, count: 0 })
    expect(input.value).toBe("world")
    expect(input.disabled).toBe(true)
  })

  it("toggles CSS classes via classes", () => {
    const sdom = element<"div", M, never>("div", {
      classes: m => ({ active: m.active, hidden: !m.active }),
    }, [])
    h = mount(sdom, { name: "", active: false, count: 0 })
    const el = h.container.querySelector("div")!
    expect(el.classList.contains("active")).toBe(false)
    expect(el.classList.contains("hidden")).toBe(true)

    h.set({ name: "", active: true, count: 0 })
    expect(el.classList.contains("active")).toBe(true)
    expect(el.classList.contains("hidden")).toBe(false)
  })

  it("sets inline styles", () => {
    const sdom = element<"div", M, never>("div", {
      style: { color: m => m.active ? "green" : "red" },
    }, [])
    h = mount(sdom, { name: "", active: false, count: 0 })
    const el = h.container.querySelector("div")! as HTMLDivElement
    expect(el.style.color).toBe("red")

    h.set({ name: "", active: true, count: 0 })
    expect(el.style.color).toBe("green")
  })

  it("dispatches messages from event handlers", () => {
    const sdom: SDOM<M, Msg> = element<"button", M, Msg>("button", {
      on: { click: () => ({ type: "clicked" }) },
    }, [])
    h = mount(sdom, { name: "", active: false, count: 0 })
    const btn = h.container.querySelector("button")!
    btn.click()
    expect(h.dispatched).toEqual([{ type: "clicked" }])
  })

  it("passes current model to event handler", () => {
    const sdom = element<"button", M, { type: "info"; name: string }>("button", {
      on: { click: (_e, m) => ({ type: "info", name: m.name }) },
    }, [])
    h = mount(sdom, { name: "alice", active: false, count: 0 })
    h.set({ name: "bob", active: false, count: 0 })
    h.container.querySelector("button")!.click()
    expect(h.dispatched).toEqual([{ type: "info", name: "bob" }])
  })

  it("suppresses dispatch when handler returns null", () => {
    const sdom = element<"button", M, Msg>("button", {
      on: { click: () => null },
    }, [])
    h = mount(sdom, { name: "", active: false, count: 0 })
    h.container.querySelector("button")!.click()
    expect(h.dispatched).toEqual([])
  })

  it("mounts children in order", () => {
    const sdom = element<"div", M, never>("div", {}, [
      text(m => m.name),
      text(m => String(m.count)),
    ])
    h = mount(sdom, { name: "x", active: false, count: 5 })
    const div = h.container.querySelector("div")!
    expect(div.childNodes[0]!.textContent).toBe("x")
    expect(div.childNodes[1]!.textContent).toBe("5")
  })

  it("cleans up on teardown", () => {
    const sdom = element<"div", M, Msg>("div", {
      on: { click: () => ({ type: "clicked" }) },
    }, [text(m => m.name)])
    h = mount(sdom, { name: "test", active: false, count: 0 })
    h.teardown.teardown()
    expect(h.container.querySelector("div")).toBeNull()
    // Events should no longer dispatch
    h.dispatched.length = 0
    h = undefined as any
  })
})
