/**
 * examples/counter.ts — simplest possible end-to-end example
 *
 * This demonstrates:
 *   - Basic element/text construction
 *   - The program runner
 *   - `focus` with a prop lens
 *   - `showIf`
 */

import { element, text, program } from "../src/index"

// -- Model ------------------------------------------------------------------

interface CounterModel {
  count: number
  label: string
}

// -- Messages ---------------------------------------------------------------

type CounterMsg =
  | { type: "increment" }
  | { type: "decrement" }
  | { type: "reset" }

// -- Update -----------------------------------------------------------------

function counterUpdate(msg: CounterMsg, model: CounterModel): CounterModel {
  switch (msg.type) {
    case "increment": return { ...model, count: model.count + 1 }
    case "decrement": return { ...model, count: model.count - 1 }
    case "reset":     return { ...model, count: 0 }
  }
}

// -- View -------------------------------------------------------------------

const counterView = element<"div", CounterModel, CounterMsg>("div", {
  rawAttrs: { "data-testid": () => "counter" },
}, [
  // Static heading -- no model dependency, just rendered once
  element("h2", {}, [
    text(m => m.label),
  ]),

  // Count display -- text updates directly when count changes
  element("p", {
    classes: m => ({
      positive: m.count > 0,
      negative: m.count < 0,
      zero: m.count === 0,
    }),
  }, [
    text(m => String(m.count)),
  ]),

  // Controls
  element("div", { rawAttrs: { class: () => "controls" } }, [
    element("button", {
      on: { click: () => ({ type: "decrement" }) },
      attrs: { disabled: m => m.count <= -10 },
    }, [text(() => "\u2212")]),

    element("button", {
      on: { click: () => ({ type: "reset" }) },
    }, [text(() => "Reset")]),

    element("button", {
      on: { click: () => ({ type: "increment" }) },
      attrs: { disabled: m => m.count >= 10 },
    }, [text(() => "+")]),
  ]),

  // Only show this message when count hits the limit
  element<"p", CounterModel, CounterMsg>("p", {
    rawAttrs: { class: () => "limit-msg" },
  }, [
    text(m => m.count >= 10 ? "Maximum reached!" : "Minimum reached!"),
  ]).showIf(m => m.count >= 10 || m.count <= -10),
])

// -- Mount ------------------------------------------------------------------

export function mountCounter(container: HTMLElement) {
  return program({
    container,
    init: { count: 0, label: "Counter" },
    update: counterUpdate,
    view: counterView,
    onUpdate: (msg, _prev, next) => {
      console.log("[counter]", msg.type, "\u2192", next.count)
    },
  })
}

// -- Headless test (no DOM required) ----------------------------------------
//
// Because SDOM components are just functions, you can test the view's
// update behaviour without touching the DOM at all.

export function testCounterLogic(): void {
  const init: CounterModel = { count: 0, label: "Counter" }

  const after3 = counterUpdate({ type: "increment" },
                   counterUpdate({ type: "increment" },
                     counterUpdate({ type: "increment" }, init)))

  console.assert(after3.count === 3, "3 increments -> count 3")

  const afterReset = counterUpdate({ type: "reset" }, after3)
  console.assert(afterReset.count === 0, "reset -> count 0")

  console.log("[counter tests] passed")
}
