import { describe, it, expect, afterEach } from "vitest"
import { indexedArray, text, element } from "../src/constructors"
import type { SDOM } from "../src/types"
import { mount, cleanup, type TestHarness } from "./helpers"

interface Item { label: string }
interface M { items: Item[] }
type Msg = never

const itemSdom: SDOM<Item, Msg> = element<"li", Item, Msg>("li", {}, [text(m => m.label)])

function makeIndexed() {
  return indexedArray<M, Item, Msg>(
    "ul",
    m => m.items,
    itemSdom
  )
}

let h: TestHarness<M, Msg>
afterEach(() => { if (h) cleanup(h) })

describe("indexedArray", () => {
  it("renders initial items", () => {
    h = mount(makeIndexed(), {
      items: [{ label: "A" }, { label: "B" }, { label: "C" }],
    })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(3)
    expect(lis[0]!.textContent).toBe("A")
    expect(lis[1]!.textContent).toBe("B")
    expect(lis[2]!.textContent).toBe("C")
  })

  it("updates item content by index", () => {
    h = mount(makeIndexed(), {
      items: [{ label: "A" }, { label: "B" }],
    })
    h.set({ items: [{ label: "A" }, { label: "B updated" }] })
    expect(h.container.querySelectorAll("li")[1]!.textContent).toBe("B updated")
  })

  it("grows the list (appends at end)", () => {
    h = mount(makeIndexed(), {
      items: [{ label: "A" }],
    })
    h.set({ items: [{ label: "A" }, { label: "B" }, { label: "C" }] })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(3)
    expect(lis[2]!.textContent).toBe("C")
  })

  it("shrinks the list (removes from end)", () => {
    h = mount(makeIndexed(), {
      items: [{ label: "A" }, { label: "B" }, { label: "C" }],
    })
    h.set({ items: [{ label: "A" }] })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(1)
    expect(lis[0]!.textContent).toBe("A")
  })

  it("handles empty list", () => {
    h = mount(makeIndexed(), { items: [] })
    expect(h.container.querySelectorAll("li").length).toBe(0)
  })

  it("handles transition from items to empty", () => {
    h = mount(makeIndexed(), {
      items: [{ label: "A" }, { label: "B" }],
    })
    h.set({ items: [] })
    expect(h.container.querySelectorAll("li").length).toBe(0)
  })

  it("handles transition from empty to items", () => {
    h = mount(makeIndexed(), { items: [] })
    h.set({ items: [{ label: "X" }] })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(1)
    expect(lis[0]!.textContent).toBe("X")
  })

  it("re-patches all slots when middle item removed", () => {
    h = mount(makeIndexed(), {
      items: [{ label: "A" }, { label: "B" }, { label: "C" }],
    })
    // Remove middle item — slot 1 gets "C", slot 2 is removed
    h.set({ items: [{ label: "A" }, { label: "C" }] })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("A")
    expect(lis[1]!.textContent).toBe("C")
  })

  it("preserves DOM nodes on patch (no remount)", () => {
    h = mount(makeIndexed(), {
      items: [{ label: "A" }],
    })
    const li = h.container.querySelector("li")!
    h.set({ items: [{ label: "A updated" }] })
    // Same DOM node, just updated content
    expect(h.container.querySelector("li")).toBe(li)
    expect(li.textContent).toBe("A updated")
  })
})
