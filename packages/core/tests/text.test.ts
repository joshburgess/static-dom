import { describe, it, expect, afterEach } from "vitest"
import { text, staticText } from "../src/constructors"
import { mount, cleanup, type TestHarness } from "./helpers"

let h: TestHarness<any, any>
afterEach(() => { if (h) cleanup(h) })

describe("text", () => {
  it("creates a text node with initial content", () => {
    h = mount(text((m: string) => m), "hello")
    expect(h.container.textContent).toBe("hello")
  })

  it("updates textContent when model changes", () => {
    h = mount(text((m: string) => m), "hello")
    h.set("world")
    expect(h.container.textContent).toBe("world")
  })

  it("preserves text node identity across updates", () => {
    h = mount(text((m: { n: number }) => String(m.n)), { n: 1 })
    const node = h.container.childNodes[0]!
    expect(node.textContent).toBe("1")

    // After update, same DOM node is reused (not replaced)
    h.set({ n: 2 })
    expect(h.container.childNodes[0]).toBe(node)
    expect(node.textContent).toBe("2")

    // Same value — content stays correct, node is same
    h.set({ n: 2 })
    expect(h.container.childNodes[0]).toBe(node)
    expect(node.textContent).toBe("2")
  })

  it("removes the node on teardown", () => {
    h = mount(text((m: string) => m), "hello")
    expect(h.container.childNodes.length).toBe(1)
    h.teardown.teardown()
    expect(h.container.childNodes.length).toBe(0)
    // Prevent double-teardown in afterEach
    h = undefined as any
  })
})

describe("staticText", () => {
  it("creates a text node that never updates", () => {
    h = mount(staticText("fixed"), undefined)
    expect(h.container.textContent).toBe("fixed")
  })
})
