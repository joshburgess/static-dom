/**
 * Benchmark: Initial render of a 10k-row table.
 *
 * Measures attach (mount) performance — time from "empty container" to
 * "all rows in the DOM". Includes:
 *   - sdom:            Full SDOM with guards and dev checks
 *   - sdom (no guard): SDOM with __SDOM_GUARD__ disabled
 *   - raw DOM:         Equivalent plain DOM (theoretical ceiling)
 *   - react / preact / solid: Framework comparisons
 */

import { bench, describe } from "vitest"
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { h, render as preactRender } from "preact"
import { createSignal as solidSignal, createRoot as solidRoot, createEffect } from "solid-js"
import { text, element, array } from "../src/constructors"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { setGuardEnabled } from "../src/errors"
import { setDevMode } from "../src/dev"
import { jsx, compileSpecCloned } from "../src/jsx-runtime"
import { classifyProps, tryBuildChildSpecs, type JsxSpec } from "../src/shared"
import { makeRows, clearContainer, type Row } from "./helpers"

const ROW_COUNT = 10_000

// ── Shared SDOM templates (built once, reused across iterations) ─────────

const rowView = element<Row, never>("tr", {}, [
  element<Row, never>("td", {
    rawAttrs: { class: (m: Row) => m.selected ? "selected" : "" },
  }, [text((m: Row) => m.id)]),
  element<Row, never>("td", {}, [text((m: Row) => m.label)]),
])

interface SdomModel { rows: Row[] }
const sdomView = array<SdomModel, Row, never>(
  "tbody",
  (m) => m.rows.map(r => ({ key: r.id, model: r })),
  rowView
)
const noopDispatch: Dispatcher<never> = () => {}

describe(`initial render — ${ROW_COUNT} rows`, () => {

  // ─── SDOM (default: guards + dev mode on) ──────────────────────────
  bench("sdom", () => {
    const container = document.createElement("div")
    const rows = makeRows(ROW_COUNT)
    const model: SdomModel = { rows }
    const signal = createSignal(model)
    const updates = toUpdateStream(signal)
    sdomView.attach(container, model, updates, noopDispatch)
    clearContainer(container)
  })

  // ─── SDOM (guards + dev off — production mode) ─────────────────────
  bench("sdom (production)", () => {
    setGuardEnabled(false)
    setDevMode(false)
    try {
      const container = document.createElement("div")
      const rows = makeRows(ROW_COUNT)
      const model: SdomModel = { rows }
      const signal = createSignal(model)
      const updates = toUpdateStream(signal)
      sdomView.attach(container, model, updates, noopDispatch)
      clearContainer(container)
    } finally {
      setGuardEnabled(true)
      setDevMode(true)
    }
  })

  // ─── SDOM JSX (compiled, direct createElement) ──────────────────────
  // The JSX path auto-detects compilable subtrees and uses a single fused
  // observer with direct createElement chains (default).
  const jsxRowView = jsx("tr", {
    children: [
      jsx("td", {
        class: (m: Row) => m.selected ? "selected" : "",
        children: (m: Row) => m.id,
      }),
      jsx("td", { children: (m: Row) => m.label }),
    ]
  })

  const jsxView = array<SdomModel, Row, never>(
    "tbody",
    (m) => m.rows.map(r => ({ key: r.id, model: r })),
    jsxRowView as any,
  )

  bench("sdom (jsx compiled)", () => {
    setGuardEnabled(false)
    setDevMode(false)
    try {
      const container = document.createElement("div")
      const rows = makeRows(ROW_COUNT)
      const model: SdomModel = { rows }
      const signal = createSignal(model)
      const updates = toUpdateStream(signal)
      jsxView.attach(container, model, updates, noopDispatch)
      clearContainer(container)
    } finally {
      setGuardEnabled(true)
      setDevMode(true)
    }
  })

  // ─── SDOM JSX (template cloning via compileSpecCloned) ─────────────
  // Opt-in template cloning: first attach builds a <template>, subsequent
  // 9,999 clone it. Faster for static-heavy templates, slower for simple ones.
  const clonedRowProps = {
    children: [
      { class: (m: Row) => m.selected ? "selected" : "", children: (m: Row) => m.id },
      { children: (m: Row) => m.label },
    ].map(p => {
      const classified = classifyProps(p as any)
      const childSpecs = tryBuildChildSpecs((p as any).children)!
      return { kind: "element" as const, spec: { tag: "td", classified, children: childSpecs } }
    }),
  }
  const clonedRowSpec: JsxSpec = {
    tag: "tr",
    classified: {},
    children: clonedRowProps.children,
  }
  const clonedRowView = compileSpecCloned(clonedRowSpec)

  const clonedView = array<SdomModel, Row, never>(
    "tbody",
    (m) => m.rows.map(r => ({ key: r.id, model: r })),
    clonedRowView as any,
  )

  bench("sdom (jsx + cloning)", () => {
    setGuardEnabled(false)
    setDevMode(false)
    try {
      const container = document.createElement("div")
      const rows = makeRows(ROW_COUNT)
      const model: SdomModel = { rows }
      const signal = createSignal(model)
      const updates = toUpdateStream(signal)
      clonedView.attach(container, model, updates, noopDispatch)
      clearContainer(container)
    } finally {
      setGuardEnabled(true)
      setDevMode(true)
    }
  })

  // ─── Raw DOM baseline (theoretical ceiling) ────────────────────────
  bench("raw DOM", () => {
    const container = document.createElement("div")
    const rows = makeRows(ROW_COUNT)
    const tbody = document.createElement("tbody")

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
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

    container.appendChild(tbody)
    clearContainer(container)
  })

  // ─── React ──────────────────────────────────────────────────────────
  // NOTE: React 18's root.render() is async — may not flush synchronously
  // in happy-dom, making this number unreliable as a direct comparison.
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
