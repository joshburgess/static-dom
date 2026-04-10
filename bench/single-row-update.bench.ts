/**
 * Benchmark: Single row update in a 1k-row table.
 *
 * This is SDOM's sweet spot. A single row changes — SDOM patches one text
 * node directly. React/Preact must diff the entire component tree (or at
 * least the row list) to find the one changed row.
 *
 * Setup: render 1k rows, then measure time to update one row's label.
 */

import { bench, describe, beforeEach } from "vitest"
import { createElement, type ReactElement } from "react"
import { createRoot, type Root as ReactRoot } from "react-dom/client"
import { h, render as preactRender, type VNode } from "preact"
import { createSignal as solidSignal, createRoot as solidRoot, createEffect } from "solid-js"
import type { Setter } from "solid-js"
import { text, element, array } from "../src/constructors"
import { incrementalArray } from "../src/incremental"
import { pooledKeyedPatch, keyedOps, keyedPatch, type KeyedArrayDelta } from "../src/patch"
import { programWithDelta, type ProgramHandle } from "../src/program"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import type { Teardown } from "../src/types"
import { makeRows, type Row } from "./helpers"

const ROW_COUNT = 1_000

describe(`single row update — ${ROW_COUNT} rows`, () => {
  // ─── SDOM ───────────────────────────────────────────────────────────

  let sdomSignal: ReturnType<typeof createSignal<{ rows: Row[] }>>
  let sdomTeardown: Teardown
  let sdomRows: Row[]

  bench("sdom", () => {
    // Toggle selection on a single row
    const idx = Math.floor(Math.random() * ROW_COUNT)
    const row = sdomRows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...sdomRows]
    newRows[idx] = updated
    sdomRows = newRows
    sdomSignal.setValue({ rows: sdomRows })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)

      const rowView = element<Row, never>("tr", {}, [
        element<Row, never>("td", {
          rawAttrs: { class: (m) => m.selected ? "selected" : "" },
        }, [text((m) => m.id)]),
        element<Row, never>("td", {}, [text((m) => m.label)]),
      ])

      interface Model { rows: Row[] }
      const view = array<Model, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView
      )

      sdomRows = makeRows(ROW_COUNT)
      sdomSignal = createSignal<Model>({ rows: sdomRows })
      const updates = toUpdateStream(sdomSignal)
      const dispatch: Dispatcher<never> = () => {}
      sdomTeardown = view.attach(container, { rows: sdomRows }, updates, dispatch)
    },
    teardown() {
      sdomTeardown.teardown()
    },
  })

  // ─── SDOM (incremental) ─────────────────────────────────────────────
  // Uses incrementalArray with keyed deltas — O(1) per update, no
  // reconciliation. This is what the incremental layer is for.

  interface IncrModel {
    rows: Row[]
    _delta: KeyedArrayDelta<Row> | null
  }

  let incrSignal: ReturnType<typeof createSignal<IncrModel>>
  let incrTeardown: Teardown
  let incrRows: Row[]

  bench("sdom (incremental)", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    const row = incrRows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...incrRows]
    newRows[idx] = updated
    incrRows = newRows
    incrSignal.setValue({
      rows: incrRows,
      _delta: pooledKeyedPatch(row.id, updated),
    })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)

      const rowView = element<Row, never>("tr", {}, [
        element<Row, never>("td", {
          rawAttrs: { class: (m) => m.selected ? "selected" : "" },
        }, [text((m) => m.id)]),
        element<Row, never>("td", {}, [text((m) => m.label)]),
      ])

      const view = incrementalArray<IncrModel, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        (m) => m._delta,
        rowView
      )

      incrRows = makeRows(ROW_COUNT)
      incrSignal = createSignal<IncrModel>({ rows: incrRows, _delta: null })
      const updates = toUpdateStream(incrSignal)
      const dispatch: Dispatcher<never> = () => {}
      incrTeardown = view.attach(container, { rows: incrRows, _delta: null }, updates, dispatch)
    },
    teardown() {
      incrTeardown.teardown()
    },
  })

  // ─── SDOM (compiled fast-path) ───────────────────────────────────────
  // Uses programWithDelta + incrementalArray with the compiled dispatch
  // fast path. Single-patch deltas bypass the entire subscription chain.

  type CompiledMsg = { type: "update"; idx: number }
  interface CompiledModel {
    rows: Row[]
  }

  let compiledHandle: ProgramHandle<CompiledModel, CompiledMsg>
  let compiledRows: Row[]

  bench("sdom (compiled)", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    compiledHandle.dispatch({ type: "update", idx })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)

      const rowView = element<Row, never>("tr", {}, [
        element<Row, never>("td", {
          rawAttrs: { class: (m) => m.selected ? "selected" : "" },
        }, [text((m) => m.id)]),
        element<Row, never>("td", {}, [text((m) => m.label)]),
      ])

      const view = incrementalArray<CompiledModel, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView
      )

      compiledRows = makeRows(ROW_COUNT)

      compiledHandle = programWithDelta<CompiledModel, CompiledMsg>({
        container,
        init: { rows: compiledRows },
        update: (msg, model) => {
          const row = model.rows[msg.idx]!
          const updated = { ...row, label: row.label + " !" }
          const newRows = [...model.rows]
          newRows[msg.idx] = updated
          return [
            { rows: newRows },
            { kind: "ops", ops: [{ kind: "patch", key: row.id, value: updated }] },
          ]
        },
        view,
      })
    },
    teardown() {
      compiledHandle.teardown()
    },
  })

  // ─── React ──────────────────────────────────────────────────────────

  let reactRoot: ReactRoot
  let reactRows: Row[]
  let reactContainer: HTMLElement

  bench("react", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    const row = reactRows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...reactRows]
    newRows[idx] = updated
    reactRows = newRows

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
      reactRows = makeRows(ROW_COUNT)

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

  // ─── Preact ─────────────────────────────────────────────────────────

  let preactRows: Row[]
  let preactContainer: HTMLElement

  bench("preact", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    const row = preactRows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...preactRows]
    newRows[idx] = updated
    preactRows = newRows

    const trs = preactRows.map((r) =>
      h("tr", { key: r.id },
        h("td", { class: r.selected ? "selected" : "" }, r.id),
        h("td", null, r.label),
      )
    )
    preactRender(h("tbody", null, trs), preactContainer)
  }, {
    setup() {
      preactContainer = document.createElement("div")
      document.body.appendChild(preactContainer)
      preactRows = makeRows(ROW_COUNT)

      const trs = preactRows.map((r) =>
        h("tr", { key: r.id },
          h("td", { class: r.selected ? "selected" : "" }, r.id),
          h("td", null, r.label),
        )
      )
      preactRender(h("tbody", null, trs), preactContainer)
    },
    teardown() {
      preactRender(null, preactContainer)
      preactContainer.remove()
    },
  })

  // ─── Solid ──────────────────────────────────────────────────────────
  // Raw reactive API — each row's label is a signal, effects patch the DOM.
  // This is exactly what Solid's compiler generates from JSX.

  let solidDispose: () => void
  let solidLabelSetters: Setter<string>[]

  bench("solid", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    solidLabelSetters[idx]!(prev => prev + " !")
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)

      solidRoot(dispose => {
        solidDispose = dispose
        solidLabelSetters = []
        const rows = makeRows(ROW_COUNT)
        const tbody = document.createElement("tbody")

        for (const row of rows) {
          const [selected] = solidSignal(row.selected)
          const [label, setLabel] = solidSignal(row.label)
          solidLabelSetters.push(setLabel)

          const tr = document.createElement("tr")
          const td1 = document.createElement("td")
          createEffect(() => {
            td1.className = selected() ? "selected" : ""
          })
          td1.textContent = row.id
          const td2 = document.createElement("td")
          createEffect(() => {
            td2.textContent = label()
          })
          tr.appendChild(td1)
          tr.appendChild(td2)
          tbody.appendChild(tr)
        }

        container.appendChild(tbody)
      })
    },
    teardown() {
      solidDispose()
    },
  })
})
