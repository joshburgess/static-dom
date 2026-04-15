import { describe, it, expect, afterEach } from "vitest"
import { dynamic, element, text } from "../src/constructors"
import { mount, cleanup, type TestHarness } from "./helpers"

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

interface Model {
  layout: "grid" | "list" | "custom"
  data: string
}

const gridView = element<"div", Model, never>("div", {
  rawAttrs: { class: () => "grid" },
}, [text(m => `Grid: ${m.data}`)])

const listView = element<"div", Model, never>("div", {
  rawAttrs: { class: () => "list" },
}, [text(m => `List: ${m.data}`)])

const customView = element<"div", Model, never>("div", {
  rawAttrs: { class: () => "custom" },
}, [text(m => `Custom: ${m.data}`)])

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dynamic", () => {
  let h: TestHarness<Model, never>
  afterEach(() => { if (h) cleanup(h) })

  const view = dynamic<Model, never, string>(
    m => m.layout,
    m => {
      switch (m.layout) {
        case "grid": return gridView
        case "list": return listView
        case "custom": return customView
      }
    },
  )

  it("renders the initial view from the factory", () => {
    h = mount(view, { layout: "grid", data: "hello" })
    expect(h.container.textContent).toContain("Grid: hello")
  })

  it("updates within the same key without remounting (DOM stability)", () => {
    h = mount(view, { layout: "grid", data: "v1" })
    const div = h.container.querySelector("div")!
    expect(div.textContent).toContain("Grid: v1")

    h.set({ layout: "grid", data: "v2" })
    // Same DOM element — proves in-place update, not remount
    expect(h.container.querySelector("div")).toBe(div)
    expect(div.textContent).toContain("Grid: v2")
  })

  it("remounts when key changes", () => {
    h = mount(view, { layout: "grid", data: "g" })
    expect(h.container.querySelector(".grid")).not.toBeNull()

    h.set({ layout: "list", data: "l" })
    expect(h.container.querySelector(".list")).not.toBeNull()
    expect(h.container.querySelector(".grid")).toBeNull()
    expect(h.container.textContent).toContain("List: l")
  })

  it("cycles through multiple keys", () => {
    h = mount(view, { layout: "grid", data: "a" })
    h.set({ layout: "list", data: "b" })
    h.set({ layout: "custom", data: "c" })
    h.set({ layout: "grid", data: "d" })

    expect(h.container.textContent).toContain("Grid: d")
    expect(h.container.querySelectorAll("div").length).toBe(1)
  })

  it("cleans up old DOM when switching", () => {
    h = mount(view, { layout: "grid", data: "x" })
    h.set({ layout: "list", data: "y" })

    const divs = h.container.querySelectorAll("div")
    expect(divs.length).toBe(1)
    expect(divs[0]!.className).toBe("list")
  })

  describe("subscription isolation", () => {
    it("torn-down branch observers stop receiving updates", () => {
      let gridDeriveCalls = 0
      const spyGridView = element<"div", Model, never>("div", {}, [
        text(m => {
          gridDeriveCalls++
          return `Grid: ${m.data}`
        }),
      ])

      const spyView = dynamic<Model, never, string>(
        m => m.layout,
        m => {
          switch (m.layout) {
            case "grid": return spyGridView
            case "list": return listView
            case "custom": return customView
          }
        },
      )

      h = mount(spyView, { layout: "grid", data: "x" })
      const callsAfterMount = gridDeriveCalls

      // Switch away — grid branch should be torn down
      h.set({ layout: "list", data: "y" })
      const callsAfterSwitch = gridDeriveCalls

      // Further updates should NOT reach the old grid observer
      h.set({ layout: "list", data: "z" })
      h.set({ layout: "list", data: "w" })
      expect(gridDeriveCalls).toBe(callsAfterSwitch)
    })
  })

  describe("teardown", () => {
    it("removes all DOM nodes on teardown", () => {
      h = mount(view, { layout: "grid", data: "bye" })
      expect(h.container.querySelector("div")).not.toBeNull()

      h.teardown.teardown()
      expect(h.container.querySelector("div")).toBeNull()
      h.container.remove()
      h = null!
    })
  })

  describe("with cache", () => {
    const cachedView = dynamic<Model, never, string>(
      m => m.layout,
      m => {
        switch (m.layout) {
          case "grid": return gridView
          case "list": return listView
          case "custom": return customView
        }
      },
      { cache: true },
    )

    it("renders the initial view", () => {
      h = mount(cachedView, { layout: "grid", data: "hello" })
      expect(h.container.textContent).toContain("Grid: hello")
    })

    it("switches views", () => {
      h = mount(cachedView, { layout: "grid", data: "g" })
      h.set({ layout: "list", data: "l" })
      expect(h.container.textContent).toContain("List: l")
      expect(h.container.querySelector(".grid")).toBeNull()
    })

    it("reuses cached DOM when returning to a previous key", () => {
      h = mount(cachedView, { layout: "grid", data: "first" })
      const firstDiv = h.container.querySelector("div")!

      h.set({ layout: "list", data: "middle" })
      h.set({ layout: "grid", data: "back" })

      // The same DOM node should be reinserted from cache
      const currentDiv = h.container.querySelector("div")!
      expect(currentDiv).toBe(firstDiv)
    })

    it("updates cached branch content after re-entry", () => {
      h = mount(cachedView, { layout: "grid", data: "before" })
      h.set({ layout: "list", data: "detour" })
      h.set({ layout: "grid", data: "after" })

      // The re-entered branch should show updated data
      expect(h.container.textContent).toContain("Grid: after")
    })

    it("inactive cached branches do not receive updates", () => {
      let gridDeriveCalls = 0
      const spyGridView = element<"div", Model, never>("div", {}, [
        text(m => {
          gridDeriveCalls++
          return `Grid: ${m.data}`
        }),
      ])

      const spyCachedView = dynamic<Model, never, string>(
        m => m.layout,
        m => {
          switch (m.layout) {
            case "grid": return spyGridView
            case "list": return listView
            case "custom": return customView
          }
        },
        { cache: true },
      )

      h = mount(spyCachedView, { layout: "grid", data: "x" })
      const callsAfterMount = gridDeriveCalls

      // Switch away — grid is cached but inactive
      h.set({ layout: "list", data: "y" })
      const callsAfterSwitch = gridDeriveCalls

      // Updates while grid is inactive should not call its derive
      h.set({ layout: "list", data: "z" })
      h.set({ layout: "list", data: "w" })
      expect(gridDeriveCalls).toBe(callsAfterSwitch)
    })

    it("tears down all cached branches on teardown", () => {
      h = mount(cachedView, { layout: "grid", data: "a" })
      h.set({ layout: "list", data: "b" })
      h.set({ layout: "custom", data: "c" })

      h.teardown.teardown()
      expect(h.container.querySelectorAll("div").length).toBe(0)
      h.container.remove()
      h = null!
    })
  })

  describe("event dispatching", () => {
    type Msg = { type: "clicked"; layout: string }
    interface MsgModel { layout: "a" | "b"; label: string }

    const viewA = element<"button", MsgModel, Msg>("button", {
      on: { click: () => ({ type: "clicked", layout: "a" }) },
    }, [text(m => m.label)])

    const viewB = element<"button", MsgModel, Msg>("button", {
      on: { click: () => ({ type: "clicked", layout: "b" }) },
    }, [text(m => m.label)])

    const msgView = dynamic<MsgModel, Msg, string>(
      m => m.layout,
      m => m.layout === "a" ? viewA : viewB,
    )

    let hMsg: TestHarness<MsgModel, Msg>
    afterEach(() => { if (hMsg) cleanup(hMsg) })

    it("dispatches from the active view", () => {
      hMsg = mount(msgView, { layout: "a", label: "click me" })
      hMsg.container.querySelector("button")!.click()
      expect(hMsg.dispatched).toEqual([{ type: "clicked", layout: "a" }])
    })

    it("dispatches from the new view after key change", () => {
      hMsg = mount(msgView, { layout: "a", label: "A" })
      hMsg.set({ layout: "b", label: "B" })
      hMsg.container.querySelector("button")!.click()
      expect(hMsg.dispatched).toEqual([{ type: "clicked", layout: "b" }])
    })
  })
})
