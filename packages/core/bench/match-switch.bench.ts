/**
 * Benchmark: match branch switching and same-branch updates.
 *
 * Two scenarios:
 * 1. Same-branch update — discriminant stays the same, only leaf data changes.
 *    This is the common case (e.g. updating data on the "loaded" page).
 *    SDOM should patch leaf values directly, O(leaf changes).
 *
 * 2. Branch switch — discriminant changes, requiring teardown + mount.
 *    Less frequent (e.g. route changes, loading→loaded transitions).
 *    Cost is proportional to the branch being swapped.
 *
 * Compared against:
 * - Nested optional() calls (the old way to achieve N-way switching)
 * - React conditional rendering
 */

import { bench, describe } from "vitest"
import { createElement } from "react"
import { createRoot, type Root as ReactRoot } from "react-dom/client"
import { match, optional, element, text } from "../src/constructors"
import { prism } from "../src/optics"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { setGuardEnabled } from "../src/errors"
import { setDevMode } from "../src/dev"
import type { Teardown } from "../src/types"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type State =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "loaded"; items: string[] }

const ITEM_COUNT = 100

function makeLoadedState(n: number): State {
  return {
    tag: "loaded",
    items: Array.from({ length: n }, (_, i) => `Item ${i}`),
  }
}

// ---------------------------------------------------------------------------
// SDOM views
// ---------------------------------------------------------------------------

const loadingView = element<"div", State, never>("div", {
  rawAttrs: { class: () => "loading" },
}, [text(() => "Loading...")])

const errorView = element<"div", State, never>("div", {
  rawAttrs: { class: () => "error" },
}, [text(m => m.tag === "error" ? (m as State & { tag: "error" }).message : "")])

const loadedView = element<"div", State, never>("div", {
  rawAttrs: { class: () => "loaded" },
}, [text(m => m.tag === "loaded" ? (m as State & { tag: "loaded" }).items.join(", ") : "")])

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("match — same-branch update", () => {
  // ─── match() ─────────────────────────────────────────────────────────

  let matchSignal: ReturnType<typeof createSignal<State>>
  let matchTeardown: Teardown
  let tick = 0

  bench("match", () => {
    tick++
    matchSignal.setValue(makeLoadedState(ITEM_COUNT + (tick % 2)))
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      document.body.appendChild(container)

      const view = match<State, "loading" | "error" | "loaded", never>(
        m => m.tag,
        { loading: loadingView, error: errorView, loaded: loadedView },
      )

      tick = 0
      const initial = makeLoadedState(ITEM_COUNT)
      matchSignal = createSignal<State>(initial)
      const updates = toUpdateStream(matchSignal)
      matchTeardown = view.attach(container, initial, updates, (() => {}) as Dispatcher<never>)
    },
    teardown() {
      matchTeardown.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })

  // ─── React ───────────────────────────────────────────────────────────

  let reactRoot: ReactRoot
  let reactState: State

  bench("react conditional", () => {
    tick++
    reactState = makeLoadedState(ITEM_COUNT + (tick % 2))
    reactRoot.render(ReactApp(reactState))
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      tick = 0
      reactState = makeLoadedState(ITEM_COUNT)
      reactRoot = createRoot(container)
      reactRoot.render(ReactApp(reactState))
    },
    teardown() {
      reactRoot.unmount()
    },
  })
})

describe("match — branch switch", () => {
  let matchSignal: ReturnType<typeof createSignal<State>>
  let matchTeardown: Teardown
  let tick = 0

  const states: State[] = [
    { tag: "loading" },
    { tag: "error", message: "something went wrong" },
    makeLoadedState(ITEM_COUNT),
  ]

  bench("match", () => {
    tick++
    matchSignal.setValue(states[tick % 3]!)
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      document.body.appendChild(container)

      const view = match<State, "loading" | "error" | "loaded", never>(
        m => m.tag,
        { loading: loadingView, error: errorView, loaded: loadedView },
      )

      tick = 0
      matchSignal = createSignal<State>(states[0]!)
      const updates = toUpdateStream(matchSignal)
      matchTeardown = view.attach(container, states[0]!, updates, (() => {}) as Dispatcher<never>)
    },
    teardown() {
      matchTeardown.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })

  // ─── React ───────────────────────────────────────────────────────────

  let reactRoot: ReactRoot
  let reactTick = 0

  bench("react conditional", () => {
    reactTick++
    reactRoot.render(ReactApp(states[reactTick % 3]!))
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      reactTick = 0
      reactRoot = createRoot(container)
      reactRoot.render(ReactApp(states[0]!))
    },
    teardown() {
      reactRoot.unmount()
    },
  })
})

// ---------------------------------------------------------------------------
// React comparison component
// ---------------------------------------------------------------------------

function ReactApp(state: State) {
  switch (state.tag) {
    case "loading":
      return createElement("div", { className: "loading" }, "Loading...")
    case "error":
      return createElement("div", { className: "error" }, state.message)
    case "loaded":
      return createElement("div", { className: "loaded" }, state.items.join(", "))
  }
}
