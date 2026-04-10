/**
 * Benchmark: arrayBy() vs array() — measuring allocation savings.
 *
 * arrayBy() avoids the .map(r => ({ key, model })) allocation that array()
 * requires. Tests single-row update and bulk update on 1k and 10k rows.
 */

import { bench, describe } from "vitest"
import { text, element, array, arrayBy } from "../src/constructors"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { setGuardEnabled } from "../src/errors"
import { setDevMode } from "../src/dev"
import type { Teardown } from "../src/types"
import { makeRows, type Row } from "./helpers"

const noopDispatch: Dispatcher<never> = () => {}

const rowView = element<Row, never>("tr", {}, [
  element<Row, never>("td", {
    rawAttrs: { class: (m) => m.selected ? "selected" : "" },
  }, [text((m) => m.id)]),
  element<Row, never>("td", {}, [text((m) => m.label)]),
])

interface Model { rows: Row[] }

// ─── 1k rows: single row update ──────────────────────────────────────

describe("single row update — 1k rows", () => {
  let signal: ReturnType<typeof createSignal<Model>>
  let teardown: Teardown
  let rows: Row[]

  bench("array (map wrapper)", () => {
    const idx = Math.floor(Math.random() * 1000)
    const row = rows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...rows]
    newRows[idx] = updated
    rows = newRows
    signal.setValue({ rows })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      const view = array<Model, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView,
      )
      rows = makeRows(1000)
      signal = createSignal<Model>({ rows })
      const updates = toUpdateStream(signal)
      teardown = view.attach(container, { rows }, updates, noopDispatch)
    },
    teardown() {
      teardown.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })

  bench("arrayBy (zero allocation)", () => {
    const idx = Math.floor(Math.random() * 1000)
    const row = rows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...rows]
    newRows[idx] = updated
    rows = newRows
    signal.setValue({ rows })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      const view = arrayBy<Model, Row, never>(
        "tbody",
        (m) => m.rows,
        (r) => r.id,
        rowView,
      )
      rows = makeRows(1000)
      signal = createSignal<Model>({ rows })
      const updates = toUpdateStream(signal)
      teardown = view.attach(container, { rows }, updates, noopDispatch)
    },
    teardown() {
      teardown.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })
})

// ─── 10k rows: single row update ─────────────────────────────────────

describe("single row update — 10k rows", () => {
  let signal: ReturnType<typeof createSignal<Model>>
  let teardown: Teardown
  let rows: Row[]

  bench("array (map wrapper)", () => {
    const idx = Math.floor(Math.random() * 10000)
    const row = rows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...rows]
    newRows[idx] = updated
    rows = newRows
    signal.setValue({ rows })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      const view = array<Model, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView,
      )
      rows = makeRows(10000)
      signal = createSignal<Model>({ rows })
      const updates = toUpdateStream(signal)
      teardown = view.attach(container, { rows }, updates, noopDispatch)
    },
    teardown() {
      teardown.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })

  bench("arrayBy (zero allocation)", () => {
    const idx = Math.floor(Math.random() * 10000)
    const row = rows[idx]!
    const updated = { ...row, label: row.label + " !" }
    const newRows = [...rows]
    newRows[idx] = updated
    rows = newRows
    signal.setValue({ rows })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      const view = arrayBy<Model, Row, never>(
        "tbody",
        (m) => m.rows,
        (r) => r.id,
        rowView,
      )
      rows = makeRows(10000)
      signal = createSignal<Model>({ rows })
      const updates = toUpdateStream(signal)
      teardown = view.attach(container, { rows }, updates, noopDispatch)
    },
    teardown() {
      teardown.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })
})

// ─── 1k rows: bulk attribute update (all rows change) ────────────────

describe("bulk update — 1k rows (all change)", () => {
  let signal: ReturnType<typeof createSignal<Model>>
  let teardown: Teardown
  let rows: Row[]
  let toggle = false

  bench("array (map wrapper)", () => {
    toggle = !toggle
    rows = rows.map(r => ({ ...r, selected: toggle }))
    signal.setValue({ rows })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      const view = array<Model, Row, never>(
        "tbody",
        (m) => m.rows.map(r => ({ key: r.id, model: r })),
        rowView,
      )
      rows = makeRows(1000)
      signal = createSignal<Model>({ rows })
      const updates = toUpdateStream(signal)
      teardown = view.attach(container, { rows }, updates, noopDispatch)
    },
    teardown() {
      teardown.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })

  bench("arrayBy (zero allocation)", () => {
    toggle = !toggle
    rows = rows.map(r => ({ ...r, selected: toggle }))
    signal.setValue({ rows })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      const view = arrayBy<Model, Row, never>(
        "tbody",
        (m) => m.rows,
        (r) => r.id,
        rowView,
      )
      rows = makeRows(1000)
      signal = createSignal<Model>({ rows })
      const updates = toUpdateStream(signal)
      teardown = view.attach(container, { rows }, updates, noopDispatch)
    },
    teardown() {
      teardown.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })
})
