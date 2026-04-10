/**
 * Benchmark: Static-heavy template — where template cloning wins.
 *
 * A "card" component with 15 static elements (divs, spans, headings,
 * paragraphs) and only 3 dynamic bindings (title, subtitle, badge).
 * This is the scenario template cloning is designed for: the browser
 * copies 15 elements in one cloneNode(true) call vs 15 createElement calls.
 *
 * Renders 1k cards to measure initial mount throughput.
 */

import { bench, describe } from "vitest"
import { jsx, compileSpecCloned } from "../src/jsx-runtime"
import { classifyProps, tryBuildChildSpecs, _TEMPLATE_SPEC, type JsxSpec } from "../src/shared"
import { array, compiled } from "../src/constructors"
import { createSignal, toUpdateStream, type Dispatcher } from "../src/observable"
import { setGuardEnabled } from "../src/errors"
import { setDevMode } from "../src/dev"
import type { Teardown } from "../src/types"

const CARD_COUNT = 1_000

interface Card {
  id: string
  title: string
  subtitle: string
  badge: string
}

function makeCards(count: number): Card[] {
  const cards: Card[] = []
  for (let i = 0; i < count; i++) {
    cards.push({
      id: `card-${i}`,
      title: `Card Title ${i}`,
      subtitle: `Subtitle for card ${i}`,
      badge: i % 3 === 0 ? "new" : i % 3 === 1 ? "hot" : "",
    })
  }
  return cards
}

// Static-heavy card template via JSX (default path = direct createElement)
const jsxCardView = jsx("div", {
  class: "card",
  children: [
    jsx("div", { class: "card-header", children: [
      jsx("div", { class: "card-header-left", children: [
        jsx("h3", { class: "card-title", children: (m: Card) => m.title }),
        jsx("p", { class: "card-subtitle", children: (m: Card) => m.subtitle }),
      ]}),
      jsx("div", { class: "card-header-right", children: [
        jsx("span", { class: "card-badge", children: (m: Card) => m.badge }),
      ]}),
    ]}),
    jsx("div", { class: "card-body", children: [
      jsx("div", { class: "card-content", children: [
        jsx("p", { class: "card-text", children: "Lorem ipsum dolor sit amet, consectetur adipiscing elit." }),
        jsx("p", { class: "card-text-secondary", children: "Sed do eiusmod tempor incididunt ut labore." }),
      ]}),
      jsx("div", { class: "card-actions", children: [
        jsx("button", { class: "btn btn-primary", children: "View" }),
        jsx("button", { class: "btn btn-secondary", children: "Edit" }),
        jsx("button", { class: "btn btn-danger", children: "Delete" }),
      ]}),
    ]}),
    jsx("div", { class: "card-footer", children: [
      jsx("span", { class: "card-meta", children: "Last updated: today" }),
      jsx("span", { class: "card-id", children: "ID: 000" }),
    ]}),
  ]
})

// Extract the spec from the JSX card for cloned version
const jsxCardSpec = (jsxCardView as any)[_TEMPLATE_SPEC] as JsxSpec
const clonedCardView = compileSpecCloned(jsxCardSpec)

// Raw DOM card for baseline
function rawDOMCard(parent: Node, card: Card): void {
  const div = document.createElement("div")
  div.className = "card"

  const header = document.createElement("div")
  header.className = "card-header"

  const headerLeft = document.createElement("div")
  headerLeft.className = "card-header-left"
  const h3 = document.createElement("h3")
  h3.className = "card-title"
  h3.textContent = card.title
  const pSub = document.createElement("p")
  pSub.className = "card-subtitle"
  pSub.textContent = card.subtitle
  headerLeft.appendChild(h3)
  headerLeft.appendChild(pSub)

  const headerRight = document.createElement("div")
  headerRight.className = "card-header-right"
  const badge = document.createElement("span")
  badge.className = "card-badge"
  badge.textContent = card.badge
  headerRight.appendChild(badge)

  header.appendChild(headerLeft)
  header.appendChild(headerRight)

  const body = document.createElement("div")
  body.className = "card-body"

  const content = document.createElement("div")
  content.className = "card-content"
  const p1 = document.createElement("p")
  p1.className = "card-text"
  p1.textContent = "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
  const p2 = document.createElement("p")
  p2.className = "card-text-secondary"
  p2.textContent = "Sed do eiusmod tempor incididunt ut labore."
  content.appendChild(p1)
  content.appendChild(p2)

  const actions = document.createElement("div")
  actions.className = "card-actions"
  const btn1 = document.createElement("button")
  btn1.className = "btn btn-primary"
  btn1.textContent = "View"
  const btn2 = document.createElement("button")
  btn2.className = "btn btn-secondary"
  btn2.textContent = "Edit"
  const btn3 = document.createElement("button")
  btn3.className = "btn btn-danger"
  btn3.textContent = "Delete"
  actions.appendChild(btn1)
  actions.appendChild(btn2)
  actions.appendChild(btn3)

  body.appendChild(content)
  body.appendChild(actions)

  const footer = document.createElement("div")
  footer.className = "card-footer"
  const meta = document.createElement("span")
  meta.className = "card-meta"
  meta.textContent = "Last updated: today"
  const idSpan = document.createElement("span")
  idSpan.className = "card-id"
  idSpan.textContent = "ID: 000"
  footer.appendChild(meta)
  footer.appendChild(idSpan)

  div.appendChild(header)
  div.appendChild(body)
  div.appendChild(footer)

  parent.appendChild(div)
}

const noopDispatch: Dispatcher<never> = () => {}

interface Model { cards: Card[] }

describe(`static-heavy cards — ${CARD_COUNT} cards (15 elements, 3 dynamic)`, () => {

  // ─── SDOM JSX (direct createElement) ───────────────────────────────

  bench("sdom (jsx compiled)", () => {
    setGuardEnabled(false)
    setDevMode(false)
    try {
      const container = document.createElement("div")
      const cards = makeCards(CARD_COUNT)
      const model: Model = { cards }

      const view = array<Model, Card, never>(
        "div",
        (m) => m.cards.map(c => ({ key: c.id, model: c })),
        jsxCardView as any,
      )

      const signal = createSignal(model)
      const updates = toUpdateStream(signal)
      view.attach(container, model, updates, noopDispatch)
      container.innerHTML = ""
    } finally {
      setGuardEnabled(true)
      setDevMode(true)
    }
  })

  // ─── SDOM (template cloning) ───────────────────────────────────────

  bench("sdom (template cloning)", () => {
    setGuardEnabled(false)
    setDevMode(false)
    try {
      const container = document.createElement("div")
      const cards = makeCards(CARD_COUNT)
      const model: Model = { cards }

      const view = array<Model, Card, never>(
        "div",
        (m) => m.cards.map(c => ({ key: c.id, model: c })),
        clonedCardView as any,
      )

      const signal = createSignal(model)
      const updates = toUpdateStream(signal)
      view.attach(container, model, updates, noopDispatch)
      container.innerHTML = ""
    } finally {
      setGuardEnabled(true)
      setDevMode(true)
    }
  })

  // ─── Raw DOM ────────────────────────────────────────────────────────

  bench("raw DOM", () => {
    const container = document.createElement("div")
    const wrapper = document.createElement("div")
    const cards = makeCards(CARD_COUNT)

    for (const card of cards) {
      rawDOMCard(wrapper, card)
    }

    container.appendChild(wrapper)
    container.innerHTML = ""
  })

  // ─── Raw DOM (template cloning) ────────────────────────────────────
  // Manual template cloning — build once, cloneNode for each card.

  bench("raw DOM (template cloning)", () => {
    const container = document.createElement("div")
    const wrapper = document.createElement("div")
    const cards = makeCards(CARD_COUNT)

    for (const card of cards) {
      const clone = rawTemplate.content.cloneNode(true) as DocumentFragment
      const root = clone.firstChild as HTMLDivElement
      // Wire 3 dynamic parts
      const titleEl = root.querySelector(".card-title")!
      titleEl.textContent = card.title
      const subtitleEl = root.querySelector(".card-subtitle")!
      subtitleEl.textContent = card.subtitle
      const badgeEl = root.querySelector(".card-badge")!
      badgeEl.textContent = card.badge
      wrapper.appendChild(root)
    }

    container.appendChild(wrapper)
    container.innerHTML = ""
  })
})

// Build the raw template once
const rawTemplate = document.createElement("template")
rawTemplate.innerHTML = `<div class="card">
  <div class="card-header">
    <div class="card-header-left">
      <h3 class="card-title"></h3>
      <p class="card-subtitle"></p>
    </div>
    <div class="card-header-right">
      <span class="card-badge"></span>
    </div>
  </div>
  <div class="card-body">
    <div class="card-content">
      <p class="card-text">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      <p class="card-text-secondary">Sed do eiusmod tempor incididunt ut labore.</p>
    </div>
    <div class="card-actions">
      <button class="btn btn-primary">View</button>
      <button class="btn btn-secondary">Edit</button>
      <button class="btn btn-danger">Delete</button>
    </div>
  </div>
  <div class="card-footer">
    <span class="card-meta">Last updated: today</span>
    <span class="card-id">ID: 000</span>
  </div>
</div>`
