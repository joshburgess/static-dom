/**
 * Benchmark: Attribute-only updates.
 *
 * This should show the biggest SDOM win. We have 1k elements, each with
 * a class and a data attribute. On each tick we update the class on all
 * of them. SDOM patches attributes directly; React/Preact must diff the
 * entire tree to figure out that only attributes changed.
 */

import { bench, describe } from "vitest"
import { createElement } from "react"
import { createRoot, type Root as ReactRoot } from "react-dom/client"
import { h, render as preactRender } from "preact"
import { createSignal as solidSignal, createRoot as solidRoot, createEffect, batch } from "solid-js"
import type { Setter } from "solid-js"
import { text, element, array } from "../src/constructors"
import { incrementalArray } from "../src/incremental"
import { keyedOps, keyedPatch, type KeyedArrayDelta } from "../src/patch"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import type { Teardown } from "../src/types"

const ITEM_COUNT = 1_000

interface Item { id: string; active: boolean; count: number }

function makeItems(count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    active: i % 2 === 0,
    count: 0,
  }))
}

describe(`attribute-only update — ${ITEM_COUNT} items`, () => {
  // ─── SDOM ───────────────────────────────────────────────────────────

  let sdomSignal: ReturnType<typeof createSignal<{ items: Item[] }>>
  let sdomTeardown: Teardown
  let sdomItems: Item[]
  let sdomTick: number

  bench("sdom", () => {
    sdomTick++
    // Toggle all active states and bump count
    sdomItems = sdomItems.map(item => ({
      ...item,
      active: !item.active,
      count: sdomTick,
    }))
    sdomSignal.setValue({ items: sdomItems })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      sdomTick = 0

      const itemView = element<Item, never>("div", {
        rawAttrs: {
          class: (m) => m.active ? "active" : "inactive",
          "data-count": (m) => String(m.count),
        },
      }, [text((m) => m.id)])

      interface Model { items: Item[] }
      const view = array<Model, Item, never>(
        "div",
        (m) => m.items.map(i => ({ key: i.id, model: i })),
        itemView
      )

      sdomItems = makeItems(ITEM_COUNT)
      sdomSignal = createSignal<Model>({ items: sdomItems })
      const updates = toUpdateStream(sdomSignal)
      const dispatch: Dispatcher<never> = () => {}
      sdomTeardown = view.attach(container, { items: sdomItems }, updates, dispatch)
    },
    teardown() {
      sdomTeardown.teardown()
    },
  })

  // ─── SDOM (incremental) ─────────────────────────────────────────────
  // Uses incrementalArray with keyed deltas — sends a keyedPatch for
  // each item, skipping the full reconciliation.

  interface IncrModel {
    items: Item[]
    _delta: KeyedArrayDelta<Item> | null
  }

  let incrSignal: ReturnType<typeof createSignal<IncrModel>>
  let incrTeardown: Teardown
  let incrItems: Item[]
  let incrTick: number

  bench("sdom (incremental)", () => {
    incrTick++
    const newItems = incrItems.map(item => ({
      ...item,
      active: !item.active,
      count: incrTick,
    }))
    const patches = newItems.map(item => keyedPatch<Item>(item.id, item))
    incrItems = newItems
    incrSignal.setValue({
      items: incrItems,
      _delta: keyedOps(...patches),
    })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      incrTick = 0

      const itemView = element<Item, never>("div", {
        rawAttrs: {
          class: (m) => m.active ? "active" : "inactive",
          "data-count": (m) => String(m.count),
        },
      }, [text((m) => m.id)])

      const view = incrementalArray<IncrModel, Item, never>(
        "div",
        (m) => m.items.map(i => ({ key: i.id, model: i })),
        (m) => m._delta,
        itemView
      )

      incrItems = makeItems(ITEM_COUNT)
      incrSignal = createSignal<IncrModel>({ items: incrItems, _delta: null })
      const updates = toUpdateStream(incrSignal)
      const dispatch: Dispatcher<never> = () => {}
      incrTeardown = view.attach(container, { items: incrItems, _delta: null }, updates, dispatch)
    },
    teardown() {
      incrTeardown.teardown()
    },
  })

  // ─── React ──────────────────────────────────────────────────────────

  let reactRoot: ReactRoot
  let reactItems: Item[]
  let reactContainer: HTMLElement
  let reactTick: number

  bench("react", () => {
    reactTick++
    reactItems = reactItems.map(item => ({
      ...item,
      active: !item.active,
      count: reactTick,
    }))

    const els = reactItems.map((item) =>
      createElement("div", {
        key: item.id,
        className: item.active ? "active" : "inactive",
        "data-count": String(item.count),
      }, item.id)
    )
    reactRoot.render(createElement("div", null, els))
  }, {
    setup() {
      reactContainer = document.createElement("div")
      document.body.appendChild(reactContainer)
      reactRoot = createRoot(reactContainer)
      reactTick = 0
      reactItems = makeItems(ITEM_COUNT)

      const els = reactItems.map((item) =>
        createElement("div", {
          key: item.id,
          className: item.active ? "active" : "inactive",
          "data-count": String(item.count),
        }, item.id)
      )
      reactRoot.render(createElement("div", null, els))
    },
    teardown() {
      reactRoot.unmount()
      reactContainer.remove()
    },
  })

  // ─── Preact ─────────────────────────────────────────────────────────

  let preactItems: Item[]
  let preactContainer: HTMLElement
  let preactTick: number

  bench("preact", () => {
    preactTick++
    preactItems = preactItems.map(item => ({
      ...item,
      active: !item.active,
      count: preactTick,
    }))

    const els = preactItems.map((item) =>
      h("div", {
        key: item.id,
        class: item.active ? "active" : "inactive",
        "data-count": String(item.count),
      }, item.id)
    )
    preactRender(h("div", null, els), preactContainer)
  }, {
    setup() {
      preactContainer = document.createElement("div")
      document.body.appendChild(preactContainer)
      preactTick = 0
      preactItems = makeItems(ITEM_COUNT)

      const els = preactItems.map((item) =>
        h("div", {
          key: item.id,
          class: item.active ? "active" : "inactive",
          "data-count": String(item.count),
        }, item.id)
      )
      preactRender(h("div", null, els), preactContainer)
    },
    teardown() {
      preactRender(null, preactContainer)
      preactContainer.remove()
    },
  })

  // ─── Solid ──────────────────────────────────────────────────────────
  // Each item has its own signals; toggling is O(n) signal updates
  // batched into a single flush — exactly how Solid apps work.

  let solidDispose: () => void
  let solidActiveSetters: Setter<boolean>[]
  let solidCountSetters: Setter<number>[]
  let solidTick: number

  bench("solid", () => {
    solidTick++
    batch(() => {
      for (let i = 0; i < ITEM_COUNT; i++) {
        solidActiveSetters[i]!(prev => !prev)
        solidCountSetters[i]!(solidTick)
      }
    })
  }, {
    setup() {
      const container = document.createElement("div")
      document.body.appendChild(container)
      solidTick = 0

      solidRoot(dispose => {
        solidDispose = dispose
        solidActiveSetters = []
        solidCountSetters = []

        const items = makeItems(ITEM_COUNT)
        const wrapper = document.createElement("div")

        for (const item of items) {
          const [active, setActive] = solidSignal(item.active)
          const [count, setCount] = solidSignal(item.count)
          solidActiveSetters.push(setActive)
          solidCountSetters.push(setCount)

          const div = document.createElement("div")
          div.textContent = item.id
          createEffect(() => {
            div.className = active() ? "active" : "inactive"
          })
          createEffect(() => {
            div.setAttribute("data-count", String(count()))
          })
          wrapper.appendChild(div)
        }

        container.appendChild(wrapper)
      })
    },
    teardown() {
      solidDispose()
    },
  })
})
