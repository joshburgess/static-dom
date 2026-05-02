import { describe, it, expect, afterEach } from "vitest"
import { text } from "../src/constructors"
import { incrementalArray } from "../src/incremental"
import { keyedOps, keyedInsert, keyedRemove, keyedPatch, keyedMove } from "../src/patch"
import type { SDOM, KeyedItem } from "../src/types"
import type { KeyedArrayDelta } from "../src/patch"
import { element } from "../src/constructors"
import { mount, cleanup, type TestHarness } from "./helpers"

interface Item { id: string; label: string }
interface M {
  items: Item[]
  _ops?: KeyedArrayDelta<Item> | null
}
type Msg = { type: "click"; id: string }

const itemSdom: SDOM<Item, Msg> = element<"li", Item, Msg>("li", {
  on: { click: (_e, m) => ({ type: "click", id: m.id }) },
}, [text(m => m.label)])

function makeIncrArray() {
  return incrementalArray<M, Item, Msg>(
    "ul",
    m => m.items.map(i => ({ key: i.id, model: i })),
    m => m._ops ?? null,
    itemSdom
  )
}

let h: TestHarness<M, Msg>
afterEach(() => { if (h) cleanup(h) })

describe("incrementalArray", () => {
  it("renders initial items", () => {
    h = mount(makeIncrArray(), {
      items: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("A")
    expect(lis[1]!.textContent).toBe("B")
  })

  // ── Incremental (delta-driven) operations ────────────────────────

  it("inserts an item via delta (append)", () => {
    h = mount(makeIncrArray(), {
      items: [{ id: "a", label: "A" }],
    })
    h.set({
      items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      _ops: keyedOps(keyedInsert("b", { id: "b", label: "B" })),
    })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[1]!.textContent).toBe("B")
  })

  it("inserts an item before another via delta", () => {
    h = mount(makeIncrArray(), {
      items: [{ id: "a", label: "A" }, { id: "c", label: "C" }],
    })
    h.set({
      items: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      _ops: keyedOps(keyedInsert("b", { id: "b", label: "B" }, "c")),
    })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(3)
    expect(lis[0]!.textContent).toBe("A")
    expect(lis[1]!.textContent).toBe("B")
    expect(lis[2]!.textContent).toBe("C")
  })

  it("removes an item via delta", () => {
    h = mount(makeIncrArray(), {
      items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    })
    h.set({
      items: [{ id: "a", label: "A" }],
      _ops: keyedOps(keyedRemove("b")),
    })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(1)
    expect(lis[0]!.textContent).toBe("A")
  })

  it("patches an item via delta", () => {
    h = mount(makeIncrArray(), {
      items: [{ id: "a", label: "A" }],
    })
    h.set({
      items: [{ id: "a", label: "A updated" }],
      _ops: keyedOps(keyedPatch("a", { id: "a", label: "A updated" })),
    })
    expect(h.container.querySelector("li")!.textContent).toBe("A updated")
  })

  it("moves an item via delta", () => {
    h = mount(makeIncrArray(), {
      items: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
    })
    // Move "c" before "a" (to the front)
    h.set({
      items: [
        { id: "c", label: "C" },
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      _ops: keyedOps(keyedMove("c", "a")),
    })
    const lis = h.container.querySelectorAll("li")
    expect(lis[0]!.textContent).toBe("C")
    expect(lis[1]!.textContent).toBe("A")
    expect(lis[2]!.textContent).toBe("B")
  })

  it("applies multiple ops in one delta", () => {
    h = mount(makeIncrArray(), {
      items: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    })
    h.set({
      items: [
        { id: "a", label: "A updated" },
        { id: "c", label: "C" },
      ],
      _ops: keyedOps(
        keyedRemove("b"),
        keyedPatch("a", { id: "a", label: "A updated" }),
        keyedInsert("c", { id: "c", label: "C" }),
      ),
    })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("A updated")
    expect(lis[1]!.textContent).toBe("C")
  })

  it("preserves DOM nodes on patch (no remount)", () => {
    h = mount(makeIncrArray(), {
      items: [{ id: "a", label: "A" }],
    })
    const li = h.container.querySelector("li")!

    h.set({
      items: [{ id: "a", label: "A updated" }],
      _ops: keyedOps(keyedPatch("a", { id: "a", label: "A updated" })),
    })

    // Same DOM node — no unmount/remount
    expect(h.container.querySelector("li")).toBe(li)
    expect(li.textContent).toBe("A updated")
  })

  // ── Fallback (no delta) ──────────────────────────────────────────

  it("falls back to full reconcile when no delta", () => {
    h = mount(makeIncrArray(), {
      items: [{ id: "a", label: "A" }],
    })
    h.set({
      items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      // no _ops — triggers fallback
    })
    const lis = h.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[1]!.textContent).toBe("B")
  })

  it("falls back to full reconcile on noop delta", () => {
    h = mount(makeIncrArray(), {
      items: [{ id: "a", label: "A" }],
    })
    h.set({
      items: [{ id: "a", label: "A updated" }],
      _ops: { kind: "noop" },
    })
    // noop delta triggers fallback, which detects the item change
    expect(h.container.querySelector("li")!.textContent).toBe("A updated")
  })

  // ── Events ───────────────────────────────────────────────────────

  it("dispatches events from incrementally-added items", () => {
    h = mount(makeIncrArray(), {
      items: [{ id: "a", label: "A" }],
    })
    h.set({
      items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      _ops: keyedOps(keyedInsert("b", { id: "b", label: "B" })),
    })
    // Click the newly inserted item
    h.container.querySelectorAll("li")[1]!.click()
    expect(h.dispatched).toEqual([{ type: "click", id: "b" }])
  })
})
