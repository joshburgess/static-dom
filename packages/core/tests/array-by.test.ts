import { describe, it, expect, afterEach } from "vitest"
import { arrayBy, element, text } from "../src/constructors"
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

function makeArrayBy() {
  return arrayBy<M, Item, Msg>(
    "ul",
    m => m.items,
    i => i.id,
    itemSdom,
  )
}

let h: TestHarness<M, Msg>
afterEach(() => { if (h) cleanup(h) })

describe("arrayBy", () => {
  it("renders initial items", () => {
    h = mount(makeArrayBy(), { items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("A")
    expect(lis[1]!.textContent).toBe("B")
  })

  it("adds new items (append)", () => {
    h = mount(makeArrayBy(), { items: [{ id: "a", label: "A" }] })
    h.set({ items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[1]!.textContent).toBe("B")
  })

  it("removes items", () => {
    h = mount(makeArrayBy(), { items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    h.set({ items: [{ id: "b", label: "B" }] })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(1)
    expect(lis[0]!.textContent).toBe("B")
  })

  it("reuses DOM nodes by key", () => {
    h = mount(makeArrayBy(), { items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    const bLi = h.container.querySelectorAll("li")[1]!

    h.set({ items: [
      { id: "b", label: "B" },
      { id: "a", label: "A" },
    ]})
    const reordered = h.container.querySelectorAll("li")
    expect(reordered[0]).toBe(bLi)
  })

  it("updates item content when model changes", () => {
    h = mount(makeArrayBy(), { items: [{ id: "a", label: "A" }] })
    h.set({ items: [{ id: "a", label: "A updated" }] })
    expect(h.container.querySelector("li")!.textContent).toBe("A updated")
  })

  it("dispatches events from items", () => {
    h = mount(makeArrayBy(), { items: [{ id: "x", label: "X" }] })
    h.container.querySelector("li")!.click()
    expect(h.dispatched).toEqual([{ type: "click", id: "x" }])
  })

  it("handles empty list", () => {
    h = mount(makeArrayBy(), { items: [] })
    expect(h.container.querySelectorAll("li").length).toBe(0)
  })

  it("handles transition from items to empty", () => {
    h = mount(makeArrayBy(), { items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    h.set({ items: [] })
    expect(h.container.querySelectorAll("li").length).toBe(0)
  })

  it("handles transition from empty to items", () => {
    h = mount(makeArrayBy(), { items: [] })
    h.set({ items: [{ id: "a", label: "A" }] })
    expect(h.container.querySelectorAll("li").length).toBe(1)
  })

  it("handles full replacement (all new keys)", () => {
    h = mount(makeArrayBy(), { items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]})
    h.set({ items: [
      { id: "c", label: "C" },
      { id: "d", label: "D" },
    ]})
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("C")
    expect(lis[1]!.textContent).toBe("D")
  })

  it("skips update when item reference unchanged", () => {
    const a = { id: "a", label: "A" }
    const b = { id: "b", label: "B" }
    h = mount(makeArrayBy(), { items: [a, b] })

    // Same references — no update dispatched
    h.set({ items: [a, b] })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("A")
  })

  it("reorder back to original DOM order after a swap (jfb 05_swap1k)", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: String(i + 1),
      label: String(i + 1),
    }))
    h = mount(makeArrayBy(), { items: items.slice() })

    const swap = (data: Item[]) => {
      const next = data.slice()
      const a = next[1]!
      next[1] = next[4]!
      next[4] = a
      return next
    }

    const labels = () =>
      Array.from(h.container.querySelectorAll("li"), li => li.textContent)

    expect(labels()).toEqual(["1", "2", "3", "4", "5", "6"])

    const after1 = swap(items)
    h.set({ items: after1 })
    expect(labels()).toEqual(["1", "5", "3", "4", "2", "6"])

    const after2 = swap(after1)
    h.set({ items: after2 })
    expect(labels()).toEqual(["1", "2", "3", "4", "5", "6"])

    const after3 = swap(after2)
    h.set({ items: after3 })
    expect(labels()).toEqual(["1", "5", "3", "4", "2", "6"])
  })

  describe("Cell-native path (attachToCell)", () => {
    let container: HTMLElement
    let td: Teardown | null = null
    afterEach(() => {
      td?.teardown()
      td = null
      container?.remove()
    })

    it("patches rows in place by key under a cell mount", () => {
      container = document.createElement("div")
      document.body.appendChild(container)
      const v = makeVar<M>({ items: [
        { id: "a", label: "A1" },
        { id: "b", label: "B1" },
      ]})
      td = attachToCell(container, makeArrayBy(), v, () => {})
      const liA = container.querySelector("li")!
      expect(liA.textContent).toBe("A1")

      v.set({ items: [
        { id: "a", label: "A2" },
        { id: "b", label: "B2" },
      ]})
      const lis = container.querySelectorAll("li")
      expect(lis[0]).toBe(liA)
      expect(lis[0]!.textContent).toBe("A2")
      expect(lis[1]!.textContent).toBe("B2")
    })
  })
})
