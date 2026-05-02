/**
 * Benchmark: Clear rows — teardown 10k rows to empty.
 *
 * Tests teardown performance: unsubscribing observers, removing DOM nodes,
 * cleaning up maps and markers.
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

const ROW_COUNT = 10_000

describe(`clear rows — ${ROW_COUNT} to 0`, () => {

  // ─── SDOM ──────────────────────────────────────────────────────────

  let sdomSignal: ReturnType<typeof createSignal<{ rows: Row[] }>>
  let sdomTeardown: Teardown
  let sdomContainer: HTMLElement

  bench("sdom", () => {
    sdomSignal.setValue({ rows: [] })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)

      sdomContainer = document.createElement("div")
      document.body.appendChild(sdomContainer)

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

      const rows = makeRows(ROW_COUNT)
      sdomSignal = createSignal<Model>({ rows })
      const updates = toUpdateStream(sdomSignal)
      const dispatch: Dispatcher<never> = () => {}
      sdomTeardown = view.attach(sdomContainer, { rows }, updates, dispatch)
    },
    teardown() {
      sdomTeardown.teardown()
      sdomContainer.remove()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })

  // ─── React ──────────────────────────────────────────────────────────

  let reactRoot: ReactRoot
  let reactContainer: HTMLElement

  bench("react", () => {
    reactRoot.render(createElement("tbody", null))
  }, {
    setup() {
      reactContainer = document.createElement("div")
      document.body.appendChild(reactContainer)
      reactRoot = createRoot(reactContainer)

      const rows = makeRows(ROW_COUNT)
      const trs = rows.map((r) =>
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

  bench("preact", () => {
    preactRender(h("tbody", null), preactContainer)
  }, {
    setup() {
      preactContainer = document.createElement("div")
      document.body.appendChild(preactContainer)

      const rows = makeRows(ROW_COUNT)
      const trs = rows.map((r) =>
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

  let rawContainer: HTMLElement

  bench("raw DOM", () => {
    rawContainer.innerHTML = ""
  }, {
    setup() {
      rawContainer = document.createElement("div")
      document.body.appendChild(rawContainer)

      const tbody = document.createElement("tbody")
      const rows = makeRows(ROW_COUNT)
      for (const row of rows) {
        const tr = document.createElement("tr")
        const td1 = document.createElement("td")
        td1.className = row.selected ? "selected" : ""
        td1.textContent = row.id
        const td2 = document.createElement("td")
        td2.textContent = row.label
        tr.appendChild(td1)
        tr.appendChild(td2)
        tbody.appendChild(tr)
      }
      rawContainer.appendChild(tbody)
    },
    teardown() {
      rawContainer.remove()
    },
  })
})
