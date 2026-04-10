/**
 * Benchmark: Append rows — add 1k rows to existing 10k.
 *
 * Tests incremental mount cost: reconciliation detects all existing rows
 * are unchanged, then mounts 1k new rows at the end. Measures how well
 * the framework handles growing lists.
 */

import { bench, describe } from "vitest"
import { createElement } from "react"
import { createRoot, type Root as ReactRoot } from "react-dom/client"
import { h, render as preactRender } from "preact"
import { text, element, array } from "../src/constructors"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { setGuardEnabled } from "../src/errors"
import { setDevMode } from "../src/dev"
import type { Teardown } from "../src/types"
import { makeRows, type Row } from "./helpers"

const INITIAL_COUNT = 10_000
const APPEND_COUNT = 1_000

describe(`append ${APPEND_COUNT} rows to ${INITIAL_COUNT}`, () => {

  // ─── SDOM ──────────────────────────────────────────────────────────

  let sdomSignal: ReturnType<typeof createSignal<{ rows: Row[] }>>
  let sdomTeardown: Teardown
  let sdomRows: Row[]
  let appendBatch: Row[]

  bench("sdom", () => {
    sdomRows = [...sdomRows, ...appendBatch]
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

      sdomRows = makeRows(INITIAL_COUNT)
      appendBatch = makeRows(APPEND_COUNT)
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
  let reactContainer: HTMLElement
  let reactRows: Row[]
  let reactAppendBatch: Row[]

  bench("react", () => {
    reactRows = [...reactRows, ...reactAppendBatch]
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
      reactRows = makeRows(INITIAL_COUNT)
      reactAppendBatch = makeRows(APPEND_COUNT)

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

  let preactContainer: HTMLElement
  let preactRows: Row[]
  let preactAppendBatch: Row[]

  bench("preact", () => {
    preactRows = [...preactRows, ...preactAppendBatch]
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
      preactRows = makeRows(INITIAL_COUNT)
      preactAppendBatch = makeRows(APPEND_COUNT)

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

  // ─── Raw DOM ────────────────────────────────────────────────────────

  let rawTbody: HTMLTableSectionElement
  let rawAppendBatch: Row[]

  bench("raw DOM", () => {
    for (const row of rawAppendBatch) {
      const tr = document.createElement("tr")
      const td1 = document.createElement("td")
      td1.className = row.selected ? "selected" : ""
      td1.textContent = row.id
      const td2 = document.createElement("td")
      td2.textContent = row.label
      tr.appendChild(td1)
      tr.appendChild(td2)
      rawTbody.appendChild(tr)
    }
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      rawTbody = document.createElement("tbody")
      rawAppendBatch = makeRows(APPEND_COUNT)

      const rows = makeRows(INITIAL_COUNT)
      for (const row of rows) {
        const tr = document.createElement("tr")
        const td1 = document.createElement("td")
        td1.className = row.selected ? "selected" : ""
        td1.textContent = row.id
        const td2 = document.createElement("td")
        td2.textContent = row.label
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
