import { describe, it, expect, afterEach } from "vitest"
import { array, element, text } from "../src/constructors"
import { attachToCell } from "../src/program"
import { makeVar } from "../src/incremental-graph"
import type { SDOM, Teardown } from "../src/types"
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
    // Grab a reference to the "b" item's <li> element
    const lis = h.container.querySelectorAll("li")
    const bLi = lis[1]!

    // Reverse order — "b" should keep its DOM node
    h.set({ items: [
      { id: "b", label: "B" },
      { id: "a", label: "A" },
    ]})
    const reordered = h.container.querySelectorAll("li")
    expect(reordered[0]).toBe(bLi) // Same DOM node, moved to first position
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

  describe("Cell-native path (attachToCell)", () => {
    let container: HTMLElement
    let td: Teardown | null = null
    afterEach(() => {
      td?.teardown()
      td = null
      container?.remove()
    })

    it("renders, patches in place by key, and reorders", () => {
      container = document.createElement("div")
      document.body.appendChild(container)
      const v = makeVar<M>({ items: [
        { id: "a", label: "A1" },
        { id: "b", label: "B1" },
      ]})
      td = attachToCell(container, makeArray(), v, () => {})
      const liA = container.querySelector("li")!
      expect(liA.textContent).toBe("A1")

      // Same keys, changed labels: rows patch in place (no remount).
      v.set({ items: [
        { id: "a", label: "A2" },
        { id: "b", label: "B2" },
      ]})
      const lis = container.querySelectorAll("li")
      expect(lis[0]!.textContent).toBe("A2")
      expect(lis[1]!.textContent).toBe("B2")
      expect(lis[0]).toBe(liA) // same DOM node — Cell-native row patched

      // Reorder: same keys, swapped order.
      v.set({ items: [
        { id: "b", label: "B2" },
        { id: "a", label: "A2" },
      ]})
      const reordered = container.querySelectorAll("li")
      expect(reordered[0]!.textContent).toBe("B2")
      expect(reordered[1]!.textContent).toBe("A2")
    })

    it("dispatches click events from rows under a cell mount", () => {
      container = document.createElement("div")
      document.body.appendChild(container)
      const seen: Msg[] = []
      const v = makeVar<M>({ items: [{ id: "x", label: "X" }] })
      td = attachToCell(container, makeArray(), v, (msg) => seen.push(msg))
      container.querySelector("li")!.dispatchEvent(new Event("click", { bubbles: true }))
      expect(seen).toEqual([{ type: "click", id: "x" }])
    })
  })
})
