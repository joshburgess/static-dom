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
import { text, element, array } from "../src/constructors"
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
})
