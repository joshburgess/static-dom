/**
 * Benchmark: dynamic constructor — key-based remounting and cached switching.
 *
 * Three scenarios:
 * 1. Same-key update — factory result stays mounted, only leaf values update.
 * 2. Key change (no cache) — full teardown + factory + mount.
 * 3. Key change (cached) — detach + reinsert from cache.
 *
 * Scenario 3 should be significantly faster than 2 for views with expensive
 * DOM setup, since the DOM nodes are reused rather than recreated.
 */

import { bench, describe } from "vitest"
import { dynamic, element, text } from "../src/constructors"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { setGuardEnabled } from "../src/errors"
import { setDevMode } from "../src/dev"
import type { SDOM, Teardown } from "../src/types"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

interface Model {
  layout: string
  data: string
  tick: number
}

// Create views with some DOM weight (multiple children per branch)
function makeBranchView(label: string): SDOM<Model, never> {
  return element<"div", Model, never>("div", {
    rawAttrs: { class: () => label },
  }, [
    element<"h2", Model, never>("h2", {}, [text(() => label)]),
    element<"p", Model, never>("p", {}, [text(m => m.data)]),
    element<"span", Model, never>("span", {}, [text(m => String(m.tick))]),
  ])
}

const layouts = ["alpha", "beta", "gamma", "delta"]
const branchMap: Record<string, SDOM<Model, never>> = {}
for (const l of layouts) branchMap[l] = makeBranchView(l)

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("dynamic — same-key update", () => {
  let sig: ReturnType<typeof createSignal<Model>>
  let td: Teardown
  let tick = 0

  bench("dynamic (no cache)", () => {
    tick++
    sig.setValue({ layout: "alpha", data: `data-${tick}`, tick })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      document.body.appendChild(container)
      tick = 0

      const view = dynamic<Model, never, string>(
        m => m.layout,
        m => branchMap[m.layout]!,
      )

      const initial: Model = { layout: "alpha", data: "init", tick: 0 }
      sig = createSignal(initial)
      td = view.attach(container, initial, toUpdateStream(sig), (() => {}) as Dispatcher<never>)
    },
    teardown() {
      td.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })
})

describe("dynamic — key switch (no cache)", () => {
  let sig: ReturnType<typeof createSignal<Model>>
  let td: Teardown
  let tick = 0

  bench("dynamic", () => {
    tick++
    sig.setValue({ layout: layouts[tick % layouts.length]!, data: `data-${tick}`, tick })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      document.body.appendChild(container)
      tick = 0

      const view = dynamic<Model, never, string>(
        m => m.layout,
        m => branchMap[m.layout]!,
      )

      const initial: Model = { layout: "alpha", data: "init", tick: 0 }
      sig = createSignal(initial)
      td = view.attach(container, initial, toUpdateStream(sig), (() => {}) as Dispatcher<never>)
    },
    teardown() {
      td.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })
})

describe("dynamic — key switch (cached)", () => {
  let sig: ReturnType<typeof createSignal<Model>>
  let td: Teardown
  let tick = 0

  bench("dynamic { cache: true }", () => {
    tick++
    sig.setValue({ layout: layouts[tick % layouts.length]!, data: `data-${tick}`, tick })
  }, {
    setup() {
      setGuardEnabled(false)
      setDevMode(false)
      const container = document.createElement("div")
      document.body.appendChild(container)
      tick = 0

      const view = dynamic<Model, never, string>(
        m => m.layout,
        m => branchMap[m.layout]!,
        { cache: true },
      )

      const initial: Model = { layout: "alpha", data: "init", tick: 0 }
      sig = createSignal(initial)
      td = view.attach(container, initial, toUpdateStream(sig), (() => {}) as Dispatcher<never>)

      // Warm the cache by visiting all branches
      for (let i = 1; i < layouts.length; i++) {
        sig.setValue({ layout: layouts[i]!, data: "warm", tick: 0 })
      }
      sig.setValue({ layout: "alpha", data: "init", tick: 0 })
    },
    teardown() {
      td.teardown()
      setGuardEnabled(true)
      setDevMode(true)
    },
  })
})
