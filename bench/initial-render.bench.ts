/**
 * Benchmark: Initial render of a 10k-row table.
 *
 * This measures the time from "empty container" to "all rows in the DOM".
 * SDOM's advantage here is modest — initial render is similar to VDOM since
 * both must create the full DOM tree. The win comes from update benchmarks.
 */

import { bench, describe } from "vitest"
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { h, render as preactRender } from "preact"
import { createSignal as solidSignal, createRoot as solidRoot, createEffect } from "solid-js"
import { text, element, array } from "../src/constructors"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { makeRows, clearContainer, type Row } from "./helpers"

const ROW_COUNT = 10_000

describe(`initial render — ${ROW_COUNT} rows`, () => {
  // ─── SDOM ───────────────────────────────────────────────────────────
  bench("sdom", () => {
    const container = document.createElement("div")

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
    const signal = createSignal<Model>({ rows })
    const updates = toUpdateStream(signal)
    const dispatch: Dispatcher<never> = () => {}
    view.attach(container, { rows }, updates, dispatch)

    clearContainer(container)
  })

  // ─── React ──────────────────────────────────────────────────────────
  bench("react", () => {
    const container = document.createElement("div")
    const root = createRoot(container)

    const rows = makeRows(ROW_COUNT)
    const trs = rows.map((row) =>
      createElement("tr", { key: row.id },
        createElement("td", { className: row.selected ? "selected" : "" }, row.id),
        createElement("td", null, row.label),
      )
    )
    const tbody = createElement("tbody", null, trs)

    root.render(tbody)
    // React batches — flush synchronously
    // @ts-expect-error: flushSync not in types for some versions
    ;(root as any)._internalRoot?.containerInfo  // noop touch
    root.unmount()
  })

  // ─── Preact ─────────────────────────────────────────────────────────
  bench("preact", () => {
    const container = document.createElement("div")

    const rows = makeRows(ROW_COUNT)
    const trs = rows.map((row) =>
      h("tr", { key: row.id },
        h("td", { class: row.selected ? "selected" : "" }, row.id),
        h("td", null, row.label),
      )
    )
    const tbody = h("tbody", null, trs)

    preactRender(tbody, container)
    preactRender(null, container)
  })

  // ─── Solid ──────────────────────────────────────────────────────────
  // Uses Solid's raw reactive API — this is what the Solid compiler
  // generates from JSX. No compiler plugin needed.
  bench("solid", () => {
    const container = document.createElement("div")

    solidRoot(dispose => {
      const rows = makeRows(ROW_COUNT)
      const tbody = document.createElement("tbody")

      for (const row of rows) {
        const [selected] = solidSignal(row.selected)

        const tr = document.createElement("tr")
        const td1 = document.createElement("td")
        createEffect(() => {
          td1.className = selected() ? "selected" : ""
        })
        td1.textContent = row.id
        const td2 = document.createElement("td")
        td2.textContent = row.label
        tr.appendChild(td1)
        tr.appendChild(td2)
        tbody.appendChild(tr)
      }

      container.appendChild(tbody)
      dispose()
    })

    clearContainer(container)
  })
})
