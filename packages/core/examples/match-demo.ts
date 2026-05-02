/**
 * examples/match-demo.ts — demonstrates the match constructor
 *
 * Simulates a data-fetching flow: loading → loaded (or error).
 * Shows N-way branch switching with match().
 */

import { element, text, match, program } from "../src/index"

// -- Model ------------------------------------------------------------------

type State =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "loaded"; items: string[]; query: string }

type Msg =
  | { type: "fetch" }
  | { type: "fetchSuccess"; items: string[] }
  | { type: "fetchError"; message: string }
  | { type: "goLoading" }
  | { type: "goError" }
  | { type: "goLoaded" }

// -- Update -----------------------------------------------------------------

function update(msg: Msg, _model: State): State {
  switch (msg.type) {
    case "goLoading":
    case "fetch":
      return { tag: "loading" }
    case "goError":
    case "fetchError":
      return { tag: "error", message: msg.type === "goError" ? "Simulated error: service unavailable" : (msg as { message: string }).message }
    case "goLoaded":
    case "fetchSuccess":
      return {
        tag: "loaded",
        items: msg.type === "goLoaded"
          ? ["Apples", "Bananas", "Cherries", "Dates", "Elderberries"]
          : (msg as { items: string[] }).items,
        query: "",
      }
  }
}

// -- Views ------------------------------------------------------------------

const loadingView = element<"div", State, Msg>("div", {
  rawAttrs: { class: () => "loading" },
}, [
  text(() => "Loading..."),
])

const errorView = element<"div", State, Msg>("div", {
  rawAttrs: { class: () => "error" },
}, [
  element("h3", {}, [text(() => "Something went wrong")]),
  element("p", {}, [text(m => m.tag === "error" ? m.message : "")]),
  element("button", {
    on: { click: () => ({ type: "fetch" }) },
  }, [text(() => "Retry")]),
])

const loadedView = element<"div", State, Msg>("div", {
  rawAttrs: { class: () => "loaded" },
}, [
  element("h3", {}, [text(() => "Results")]),
  element("ul", {}, [
    text(m => {
      if (m.tag !== "loaded") return ""
      return m.items.map(item => `\u2022 ${item}`).join("\n")
    }),
  ]),
])

// match switches between the three branches based on the tag discriminant.
// Same-branch updates (e.g. updating items within "loaded") patch in place.
// Branch switches teardown the old DOM and mount the new branch.
const stateView = element<"div", State, Msg>("div", {}, [
  element("h2", {}, [text(() => "match() demo \u2014 loading states")]),
  element("p", { style: { color: () => "#888" } }, [
    text(() => "Click the buttons to switch between states:"),
  ]),
  element("div", { rawAttrs: { class: () => "state-controls" } }, [
    element("button", {
      classes: m => ({ active: m.tag === "loading" }),
      on: { click: () => ({ type: "goLoading" }) },
    }, [text(() => "Loading")]),
    element("button", {
      classes: m => ({ active: m.tag === "error" }),
      on: { click: () => ({ type: "goError" }) },
    }, [text(() => "Error")]),
    element("button", {
      classes: m => ({ active: m.tag === "loaded" }),
      on: { click: () => ({ type: "goLoaded" }) },
    }, [text(() => "Loaded")]),
  ]),
  match<State, "loading" | "error" | "loaded", Msg>(
    m => m.tag,
    {
      loading: loadingView,
      error: errorView,
      loaded: loadedView,
    },
  ),
])

// -- Mount ------------------------------------------------------------------

export function mountMatchDemo(container: HTMLElement) {
  return program({
    container,
    init: { tag: "loading" } as State,
    update,
    view: stateView,
  })
}
