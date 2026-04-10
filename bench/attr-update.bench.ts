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
import { text, element, array } from "../src/constructors"
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
})
