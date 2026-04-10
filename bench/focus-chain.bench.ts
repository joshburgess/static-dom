/**
 * Benchmark: Focus Chain Depth
 *
 * Measures how the depth of a focus chain (lens composition via `.focus()`)
 * affects update latency. Each `.focus()` adds an intermediate subscription
 * layer that projects the outer model to a sub-model and filters by reference
 * equality. Focus fusion (in types.ts) should collapse consecutive `.focus()`
 * calls into a single composed lens, but the composed lens still runs N
 * `get` calls per update.
 *
 * Setup: A deeply nested model `{ a: { b: { c: { ... leaf: string } } } }`.
 * 100 `text()` leaves are each focused through N levels of `prop()` lenses,
 * mounted under a single parent. We then measure the time to set a new root
 * model, which propagates through all focus chains to update every leaf.
 *
 * What this reveals:
 *   - O(depth) cost per leaf update from lens `get` calls
 *   - Whether focus fusion eliminates intermediate subscriptions
 *   - Scaling behavior as component trees get deeper
 */

import { bench, describe } from "vitest"
import { text, element, fragment } from "../src/constructors"
import { prop } from "../src/optics"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import type { Teardown } from "../src/types"

// ---------------------------------------------------------------------------
// Nested model types — each level wraps the next in a named field
// ---------------------------------------------------------------------------

interface L20 { leaf: string }
interface L19 { l20: L20 }
interface L18 { l19: L19 }
interface L17 { l18: L18 }
interface L16 { l17: L17 }
interface L15 { l16: L16 }
interface L14 { l15: L15 }
interface L13 { l14: L14 }
interface L12 { l13: L13 }
interface L11 { l12: L12 }
interface L10 { l11: L11 }
interface L9 { l10: L10 }
interface L8 { l9: L9 }
interface L7 { l8: L8 }
interface L6 { l7: L7 }
interface L5 { l6: L6 }
interface L4 { l5: L5 }
interface L3 { l4: L4 }
interface L2 { l3: L3 }
interface L1 { l2: L2 }

// The root model wraps L1
interface RootModel { l1: L1 }

// ---------------------------------------------------------------------------
// Lens chains — each depth level composes one more `prop()` lens
// ---------------------------------------------------------------------------

const l1Lens = prop<RootModel>()("l1")
const l2Lens = l1Lens.compose(prop<L1>()("l2"))
const l3Lens = l2Lens.compose(prop<L2>()("l3"))
const l4Lens = l3Lens.compose(prop<L3>()("l4"))
const l5Lens = l4Lens.compose(prop<L4>()("l5"))
const l6Lens = l5Lens.compose(prop<L5>()("l6"))
const l7Lens = l6Lens.compose(prop<L6>()("l7"))
const l8Lens = l7Lens.compose(prop<L7>()("l8"))
const l9Lens = l8Lens.compose(prop<L8>()("l9"))
const l10Lens = l9Lens.compose(prop<L9>()("l10"))
const l11Lens = l10Lens.compose(prop<L10>()("l11"))
const l12Lens = l11Lens.compose(prop<L11>()("l12"))
const l13Lens = l12Lens.compose(prop<L12>()("l13"))
const l14Lens = l13Lens.compose(prop<L13>()("l14"))
const l15Lens = l14Lens.compose(prop<L14>()("l15"))
const l16Lens = l15Lens.compose(prop<L15>()("l16"))
const l17Lens = l16Lens.compose(prop<L16>()("l17"))
const l18Lens = l17Lens.compose(prop<L17>()("l18"))
const l19Lens = l18Lens.compose(prop<L18>()("l19"))
const l20Lens = l19Lens.compose(prop<L19>()("l20"))

// Leaf lens reads the string at the bottom
const leafFromL20 = prop<L20>()("leaf")

// Composed lenses from root all the way to the leaf string
const leaf1 = l1Lens.compose(prop<L1>()("l2")).compose(prop<L2>()("l3")).compose(prop<L3>()("l4")).compose(prop<L4>()("l5")).compose(prop<L5>()("l6")).compose(prop<L6>()("l7")).compose(prop<L7>()("l8")).compose(prop<L8>()("l9")).compose(prop<L9>()("l10")).compose(prop<L10>()("l11")).compose(prop<L11>()("l12")).compose(prop<L12>()("l13")).compose(prop<L13>()("l14")).compose(prop<L14>()("l15")).compose(prop<L15>()("l16")).compose(prop<L16>()("l17")).compose(prop<L17>()("l18")).compose(prop<L18>()("l19")).compose(prop<L19>()("l20")).compose(leafFromL20)

// ---------------------------------------------------------------------------
// Build a deeply nested model value
// ---------------------------------------------------------------------------

function makeLeaf(value: string): L20 {
  return { leaf: value }
}

function makeNested(value: string): RootModel {
  return {
    l1: { l2: { l3: { l4: { l5: { l6: { l7: { l8: { l9: { l10: {
      l11: { l12: { l13: { l14: { l15: { l16: { l17: { l18: { l19: {
        l20: makeLeaf(value),
      } } } } } } } } }
    } } } } } } } } } }
  }
}

// ---------------------------------------------------------------------------
// Helper: build N focused text leaves under a fragment
// ---------------------------------------------------------------------------

const LEAF_COUNT = 100

/**
 * Create a text node that reads from the leaf string, focused through
 * the given number of levels from the root.
 */
function makeLeafAt1(): typeof textNode {
  // 1-level focus: root → l1, then read l2...l20.leaf as a single text fn
  const textNode = text<L1, never>((m) =>
    m.l2.l3.l4.l5.l6.l7.l8.l9.l10.l11.l12.l13.l14.l15.l16.l17.l18.l19.l20.leaf
  ).focus(prop<RootModel>()("l1"))
  return textNode
}

function makeLeafAt5(): ReturnType<typeof text<L5, never>> {
  // 5-level focus: root → l1 → l2 → l3 → l4 → l5
  const textNode = text<L5, never>((m) =>
    m.l6.l7.l8.l9.l10.l11.l12.l13.l14.l15.l16.l17.l18.l19.l20.leaf
  ).focus(prop<L4>()("l5"))
    .focus(prop<L3>()("l4"))
    .focus(prop<L2>()("l3"))
    .focus(prop<L1>()("l2"))
    .focus(prop<RootModel>()("l1"))
  return textNode
}

function makeLeafAt10(): ReturnType<typeof text<L10, never>> {
  // 10-level focus: root → l1 → ... → l10
  const textNode = text<L10, never>((m) =>
    m.l11.l12.l13.l14.l15.l16.l17.l18.l19.l20.leaf
  ).focus(prop<L9>()("l10"))
    .focus(prop<L8>()("l9"))
    .focus(prop<L7>()("l8"))
    .focus(prop<L6>()("l7"))
    .focus(prop<L5>()("l6"))
    .focus(prop<L4>()("l5"))
    .focus(prop<L3>()("l4"))
    .focus(prop<L2>()("l3"))
    .focus(prop<L1>()("l2"))
    .focus(prop<RootModel>()("l1"))
  return textNode
}

function makeLeafAt20(): ReturnType<typeof text<L20, never>> {
  // 20-level focus: root → l1 → ... → l20
  const textNode = text<L20, never>((m) => m.leaf)
    .focus(prop<L19>()("l20"))
    .focus(prop<L18>()("l19"))
    .focus(prop<L17>()("l18"))
    .focus(prop<L16>()("l17"))
    .focus(prop<L15>()("l16"))
    .focus(prop<L14>()("l15"))
    .focus(prop<L13>()("l14"))
    .focus(prop<L12>()("l13"))
    .focus(prop<L11>()("l12"))
    .focus(prop<L10>()("l11"))
    .focus(prop<L9>()("l10"))
    .focus(prop<L8>()("l9"))
    .focus(prop<L7>()("l8"))
    .focus(prop<L6>()("l7"))
    .focus(prop<L5>()("l6"))
    .focus(prop<L4>()("l5"))
    .focus(prop<L3>()("l4"))
    .focus(prop<L2>()("l3"))
    .focus(prop<L1>()("l2"))
    .focus(prop<RootModel>()("l1"))
  return textNode
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe(`focus chain depth — ${LEAF_COUNT} leaves`, () => {
  // ─── 1-level focus ──────────────────────────────────────────────────

  let sig1: ReturnType<typeof createSignal<RootModel>>
  let teardown1: Teardown
  let tick1: number

  bench("1-level focus", () => {
    tick1++
    sig1.setValue(makeNested(`v${tick1}`))
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      tick1 = 0

      const children = Array.from({ length: LEAF_COUNT }, () => makeLeafAt1())
      const view = fragment<RootModel, never>(children)

      const model = makeNested("initial")
      sig1 = createSignal<RootModel>(model)
      const updates = toUpdateStream(sig1)
      const dispatch: Dispatcher<never> = () => {}
      teardown1 = view.attach(container, model, updates, dispatch)
    },
    teardown() {
      teardown1.teardown()
    },
  })

  // ─── 5-level focus ──────────────────────────────────────────────────

  let sig5: ReturnType<typeof createSignal<RootModel>>
  let teardown5: Teardown
  let tick5: number

  bench("5-level focus", () => {
    tick5++
    sig5.setValue(makeNested(`v${tick5}`))
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      tick5 = 0

      const children = Array.from({ length: LEAF_COUNT }, () => makeLeafAt5())
      const view = fragment<RootModel, never>(children)

      const model = makeNested("initial")
      sig5 = createSignal<RootModel>(model)
      const updates = toUpdateStream(sig5)
      const dispatch: Dispatcher<never> = () => {}
      teardown5 = view.attach(container, model, updates, dispatch)
    },
    teardown() {
      teardown5.teardown()
    },
  })

  // ─── 10-level focus ─────────────────────────────────────────────────

  let sig10: ReturnType<typeof createSignal<RootModel>>
  let teardown10: Teardown
  let tick10: number

  bench("10-level focus", () => {
    tick10++
    sig10.setValue(makeNested(`v${tick10}`))
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      tick10 = 0

      const children = Array.from({ length: LEAF_COUNT }, () => makeLeafAt10())
      const view = fragment<RootModel, never>(children)

      const model = makeNested("initial")
      sig10 = createSignal<RootModel>(model)
      const updates = toUpdateStream(sig10)
      const dispatch: Dispatcher<never> = () => {}
      teardown10 = view.attach(container, model, updates, dispatch)
    },
    teardown() {
      teardown10.teardown()
    },
  })

  // ─── 20-level focus ─────────────────────────────────────────────────

  let sig20: ReturnType<typeof createSignal<RootModel>>
  let teardown20: Teardown
  let tick20: number

  bench("20-level focus", () => {
    tick20++
    sig20.setValue(makeNested(`v${tick20}`))
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      tick20 = 0

      const children = Array.from({ length: LEAF_COUNT }, () => makeLeafAt20())
      const view = fragment<RootModel, never>(children)

      const model = makeNested("initial")
      sig20 = createSignal<RootModel>(model)
      const updates = toUpdateStream(sig20)
      const dispatch: Dispatcher<never> = () => {}
      teardown20 = view.attach(container, model, updates, dispatch)
    },
    teardown() {
      teardown20.teardown()
    },
  })
})
