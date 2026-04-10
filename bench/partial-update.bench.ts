/**
 * Benchmark: Partial update — update 1 row out of 10k.
 *
 * Tests selectivity of the update system. SDOM's keyed array fans out
 * updates per-item by key — only the changed row's observers fire.
 * React/Preact must diff the entire row list to find the one change.
 *
 * Setup: render 10k rows, then measure time to update one row's label.
 */

import { bench, describe } from "vitest"
import { createElement } from "react"
import { createRoot, type Root as ReactRoot } from "react-dom/client"
import { h, render as preactRender } from "preact"
import { createSignal as solidSignal, createRoot as solidRoot, createEffect } from "solid-js"
import type { Setter } from "solid-js"
import { text, element, array } from "../src/constructors"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { setGuardEnabled } from "../src/errors"
import { setDevMode } from "../src/dev"
import type { Teardown } from "../src/types"
import { makeRows, type Row } from "./helpers"

const ROW_COUNT = 10_000

describe(`partial update — 1 of ${ROW_COUNT} rows`, () => {

  // ─── SDOM ──────────────────────────────────────────────────────────

  let sdomSignal: ReturnType<typeof createSignal<{ rows: Row[] }>>
  let sdomTeardown: Teardown
  let sdomRows: Row[]

  bench("sdom", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    const row = sdomRows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...sdomRows]
    newRows[idx] = updated
    sdomRows = newRows
    sdomSignal.setValue({ rows: sdomRows })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)

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
      setGuardEnabled(true)
      setDevMode(true)
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
          createEffect(() => { td1.className = selected() ? "selected" : "" })
          td1.textContent = row.id
          const td2 = document.createElement("td")
          createEffect(() => { td2.textContent = label() })
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

  // ─── Raw DOM (baseline) ────────────────────────────────────────────
  // Direct DOM mutation — no framework, no reactivity. The ceiling.

  let rawTbody: HTMLTableSectionElement
  let rawTds: HTMLTableCellElement[]

  bench("raw DOM", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    rawTds[idx]!.textContent = rawTds[idx]!.textContent + " !"
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      rawTbody = document.createElement("tbody")
      rawTds = []
      const rows = makeRows(ROW_COUNT)

      for (const row of rows) {
        const tr = document.createElement("tr")
        const td1 = document.createElement("td")
        td1.className = row.selected ? "selected" : ""
        td1.textContent = row.id
        const td2 = document.createElement("td")
        td2.textContent = row.label
        rawTds.push(td2)
        tr.appendChild(td1)
        tr.appendChild(td2)
        rawTbody.appendChild(tr)
      }
      container.appendChild(rawTbody)
    },
    teardown() {
      rawTbody.parentElement?.remove()
    },
  })
})
