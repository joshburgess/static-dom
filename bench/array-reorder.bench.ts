/**
 * Benchmark: Array Reordering (LIS Stress Test)
 *
 * Measures SDOM's array reconciliation performance under various reordering
 * operations. The `array` constructor uses a Longest Increasing Subsequence
 * (LIS) algorithm (ported from Inferno) to minimize DOM moves: only items
 * NOT in the LIS require `insertBefore` calls.
 *
 * Operations tested:
 *   - Append 100 items to a 1k list (best case — no moves, just mounts)
 *   - Remove 100 items from a 1k list (teardown only, no moves)
 *   - Shuffle entire 1k list (worst case for LIS — random permutation)
 *   - Reverse 1k list (pathological case — LIS is length 1)
 *
 * The shuffle case also compares against React to show SDOM's advantage:
 * SDOM reuses existing DOM nodes via keyed reconciliation and only calls
 * `insertBefore` for items outside the LIS. React must diff the entire
 * virtual DOM tree and then perform the same DOM moves.
 *
 * What this reveals:
 *   - Cost of LIS computation vs naive reconciliation
 *   - DOM move overhead relative to reconciliation overhead
 *   - How SDOM's keyed array scales with different mutation patterns
 */

import { bench, describe } from "vitest"
import { text, element, array } from "../src/constructors"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import type { Teardown } from "../src/types"
import { makeRows, type Row } from "./helpers"
import { createElement } from "react"
import { createRoot, type Root as ReactRoot } from "react-dom/client"

const LIST_SIZE = 1_000
const APPEND_COUNT = 100
const REMOVE_COUNT = 100

// ---------------------------------------------------------------------------
// Shared SDOM row template
// ---------------------------------------------------------------------------

const rowView = element<Row, never>("tr", {}, [
  element<Row, never>("td", {
    rawAttrs: { class: (m) => m.selected ? "selected" : "" },
  }, [text((m) => m.id)]),
  element<Row, never>("td", {}, [text((m) => m.label)]),
])

// ---------------------------------------------------------------------------
// Fisher-Yates shuffle (in-place, returns the array)
// ---------------------------------------------------------------------------

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe(`array reorder — ${LIST_SIZE} items`, () => {
  // ─── Append 100 items ───────────────────────────────────────────────
  // Best case: no reordering, just mount new items at the end.
  // LIS covers the entire existing list; only new items need DOM creation.

  let appendSig: ReturnType<typeof createSignal<{ rows: Row[] }>>
  let appendTeardown: Teardown
  let appendRows: Row[]
  let appendCycle: boolean

  bench("sdom — append 100", () => {
    if (appendCycle) {
      // Append 100 new rows
      const extra = makeRows(APPEND_COUNT)
      appendRows = [...appendRows, ...extra]
    } else {
      // Remove the last 100 to reset for next iteration
      appendRows = appendRows.slice(0, LIST_SIZE)
    }
    appendCycle = !appendCycle
    appendSig.setValue({ rows: appendRows })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      appendCycle = true

      interface Model { rows: Row[] }
      const view = array<Model, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView
      )

      appendRows = makeRows(LIST_SIZE)
      appendSig = createSignal<Model>({ rows: appendRows })
      const updates = toUpdateStream(appendSig)
      const dispatch: Dispatcher<never> = () => {}
      appendTeardown = view.attach(container, { rows: appendRows }, updates, dispatch)
    },
    teardown() {
      appendTeardown.teardown()
    },
  })

  // ─── Remove 100 items ──────────────────────────────────────────────
  // Remove items from the middle of the list. Remaining items keep their
  // relative order, so LIS should cover nearly all of them. Only teardowns
  // are needed, no DOM moves.

  let removeSig: ReturnType<typeof createSignal<{ rows: Row[] }>>
  let removeTeardown: Teardown
  let removeBaseRows: Row[]
  let removeCycle: boolean

  bench("sdom — remove 100", () => {
    if (removeCycle) {
      // Remove 100 items from the middle
      const start = Math.floor((LIST_SIZE - REMOVE_COUNT) / 2)
      removeBaseRows = [
        ...removeBaseRows.slice(0, start),
        ...removeBaseRows.slice(start + REMOVE_COUNT),
      ]
    } else {
      // Restore the full list
      removeBaseRows = makeRows(LIST_SIZE)
    }
    removeCycle = !removeCycle
    removeSig.setValue({ rows: removeBaseRows })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      removeCycle = true

      interface Model { rows: Row[] }
      const view = array<Model, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView
      )

      removeBaseRows = makeRows(LIST_SIZE)
      removeSig = createSignal<Model>({ rows: removeBaseRows })
      const updates = toUpdateStream(removeSig)
      const dispatch: Dispatcher<never> = () => {}
      removeTeardown = view.attach(container, { rows: removeBaseRows }, updates, dispatch)
    },
    teardown() {
      removeTeardown.teardown()
    },
  })

  // ─── Shuffle entire list (SDOM) ────────────────────────────────────
  // Worst case: random permutation. LIS will be ~O(sqrt(n)) in expectation,
  // meaning most items need DOM moves. This stresses both the LIS computation
  // and the DOM insertBefore calls.

  let shuffleSig: ReturnType<typeof createSignal<{ rows: Row[] }>>
  let shuffleTeardown: Teardown
  let shuffleRows: Row[]

  bench("sdom — shuffle 1k", () => {
    shuffleRows = shuffle([...shuffleRows])
    shuffleSig.setValue({ rows: shuffleRows })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)

      interface Model { rows: Row[] }
      const view = array<Model, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView
      )

      shuffleRows = makeRows(LIST_SIZE)
      shuffleSig = createSignal<Model>({ rows: shuffleRows })
      const updates = toUpdateStream(shuffleSig)
      const dispatch: Dispatcher<never> = () => {}
      shuffleTeardown = view.attach(container, { rows: shuffleRows }, updates, dispatch)
    },
    teardown() {
      shuffleTeardown.teardown()
    },
  })

  // ─── Reverse entire list (SDOM) ────────────────────────────────────
  // Pathological case for LIS: a fully reversed sequence has LIS length 1,
  // so every item except one needs a DOM move. This is the theoretical
  // worst case for the number of insertBefore calls.

  let reverseSig: ReturnType<typeof createSignal<{ rows: Row[] }>>
  let reverseTeardown: Teardown
  let reverseRows: Row[]

  bench("sdom — reverse 1k", () => {
    reverseRows = [...reverseRows].reverse()
    reverseSig.setValue({ rows: reverseRows })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)

      interface Model { rows: Row[] }
      const view = array<Model, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView
      )

      reverseRows = makeRows(LIST_SIZE)
      reverseSig = createSignal<Model>({ rows: reverseRows })
      const updates = toUpdateStream(reverseSig)
      const dispatch: Dispatcher<never> = () => {}
      reverseTeardown = view.attach(container, { rows: reverseRows }, updates, dispatch)
    },
    teardown() {
      reverseTeardown.teardown()
    },
  })

  // ─── Shuffle (React comparison) ────────────────────────────────────
  // Same shuffle operation using React's keyed reconciliation for comparison.
  // React must diff the entire VDOM tree to determine which keys moved,
  // then perform the same DOM insertBefore calls.

  let reactRoot: ReactRoot
  let reactRows: Row[]
  let reactContainer: HTMLElement

  bench("react — shuffle 1k", () => {
    reactRows = shuffle([...reactRows])

    const trs = reactRows.map((r) =>
      createElement("tr", { key: r.id },
        createElement("td", { className: r.selected ? "selected" : "" }, r.id),
        createElement("td", null, r.label),
      )
    )
    reactRoot.render(createElement("tbody", null, trs))
  }, {
    setup() {
      reactContainer = document.createElement("div")
      document.body.appendChild(reactContainer)
      reactRoot = createRoot(reactContainer)
      reactRows = makeRows(LIST_SIZE)

      // Initial render
      const trs = reactRows.map((r) =>
        createElement("tr", { key: r.id },
          createElement("td", { className: r.selected ? "selected" : "" }, r.id),
          createElement("td", null, r.label),
        )
      )
      reactRoot.render(createElement("tbody", null, trs))
    },
    teardown() {
      reactRoot.unmount()
      reactContainer.remove()
    },
  })
})
