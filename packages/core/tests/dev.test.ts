import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { text, element, array } from "../src/constructors"
import { setDevMode, setDevWarningHandler, resetDevWarnings } from "../src/dev"
import { mount, cleanup, type TestHarness } from "./helpers"

let h: TestHarness<any, any>
let restoreWarnings: (() => void) | null = null
let warnings: string[] = []

beforeEach(() => {
  setDevMode(true)
  resetDevWarnings()
  warnings = []
  restoreWarnings = setDevWarningHandler(msg => warnings.push(msg))
})

afterEach(() => {
  if (h) cleanup(h)
  restoreWarnings?.()
  restoreWarnings = null
  setDevMode(true) // restore default
})

describe("dev mode — model shape validation", () => {
  it("warns when model shape changes (text)", () => {
    const view = text<any>((m) => String(m.count ?? ""))
    h = mount(view, { count: 1, name: "a" })

    // Change shape: add a field
    h.set({ count: 2, name: "b", extra: true })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("model shape changed")
    expect(warnings[0]).toContain("extra")
  })

  it("warns when model changes from object to null", () => {
    const view = text<any>((m) => String(m?.count ?? "null"))
    h = mount(view, { count: 1 })

    h.set(null)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("object to null")
  })

  it("warns when model shape changes (element)", () => {
    const view = element<"div", any, never>("div", {}, [
      text((m) => String(m.count ?? "")),
    ])
    h = mount(view, { count: 1, name: "a" })

    // Remove a field
    h.set({ count: 2 })
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings.some(w => w.includes("model shape changed"))).toBe(true)
  })

  it("does not warn when model shape is unchanged", () => {
    const view = text<{ count: number; name: string }>((m) => `${m.name}:${m.count}`)
    h = mount(view, { count: 1, name: "a" })

    h.set({ count: 2, name: "b" })
    h.set({ count: 3, name: "c" })
    expect(warnings).toHaveLength(0)
  })

  it("does not warn when dev mode is off", () => {
    setDevMode(false)
    const view = text<any>((m) => String(m.count ?? ""))
    h = mount(view, { count: 1, name: "a" })

    h.set({ count: 2, name: "b", extra: true })
    expect(warnings).toHaveLength(0)
  })

  it("only warns once per unique shape change", () => {
    const view = text<any>((m) => String(m.count ?? ""))
    h = mount(view, { count: 1, name: "a" })

    h.set({ count: 2, name: "b", extra: true })
    h.set({ count: 3, name: "c", extra: false })
    // warnOnce should prevent duplicate
    expect(warnings).toHaveLength(1)
  })

  it("skips shape check for primitives", () => {
    const view = text<number>((n) => String(n))
    h = mount(view, 1)

    h.set(2)
    h.set(3)
    expect(warnings).toHaveLength(0)
  })
})

describe("dev mode — duplicate array keys", () => {
  it("warns on duplicate keys", () => {
    interface Item { id: string; label: string }
    const itemView = text<Item>((m) => m.label)
    const view = array<{ items: Item[] }, Item, never>(
      "ul",
      (m) => m.items.map(i => ({ key: i.id, model: i })),
      itemView
    )

    const items = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]
    h = mount(view, { items })

    // Update with duplicate keys
    h.set({
      items: [
        { id: "a", label: "A" },
        { id: "a", label: "A dup" }, // duplicate!
      ],
    })

    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings.some(w => w.includes('duplicate key "a"'))).toBe(true)
  })

  it("does not warn when keys are unique", () => {
    interface Item { id: string; label: string }
    const itemView = text<Item>((m) => m.label)
    const view = array<{ items: Item[] }, Item, never>(
      "ul",
      (m) => m.items.map(i => ({ key: i.id, model: i })),
      itemView
    )

    h = mount(view, { items: [{ id: "a", label: "A" }] })
    h.set({ items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] })
    // Filter out shape warnings — we only care about key warnings
    const keyWarnings = warnings.filter(w => w.includes("duplicate key"))
    expect(keyWarnings).toHaveLength(0)
  })
})
