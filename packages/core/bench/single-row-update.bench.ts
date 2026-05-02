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
import { render as infernoRender, createVNode, createTextVNode } from "inferno"
import { createElement as infernoH } from "inferno-create-element"
import { createSignal as solidSignal, createRoot as solidRoot, createEffect } from "solid-js"
import type { Setter } from "solid-js"
import { text, element, array, indexedArray, compiled } from "../src/constructors"
import { incrementalArray } from "../src/incremental"
import { pooledKeyedPatch, keyedOps, keyedPatch, type KeyedArrayDelta } from "../src/patch"
import { programWithDelta, type ProgramHandle } from "../src/program"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { setGuardEnabled } from "../src/errors"
import { setDevMode } from "../src/dev"
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

  // ─── SDOM (zero-copy) ─────────────────────────────────────────────────
  // The full optimization stack:
  //   1. extractDelta: skips update() entirely — no array spread (from Most.js)
  //   2. compiled(): fused single-observer row template (from Inferno)
  //   3. setGuardEnabled(false) + setDevMode(false): no try/catch, no Object.keys
  //   4. pooledKeyedPatch: zero-alloc delta (reusable mutable object)
  //
  // This represents the ceiling of what SDOM can achieve without
  // adopting Solid's signal-per-leaf architecture.

  type ZCMsg = { type: "update"; idx: number }

  let zcHandle: ProgramHandle<{ rows: Row[] }, ZCMsg>
  let zcRows: Row[]

  bench("sdom (zero-copy)", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    zcHandle.dispatch({ type: "update", idx })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)

      const container = document.createElement("div")
      document.body.appendChild(container)

      // Fused row template: 1 observer instead of 3, direct DOM ops
      const rowView = compiled<Row, never>((parent, model, _dispatch) => {
        const tr = document.createElement("tr")
        const td1 = document.createElement("td")
        const td2 = document.createElement("td")

        let lastCls = model.selected ? "selected" : ""
        td1.className = lastCls
        td1.textContent = model.id
        let lastLabel = model.label
        td2.textContent = lastLabel

        tr.appendChild(td1)
        tr.appendChild(td2)
        parent.appendChild(tr)

        return {
          update(_prev: Row, next: Row) {
            const cls = next.selected ? "selected" : ""
            if (cls !== lastCls) { lastCls = cls; td1.className = cls }
            const lbl = next.label
            if (lbl !== lastLabel) { lastLabel = lbl; td2.textContent = lbl }
          },
          teardown() { tr.remove() },
        }
      })

      const view = incrementalArray<{ rows: Row[] }, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView
      )

      zcRows = makeRows(ROW_COUNT)

      zcHandle = programWithDelta<{ rows: Row[] }, ZCMsg>({
        container,
        init: { rows: zcRows },
        // extractDelta: called first — if fast-patch handles it, update() is skipped
        extractDelta: (msg, model) => {
          const row = model.rows[msg.idx]!
          const updated = { ...row, label: row.label + " !" }
          model.rows[msg.idx] = updated // O(1) in-place mutation
          return pooledKeyedPatch(row.id, updated)
        },
        // update: fallback — only called if extractDelta's fast-path fails
        update: (msg, model) => {
          const row = model.rows[msg.idx]!
          const updated = { ...row, label: row.label + " !" }
          const newRows = [...model.rows]
          newRows[msg.idx] = updated
          return [{ rows: newRows }, pooledKeyedPatch(row.id, updated)]
        },
        view,
      })
    },
    teardown() {
      zcHandle.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })

  // ─── SDOM (direct-patch) ───────────────────────────────────────────────
  // Absolute minimum overhead path:
  //   patchItem(key, value) → _tryFastPatch → handler → observer → DOM write
  // No dispatch, no update(), no delta extraction, no subscription chain.
  // This establishes the performance ceiling for SDOM's architecture.

  type DPMsg = { type: "update"; idx: number }

  let dpHandle: ProgramHandle<{ rows: Row[] }, DPMsg>
  let dpRows: Row[]

  bench("sdom (direct-patch)", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    const row = dpRows[idx]!
    const updated = { ...row, label: row.label + " !" }
    dpRows[idx] = updated
    dpHandle.patchItem!(row.id, updated)
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)

      const container = document.createElement("div")
      document.body.appendChild(container)

      const rowView = compiled<Row, never>((parent, model, _dispatch) => {
        const tr = document.createElement("tr")
        const td1 = document.createElement("td")
        const td2 = document.createElement("td")

        let lastCls = model.selected ? "selected" : ""
        td1.className = lastCls
        td1.textContent = model.id
        let lastLabel = model.label
        td2.textContent = lastLabel

        tr.appendChild(td1)
        tr.appendChild(td2)
        parent.appendChild(tr)

        return {
          update(_prev: Row, next: Row) {
            const cls = next.selected ? "selected" : ""
            if (cls !== lastCls) { lastCls = cls; td1.className = cls }
            const lbl = next.label
            if (lbl !== lastLabel) { lastLabel = lbl; td2.textContent = lbl }
          },
          teardown() { tr.remove() },
        }
      })

      const view = incrementalArray<{ rows: Row[] }, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView
      )

      dpRows = makeRows(ROW_COUNT)

      dpHandle = programWithDelta<{ rows: Row[] }, DPMsg>({
        container,
        init: { rows: dpRows },
        update: (msg, model) => {
          const row = model.rows[msg.idx]!
          const updated = { ...row, label: row.label + " !" }
          const newRows = [...model.rows]
          newRows[msg.idx] = updated
          return [{ rows: newRows }, pooledKeyedPatch(row.id, updated)]
        },
        view,
      })
    },
    teardown() {
      dpHandle.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })

  // ─── SDOM (indexed — non-keyed) ──────────────────────────────────────
  // Uses indexedArray: no Map, no keys, pure positional patching.

  let indexedSignal: ReturnType<typeof createSignal<{ rows: Row[] }>>
  let indexedTeardown: Teardown
  let indexedRows: Row[]

  bench("sdom (indexed)", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    const row = indexedRows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...indexedRows]
    newRows[idx] = updated
    indexedRows = newRows
    indexedSignal.setValue({ rows: indexedRows })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)

      const rowView = element<"tr", Row, never>("tr", {
        rawAttrs: { class: (m) => m.selected ? "selected" : "" },
      }, [
        element<"td", Row, never>("td", {}, [text((m) => m.id)]),
        element<"td", Row, never>("td", {}, [text((m) => m.label)]),
      ])

      const view = indexedArray<{ rows: Row[] }, Row, never>(
        "tbody",
        (m) => m.rows,
        rowView
      )

      indexedRows = makeRows(ROW_COUNT)
      indexedSignal = createSignal<{ rows: Row[] }>({ rows: indexedRows })
      const updates = toUpdateStream(indexedSignal)
      const dispatch: Dispatcher<never> = () => {}
      indexedTeardown = view.attach(container, { rows: indexedRows }, updates, dispatch)
    },
    teardown() {
      indexedTeardown.teardown()
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

  // ─── Inferno (createElement) ─────────────────────────────────────────
  // Same API style as React/Preact — createElement with keyed children.

  let infernoRows: Row[]
  let infernoContainer: HTMLElement

  bench("inferno", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    const row = infernoRows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...infernoRows]
    newRows[idx] = updated
    infernoRows = newRows

    const trs = infernoRows.map((r) =>
      infernoH("tr", { key: r.id },
        infernoH("td", { className: r.selected ? "selected" : "" }, r.id),
        infernoH("td", null, r.label),
      )
    )
    infernoRender(infernoH("tbody", null, trs), infernoContainer)
  }, {
    setup() {
      infernoContainer = document.createElement("div")
      document.body.appendChild(infernoContainer)
      infernoRows = makeRows(ROW_COUNT)

      const trs = infernoRows.map((r) =>
        infernoH("tr", { key: r.id },
          infernoH("td", { className: r.selected ? "selected" : "" }, r.id),
          infernoH("td", null, r.label),
        )
      )
      infernoRender(infernoH("tbody", null, trs), infernoContainer)
    },
    teardown() {
      infernoRender(null, infernoContainer)
      infernoContainer.remove()
    },
  })

  // ─── Inferno (optimized — createVNode with flags) ──────────────────
  // What Inferno's Babel plugin actually generates: pre-classified VNodes
  // with explicit flags. Skips runtime type inference entirely.
  //   HtmlElement = 1, HasKeyedChildren = 8, HasVNodeChildren = 2,
  //   HasNonKeyedChildren = 4, Text = 16

  let infernoOptRows: Row[]
  let infernoOptContainer: HTMLElement

  bench("inferno (optimized)", () => {
    const idx = Math.floor(Math.random() * ROW_COUNT)
    const row = infernoOptRows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...infernoOptRows]
    newRows[idx] = updated
    infernoOptRows = newRows

    const trs = infernoOptRows.map((r) =>
      createVNode(1, "tr", null, [
        createVNode(1, "td", r.selected ? "selected" : "", createTextVNode(r.id), 16),
        createVNode(1, "td", null, createTextVNode(r.label), 16),
      ], 4, null, r.id)
    )
    infernoRender(createVNode(1, "tbody", null, trs, 8), infernoOptContainer)
  }, {
    setup() {
      infernoOptContainer = document.createElement("div")
      document.body.appendChild(infernoOptContainer)
      infernoOptRows = makeRows(ROW_COUNT)

      const trs = infernoOptRows.map((r) =>
        createVNode(1, "tr", null, [
          createVNode(1, "td", r.selected ? "selected" : "", createTextVNode(r.id), 16),
          createVNode(1, "td", null, createTextVNode(r.label), 16),
        ], 4, null, r.id)
      )
      infernoRender(createVNode(1, "tbody", null, trs, 8), infernoOptContainer)
    },
    teardown() {
      infernoRender(null, infernoOptContainer)
      infernoOptContainer.remove()
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
