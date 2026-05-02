/**
 * Benchmark: Compiled vs Non-Compiled Templates
 *
 * Measures the performance difference between three ways to build the
 * same DOM tree:
 *
 *   1. `element()` chain — standard SDOM constructors. Each element with
 *      dynamic attrs gets its own subscription in the update stream, and
 *      each subscription runs its own updater loop. For a 5-level tree
 *      with 2 dynamic attrs per level, that's ~10 independent observers.
 *
 *   2. `compiled()` — hand-written imperative DOM setup with a single
 *      fused observer. One subscription, one `update(prev, next)` call
 *      that patches all ~10 dynamic values in a tight loop. Eliminates
 *      per-element subscription overhead.
 *
 *   3. `jsx()` — JSX that auto-compiles into a single observer via the
 *      compiled template path in jsx-runtime.ts. Should match `compiled()`
 *      performance since it generates the same fused observer pattern.
 *
 * Setup: A model with 10 dynamic fields. The DOM tree is 5 levels of nested
 * divs, each with a dynamic `class` and `data-value` attribute derived from
 * distinct model fields. We mount the tree, then measure update throughput
 * by setting a new model on every iteration.
 *
 * What this reveals:
 *   - Per-subscription overhead of element() chains
 *   - Benefit of compiled() single-observer fusion
 *   - Whether jsx() auto-compilation matches hand-written compiled()
 */

import { bench, describe } from "vitest"
import { text, element, compiled } from "../src/constructors"
import { jsx } from "../src/jsx-runtime"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import type { Teardown } from "../src/types"

// ---------------------------------------------------------------------------
// Model with 10 dynamic fields
// ---------------------------------------------------------------------------

interface Model {
  f0: string
  f1: string
  f2: string
  f3: string
  f4: string
  f5: string
  f6: string
  f7: string
  f8: string
  f9: string
}

function makeModel(tick: number): Model {
  return {
    f0: `v0-${tick}`,
    f1: `v1-${tick}`,
    f2: `v2-${tick}`,
    f3: `v3-${tick}`,
    f4: `v4-${tick}`,
    f5: `v5-${tick}`,
    f6: `v6-${tick}`,
    f7: `v7-${tick}`,
    f8: `v8-${tick}`,
    f9: `v9-${tick}`,
  }
}

// ---------------------------------------------------------------------------
// 1. element() chain — N observers per N attrs/children
//
// 5 nested divs, each with 2 dynamic attributes (class + data-value).
// Each element() creates its own subscription to the update stream.
// Total: ~5 subscriptions (one per element with dynamic attrs).
// ---------------------------------------------------------------------------

const elementChainView = element<"div", Model, never>("div", {
  rawAttrs: {
    class: (m) => m.f0,
    "data-value": (m) => m.f1,
  },
}, [
  element<"div", Model, never>("div", {
    rawAttrs: {
      class: (m) => m.f2,
      "data-value": (m) => m.f3,
    },
  }, [
    element<"div", Model, never>("div", {
      rawAttrs: {
        class: (m) => m.f4,
        "data-value": (m) => m.f5,
      },
    }, [
      element<"div", Model, never>("div", {
        rawAttrs: {
          class: (m) => m.f6,
          "data-value": (m) => m.f7,
        },
      }, [
        element<"div", Model, never>("div", {
          rawAttrs: {
            class: (m) => m.f8,
            "data-value": (m) => m.f9,
          },
        }, [
          text<Model>((m) => `${m.f0} ${m.f9}`),
        ]),
      ]),
    ]),
  ]),
])

// ---------------------------------------------------------------------------
// 2. compiled() — single fused observer
//
// Same DOM structure, but created imperatively with document.createElement.
// One subscription, one update function that patches everything.
// ---------------------------------------------------------------------------

const compiledView = compiled<Model, never>((parent, model, _dispatch) => {
  // Level 0
  const d0 = document.createElement("div")
  let last_d0_cls = model.f0
  d0.className = last_d0_cls
  let last_d0_val = model.f1
  d0.setAttribute("data-value", last_d0_val)

  // Level 1
  const d1 = document.createElement("div")
  let last_d1_cls = model.f2
  d1.className = last_d1_cls
  let last_d1_val = model.f3
  d1.setAttribute("data-value", last_d1_val)

  // Level 2
  const d2 = document.createElement("div")
  let last_d2_cls = model.f4
  d2.className = last_d2_cls
  let last_d2_val = model.f5
  d2.setAttribute("data-value", last_d2_val)

  // Level 3
  const d3 = document.createElement("div")
  let last_d3_cls = model.f6
  d3.className = last_d3_cls
  let last_d3_val = model.f7
  d3.setAttribute("data-value", last_d3_val)

  // Level 4
  const d4 = document.createElement("div")
  let last_d4_cls = model.f8
  d4.className = last_d4_cls
  let last_d4_val = model.f9
  d4.setAttribute("data-value", last_d4_val)

  // Leaf text
  let last_text = `${model.f0} ${model.f9}`
  const textNode = document.createTextNode(last_text)

  // Assemble tree
  d4.appendChild(textNode)
  d3.appendChild(d4)
  d2.appendChild(d3)
  d1.appendChild(d2)
  d0.appendChild(d1)
  parent.appendChild(d0)

  return {
    update(_prev: Model, next: Model) {
      // Each comparison + assignment is a single DOM write.
      // All 10 dynamic values are checked in one tight loop body.
      if (next.f0 !== last_d0_cls) { last_d0_cls = next.f0; d0.className = next.f0 }
      if (next.f1 !== last_d0_val) { last_d0_val = next.f1; d0.setAttribute("data-value", next.f1) }
      if (next.f2 !== last_d1_cls) { last_d1_cls = next.f2; d1.className = next.f2 }
      if (next.f3 !== last_d1_val) { last_d1_val = next.f3; d1.setAttribute("data-value", next.f3) }
      if (next.f4 !== last_d2_cls) { last_d2_cls = next.f4; d2.className = next.f4 }
      if (next.f5 !== last_d2_val) { last_d2_val = next.f5; d2.setAttribute("data-value", next.f5) }
      if (next.f6 !== last_d3_cls) { last_d3_cls = next.f6; d3.className = next.f6 }
      if (next.f7 !== last_d3_val) { last_d3_val = next.f7; d3.setAttribute("data-value", next.f7) }
      if (next.f8 !== last_d4_cls) { last_d4_cls = next.f8; d4.className = next.f8 }
      if (next.f9 !== last_d4_val) { last_d4_val = next.f9; d4.setAttribute("data-value", next.f9) }

      const txt = `${next.f0} ${next.f9}`
      if (txt !== last_text) { last_text = txt; textNode.textContent = txt }
    },
    teardown() {
      d0.remove()
    },
  }
})

// ---------------------------------------------------------------------------
// 3. jsx() — auto-compiled template
//
// Uses the jsx-runtime which detects compilable children and generates a
// compiled() node with a single fused observer. Should be equivalent to
// the hand-written compiled() above.
// ---------------------------------------------------------------------------

const jsxView = jsx("div", {
  class: (m: Model) => m.f0,
  "data-value": (m: Model) => m.f1,
  children: jsx("div", {
    class: (m: Model) => m.f2,
    "data-value": (m: Model) => m.f3,
    children: jsx("div", {
      class: (m: Model) => m.f4,
      "data-value": (m: Model) => m.f5,
      children: jsx("div", {
        class: (m: Model) => m.f6,
        "data-value": (m: Model) => m.f7,
        children: jsx("div", {
          class: (m: Model) => m.f8,
          "data-value": (m: Model) => m.f9,
          children: (m: Model) => `${m.f0} ${m.f9}`,
        }),
      }),
    }),
  }),
})

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("compiled vs non-compiled templates — 5-level tree, 10 dynamic attrs", () => {
  // ─── element() chain ────────────────────────────────────────────────

  let elemSig: ReturnType<typeof createSignal<Model>>
  let elemTeardown: Teardown
  let elemTick: number

  bench("element() chain", () => {
    elemTick++
    elemSig.setValue(makeModel(elemTick))
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      elemTick = 0

      const model = makeModel(0)
      elemSig = createSignal<Model>(model)
      const updates = toUpdateStream(elemSig)
      const dispatch: Dispatcher<never> = () => {}
      elemTeardown = elementChainView.attach(container, model, updates, dispatch)
    },
    teardown() {
      elemTeardown.teardown()
    },
  })

  // ─── compiled() ─────────────────────────────────────────────────────

  let compSig: ReturnType<typeof createSignal<Model>>
  let compTeardown: Teardown
  let compTick: number

  bench("compiled()", () => {
    compTick++
    compSig.setValue(makeModel(compTick))
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      compTick = 0

      const model = makeModel(0)
      compSig = createSignal<Model>(model)
      const updates = toUpdateStream(compSig)
      const dispatch: Dispatcher<never> = () => {}
      compTeardown = compiledView.attach(container, model, updates, dispatch)
    },
    teardown() {
      compTeardown.teardown()
    },
  })

  // ─── jsx() auto-compiled ────────────────────────────────────────────

  let jsxSig: ReturnType<typeof createSignal<Model>>
  let jsxTeardown: Teardown
  let jsxTick: number

  bench("jsx() auto-compiled", () => {
    jsxTick++
    jsxSig.setValue(makeModel(jsxTick))
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      jsxTick = 0

      const model = makeModel(0)
      jsxSig = createSignal<Model>(model)
      const updates = toUpdateStream(jsxSig)
      const dispatch: Dispatcher<never> = () => {}
      jsxTeardown = jsxView.attach(container, model, updates, dispatch)
    },
    teardown() {
      jsxTeardown.teardown()
    },
  })
})
