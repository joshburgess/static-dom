import { describe, it, expect, afterEach, vi } from "vitest"
import { match, element, text } from "../src/constructors"
import { attachToCell } from "../src/program"
import { makeVar } from "../src/incremental-graph"
import { mount, cleanup, type TestHarness } from "./helpers"
import type { Teardown } from "../src/types"

// ---------------------------------------------------------------------------
// Tagged union model
// ---------------------------------------------------------------------------

type State =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "loaded"; data: string }

// Views typed as SDOM<State, never> for use with both overloads
const stateLoadingView = element<"div", State, never>("div", {
  rawAttrs: { class: () => "loading" },
}, [text(() => "Loading...")])

const stateErrorView = element<"div", State, never>("div", {
  rawAttrs: { class: () => "error" },
}, [text(m => m.tag === "error" ? `Error: ${(m as State & { tag: "error" }).message}` : "")])

const stateLoadedView = element<"div", State, never>("div", {
  rawAttrs: { class: () => "loaded" },
}, [text(m => m.tag === "loaded" ? (m as State & { tag: "loaded" }).data : "")])

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("match", () => {
  let h: TestHarness<State, never>
  afterEach(() => { if (h) cleanup(h) })

  describe("function discriminant", () => {
    const view = match<State, "loading" | "error" | "loaded", never>(
      m => m.tag,
      {
        loading: stateLoadingView,
        error: stateErrorView,
        loaded: stateLoadedView,
      },
    )

    it("renders the initial matching branch", () => {
      h = mount(view, { tag: "loading" })
      expect(h.container.textContent).toContain("Loading...")
    })

    it("renders error branch initially", () => {
      h = mount(view, { tag: "error", message: "not found" })
      expect(h.container.textContent).toContain("Error: not found")
    })

    it("renders loaded branch initially", () => {
      h = mount(view, { tag: "loaded", data: "hello world" })
      expect(h.container.textContent).toContain("hello world")
    })

    it("switches branches when discriminant changes", () => {
      h = mount(view, { tag: "loading" })
      expect(h.container.textContent).toContain("Loading...")

      h.set({ tag: "error", message: "timeout" })
      expect(h.container.textContent).toContain("Error: timeout")
      expect(h.container.textContent).not.toContain("Loading...")

      h.set({ tag: "loaded", data: "data!" })
      expect(h.container.textContent).toContain("data!")
      expect(h.container.textContent).not.toContain("Error")
    })

    it("updates within the same branch without remounting (DOM stability)", () => {
      h = mount(view, { tag: "error", message: "first" })
      const div = h.container.querySelector("div")!
      expect(div.textContent).toContain("Error: first")

      h.set({ tag: "error", message: "second" })
      // Same DOM element reference — proves in-place update, not teardown+remount
      expect(h.container.querySelector("div")).toBe(div)
      expect(div.textContent).toContain("Error: second")
    })

    it("switches back to a previously active branch", () => {
      h = mount(view, { tag: "loading" })
      h.set({ tag: "loaded", data: "data" })
      h.set({ tag: "loading" })
      expect(h.container.textContent).toContain("Loading...")
      expect(h.container.textContent).not.toContain("data")
    })

    it("cleans up DOM nodes when switching branches", () => {
      h = mount(view, { tag: "loading" })
      expect(h.container.querySelector(".loading")).not.toBeNull()

      h.set({ tag: "loaded", data: "data" })
      // The old div should be replaced, not left behind
      const divs = h.container.querySelectorAll("div")
      expect(divs.length).toBe(1)
      expect(divs[0]!.className).toBe("loaded")
    })
  })

  describe("property discriminant", () => {
    const view = match<State, "tag", never, Record<State["tag"], typeof stateLoadingView>>(
      "tag",
      {
        loading: stateLoadingView,
        error: stateErrorView,
        loaded: stateLoadedView,
      },
    )

    it("renders the matching branch", () => {
      h = mount(view, { tag: "loaded", data: "test" })
      expect(h.container.textContent).toContain("test")
    })

    it("switches on property change", () => {
      h = mount(view, { tag: "loading" })
      h.set({ tag: "loaded", data: "done" })
      expect(h.container.textContent).toContain("done")
      expect(h.container.textContent).not.toContain("Loading")
    })

    it("handles all three branches", () => {
      h = mount(view, { tag: "error", message: "broken" })
      expect(h.container.textContent).toContain("Error: broken")

      h.set({ tag: "loading" })
      expect(h.container.textContent).toContain("Loading...")

      h.set({ tag: "loaded", data: "fixed" })
      expect(h.container.textContent).toContain("fixed")
    })
  })

  describe("subscription isolation", () => {
    const view = match<State, "loading" | "error" | "loaded", never>(
      m => m.tag,
      {
        loading: stateLoadingView,
        error: stateErrorView,
        loaded: stateLoadedView,
      },
    )

    it("torn-down branch observers stop receiving updates", () => {
      // We'll spy on the error view's text derive to confirm it stops being called
      let errorDeriveCalls = 0
      const spyErrorView = element<"div", State, never>("div", {}, [
        text(m => {
          errorDeriveCalls++
          return m.tag === "error" ? `Error: ${(m as State & { tag: "error" }).message}` : ""
        }),
      ])

      const spyView = match<State, "loading" | "error" | "loaded", never>(
        m => m.tag,
        {
          loading: stateLoadingView,
          error: spyErrorView,
          loaded: stateLoadedView,
        },
      )

      h = mount(spyView, { tag: "error", message: "x" })
      const callsAfterMount = errorDeriveCalls

      // Switch away from error — error branch should be torn down
      h.set({ tag: "loading" })
      const callsAfterSwitch = errorDeriveCalls

      // Further updates should NOT call the error derive
      h.set({ tag: "loading" })
      h.set({ tag: "loading" })
      expect(errorDeriveCalls).toBe(callsAfterSwitch)
    })
  })

  describe("missing discriminant key", () => {
    const view = match<State, "loading" | "error" | "loaded", never>(
      m => m.tag,
      {
        loading: stateLoadingView,
        error: stateErrorView,
        loaded: stateLoadedView,
      },
    )

    it("renders nothing for a key not in branches", () => {
      // Force a key that doesn't match any branch
      const badView = match<{ tag: string }, string, never>(
        m => m.tag,
        { a: element<"div", { tag: string }, never>("div", {}, [text(() => "A")]) },
      )
      const bh = mount(badView, { tag: "nonexistent" })
      expect(bh.container.querySelector("div")).toBeNull()
      cleanup(bh)
    })
  })

  describe("teardown", () => {
    const view = match<State, "loading" | "error" | "loaded", never>(
      m => m.tag,
      {
        loading: stateLoadingView,
        error: stateErrorView,
        loaded: stateLoadedView,
      },
    )

    it("removes all DOM nodes on teardown", () => {
      h = mount(view, { tag: "loaded", data: "data" })
      expect(h.container.querySelector("div")).not.toBeNull()

      h.teardown.teardown()
      expect(h.container.querySelector("div")).toBeNull()
      h.container.remove()
      h = null!
    })
  })

  describe("event dispatching", () => {
    type Msg = { type: "clicked"; from: string }

    const clickLoading = element<"button", State, Msg>("button", {
      on: { click: () => ({ type: "clicked", from: "loading" }) },
    }, [text(() => "Load")])

    const clickLoaded = element<"button", State, Msg>("button", {
      on: { click: () => ({ type: "clicked", from: "loaded" }) },
    }, [text(() => "Done")])

    const clickError = element<"button", State, Msg>("button", {
      on: { click: () => ({ type: "clicked", from: "error" }) },
    }, [text(() => "Err")])

    const view = match<State, "loading" | "error" | "loaded", Msg>(
      m => m.tag,
      {
        loading: clickLoading,
        error: clickError,
        loaded: clickLoaded,
      },
    )

    let hMsg: TestHarness<State, Msg>
    afterEach(() => { if (hMsg) cleanup(hMsg) })

    it("dispatches messages from the active branch", () => {
      hMsg = mount(view, { tag: "loading" })
      hMsg.container.querySelector("button")!.click()
      expect(hMsg.dispatched).toEqual([{ type: "clicked", from: "loading" }])
    })

    it("dispatches from the correct branch after switching", () => {
      hMsg = mount(view, { tag: "loading" })
      hMsg.set({ tag: "loaded", data: "x" })
      hMsg.container.querySelector("button")!.click()
      expect(hMsg.dispatched).toEqual([{ type: "clicked", from: "loaded" }])
    })
  })

  describe("Cell-native path (attachToCell)", () => {
    let container: HTMLElement
    let td: Teardown | null = null
    afterEach(() => {
      td?.teardown()
      td = null
      container?.remove()
    })

    const view = match<State, "loading" | "error" | "loaded", never>(
      m => m.tag,
      {
        loading: stateLoadingView,
        error: stateErrorView,
        loaded: stateLoadedView,
      },
    )

    it("renders the initial branch and updates within the same branch", () => {
      container = document.createElement("div")
      document.body.appendChild(container)
      const v = makeVar<State>({ tag: "error", message: "oops" })
      td = attachToCell(container, view, v, () => {})
      expect(container.textContent).toContain("Error: oops")
      v.set({ tag: "error", message: "later" })
      expect(container.textContent).toContain("Error: later")
    })

    it("swaps branches when the discriminant changes", () => {
      container = document.createElement("div")
      document.body.appendChild(container)
      const v = makeVar<State>({ tag: "loading" })
      td = attachToCell(container, view, v, () => {})
      expect(container.textContent).toContain("Loading")

      v.set({ tag: "loaded", data: "ok" })
      expect(container.querySelector(".loading")).toBeNull()
      expect(container.textContent).toContain("ok")

      v.set({ tag: "error", message: "bad" })
      expect(container.querySelector(".loaded")).toBeNull()
      expect(container.textContent).toContain("Error: bad")
    })
  })
})
