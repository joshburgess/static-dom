import { describe, it, expect, afterEach } from "vitest"
import { array, element, text } from "../src/constructors"
import type { SDOM } from "../src/types"
import { mount, cleanup, type TestHarness } from "./helpers"

interface Item { id: string; label: string }
interface M { items: Item[] }
type Msg = { type: "click"; id: string }

const itemSdom: SDOM<Item, Msg> = element<"li", Item, Msg>("li", {
  on: { click: (_e, m) => ({ type: "click", id: m.id }) },
}, [text(m => m.label)])

function makeArray() {
  return array<M, Item, Msg>(
    "ul",
    m => m.items.map(i => ({ key: i.id, model: i })),
    itemSdom
  )
}

let h: TestHarness<M, Msg>
afterEach(() => { if (h) cleanup(h) })

describe("array", () => {
  it("renders initial items", () => {
    h = mount(makeArray(), { items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("A")
    expect(lis[1]!.textContent).toBe("B")
  })

  it("adds new items", () => {
    h = mount(makeArray(), { items: [{ id: "a", label: "A" }] })
    h.set({ items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[1]!.textContent).toBe("B")
  })

  it("removes items", () => {
    h = mount(makeArray(), { items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    h.set({ items: [{ id: "b", label: "B" }] })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(1)
    expect(lis[0]!.textContent).toBe("B")
  })

  it("reuses DOM nodes by key", () => {
    h = mount(makeArray(), { items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    // Grab a reference to the "b" wrapper
    const wrappers = h.container.querySelectorAll("[data-sd-key]")
    const bWrapper = wrappers[1]!

    // Reverse order — "b" should keep its DOM node
    h.set({ items: [
      { id: "b", label: "B" },
      { id: "a", label: "A" },
    ]})
    const reordered = h.container.querySelectorAll("[data-sd-key]")
    expect(reordered[0]).toBe(bWrapper) // Same DOM node, moved to first position
  })

  it("updates item content when model changes", () => {
    h = mount(makeArray(), { items: [{ id: "a", label: "A" }] })
    h.set({ items: [{ id: "a", label: "A updated" }] })
    expect(h.container.querySelector("li")!.textContent).toBe("A updated")
  })

  it("dispatches events from items", () => {
    h = mount(makeArray(), { items: [{ id: "x", label: "X" }] })
    h.container.querySelector("li")!.click()
    expect(h.dispatched).toEqual([{ type: "click", id: "x" }])
  })

  it("handles empty list", () => {
    h = mount(makeArray(), { items: [] })
    expect(h.container.querySelectorAll("li").length).toBe(0)
  })

  it("handles transition from items to empty", () => {
    h = mount(makeArray(), { items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    h.set({ items: [] })
    expect(h.container.querySelectorAll("li").length).toBe(0)
  })

  it("handles transition from empty to items", () => {
    h = mount(makeArray(), { items: [] })
    h.set({ items: [{ id: "a", label: "A" }] })
    expect(h.container.querySelectorAll("li").length).toBe(1)
  })
})
