/**
 * examples/dynamic-demo.ts — demonstrates the dynamic constructor
 *
 * Switchable layout views: grid, list, compact.
 * Shows dynamic() with caching for instant back-and-forth switching.
 */

import { element, text, dynamic, program } from "../src/index"

// -- Model ------------------------------------------------------------------

interface Item {
  id: string
  name: string
  description: string
  price: number
}

interface Model {
  layout: "grid" | "list" | "compact"
  items: Item[]
}

type Msg =
  | { type: "setLayout"; layout: Model["layout"] }

const sampleItems: Item[] = [
  { id: "1", name: "Widget", description: "A useful widget for everyday tasks", price: 9.99 },
  { id: "2", name: "Gadget", description: "The latest gadget with advanced features", price: 24.99 },
  { id: "3", name: "Doohickey", description: "An indispensable doohickey", price: 4.99 },
  { id: "4", name: "Thingamajig", description: "Premium quality thingamajig", price: 14.99 },
  { id: "5", name: "Whatchamacallit", description: "A classic whatchamacallit", price: 19.99 },
  { id: "6", name: "Gizmo", description: "Compact and portable gizmo", price: 7.99 },
]

// -- Update -----------------------------------------------------------------

function update(msg: Msg, model: Model): Model {
  switch (msg.type) {
    case "setLayout":
      return { ...model, layout: msg.layout }
  }
}

// -- Layout views -----------------------------------------------------------

// Each layout renders the same data in a different structure.
// dynamic() mounts the appropriate view based on the layout key.

const gridView = element<"div", Model, Msg>("div", {
  rawAttrs: { class: () => "grid-layout" },
}, [
  text(m => m.items.map(item =>
    `[${item.name}] $${item.price.toFixed(2)} - ${item.description}`
  ).join(" | ")),
])

const listView = element<"div", Model, Msg>("div", {
  rawAttrs: { class: () => "list-layout" },
}, [
  text(m => m.items.map(item =>
    `${item.name}: ${item.description} ($${item.price.toFixed(2)})`
  ).join("\n")),
])

const compactView = element<"div", Model, Msg>("div", {
  rawAttrs: { class: () => "compact-layout" },
}, [
  text(m => m.items.map(item =>
    `${item.name} \u2014 $${item.price.toFixed(2)}`
  ).join(" \u00b7 ")),
])

import type { SDOM } from "../src/types"

const layoutMap: Record<string, SDOM<Model, Msg>> = {
  grid: gridView,
  list: listView,
  compact: compactView,
}

// The dynamic constructor uses a key function to decide when to remount.
// With { cache: true }, switching back to a previously visited layout
// reuses the existing DOM nodes instead of rebuilding from scratch.
const dynamicLayout = dynamic<Model, Msg, string>(
  m => m.layout,
  m => layoutMap[m.layout]!,
  { cache: true },
)

// -- Main view --------------------------------------------------------------

const view = element<"div", Model, Msg>("div", {}, [
  element("h2", {}, [text(() => "dynamic() demo \u2014 switchable layouts")]),
  element("p", { style: { color: () => "#888" } }, [
    text(() => "Switch layouts with caching \u2014 DOM nodes are reused on re-entry:"),
  ]),
  element("div", { rawAttrs: { class: () => "layout-controls" } }, [
    element("button", {
      classes: m => ({ active: m.layout === "grid" }),
      on: { click: () => ({ type: "setLayout", layout: "grid" as const }) },
    }, [text(() => "Grid")]),
    element("button", {
      classes: m => ({ active: m.layout === "list" }),
      on: { click: () => ({ type: "setLayout", layout: "list" as const }) },
    }, [text(() => "List")]),
    element("button", {
      classes: m => ({ active: m.layout === "compact" }),
      on: { click: () => ({ type: "setLayout", layout: "compact" as const }) },
    }, [text(() => "Compact")]),
  ]),
  dynamicLayout,
])

// -- Mount ------------------------------------------------------------------

export function mountDynamicDemo(container: HTMLElement) {
  return program({
    container,
    init: { layout: "grid", items: sampleItems },
    update,
    view,
  })
}
