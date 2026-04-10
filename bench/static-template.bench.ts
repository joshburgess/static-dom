/**
 * Benchmark: Template cloning investigation.
 *
 * Three benchmarks to understand when and whether template cloning wins:
 *
 * 1. **Small template (15 elements, 3 dynamic)** — the original "card" test.
 *    Tests both SDOM paths (jsx compiled vs template cloning) and both
 *    raw DOM approaches (createElement vs innerHTML + cloneNode).
 *
 * 2. **Micro-benchmark** — isolates just clone + wire vs createElement,
 *    with zero SDOM framework overhead. Tests the raw DOM operation cost.
 *
 * 3. **Large template (50 elements, 3 dynamic)** — tests whether template
 *    cloning wins at higher element counts where cloneNode should dominate.
 *
 * The raw DOM cloning benchmarks use firstChild/nextSibling navigation
 * (like Solid.js) instead of querySelector.
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

// ---------------------------------------------------------------------------
// Small template (15 elements, 3 dynamic)
// ---------------------------------------------------------------------------

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

// Build the raw template once — compact (no whitespace text nodes)
const rawTemplate = document.createElement("template")
rawTemplate.innerHTML =
  '<div class="card">' +
    '<div class="card-header">' +
      '<div class="card-header-left">' +
        '<h3 class="card-title"></h3>' +
        '<p class="card-subtitle"></p>' +
      '</div>' +
      '<div class="card-header-right">' +
        '<span class="card-badge"></span>' +
      '</div>' +
    '</div>' +
    '<div class="card-body">' +
      '<div class="card-content">' +
        '<p class="card-text">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>' +
        '<p class="card-text-secondary">Sed do eiusmod tempor incididunt ut labore.</p>' +
      '</div>' +
      '<div class="card-actions">' +
        '<button class="btn btn-primary">View</button>' +
        '<button class="btn btn-secondary">Edit</button>' +
        '<button class="btn btn-danger">Delete</button>' +
      '</div>' +
    '</div>' +
    '<div class="card-footer">' +
      '<span class="card-meta">Last updated: today</span>' +
      '<span class="card-id">ID: 000</span>' +
    '</div>' +
  '</div>'

// Pre-compile the tree walk path once — same approach as Solid.js
// Navigate: root > header > headerLeft > h3 (title)
//           root > header > headerLeft > h3.nextSibling (subtitle = p)
//           root > header > headerLeft.nextSibling > span (badge)
function walkClonedCard(root: Element, card: Card): void {
  const header = root.firstChild as Element            // div.card-header
  const headerLeft = header.firstChild as Element      // div.card-header-left
  const titleEl = headerLeft.firstChild as Element     // h3.card-title
  titleEl.textContent = card.title
  const subtitleEl = titleEl.nextSibling as Element    // p.card-subtitle
  subtitleEl.textContent = card.subtitle
  const headerRight = headerLeft.nextSibling as Element // div.card-header-right
  const badgeEl = headerRight.firstChild as Element    // span.card-badge
  badgeEl.textContent = card.badge
}

describe(`small template — ${CARD_COUNT} cards (15 elements, 3 dynamic)`, () => {

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

  // ─── SDOM (template cloning — innerHTML + walkers) ─────────────────

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

  bench("raw DOM (createElement)", () => {
    const container = document.createElement("div")
    const wrapper = document.createElement("div")
    const cards = makeCards(CARD_COUNT)

    for (const card of cards) {
      rawDOMCard(wrapper, card)
    }

    container.appendChild(wrapper)
    container.innerHTML = ""
  })

  // ─── Raw DOM (template cloning + tree walking) ─────────────────────

  bench("raw DOM (cloneNode + firstChild/nextSibling)", () => {
    const container = document.createElement("div")
    const wrapper = document.createElement("div")
    const cards = makeCards(CARD_COUNT)

    for (const card of cards) {
      const clone = rawTemplate.content.cloneNode(true) as DocumentFragment
      const root = clone.firstChild as Element
      walkClonedCard(root, card)
      wrapper.appendChild(root)
    }

    container.appendChild(wrapper)
    container.innerHTML = ""
  })
})

// ---------------------------------------------------------------------------
// Micro-benchmark: isolate clone vs createElement (zero framework overhead)
// ---------------------------------------------------------------------------

describe("micro: clone vs createElement — 15 elements, 3 dynamic", () => {

  bench("createElement (15 elements + set 3 values)", () => {
    const parent = document.createElement("div")

    for (let i = 0; i < 100; i++) {
      const div = document.createElement("div")
      const header = document.createElement("div")
      const headerLeft = document.createElement("div")
      const h3 = document.createElement("h3")
      h3.textContent = "title"
      const p = document.createElement("p")
      p.textContent = "subtitle"
      headerLeft.appendChild(h3)
      headerLeft.appendChild(p)
      const headerRight = document.createElement("div")
      const badge = document.createElement("span")
      badge.textContent = "new"
      headerRight.appendChild(badge)
      header.appendChild(headerLeft)
      header.appendChild(headerRight)
      const body = document.createElement("div")
      const content = document.createElement("div")
      const p1 = document.createElement("p")
      const p2 = document.createElement("p")
      content.appendChild(p1)
      content.appendChild(p2)
      const actions = document.createElement("div")
      const btn1 = document.createElement("button")
      const btn2 = document.createElement("button")
      const btn3 = document.createElement("button")
      actions.appendChild(btn1)
      actions.appendChild(btn2)
      actions.appendChild(btn3)
      body.appendChild(content)
      body.appendChild(actions)
      const footer = document.createElement("div")
      const m = document.createElement("span")
      const s = document.createElement("span")
      footer.appendChild(m)
      footer.appendChild(s)
      div.appendChild(header)
      div.appendChild(body)
      div.appendChild(footer)
      parent.appendChild(div)
    }

    parent.innerHTML = ""
  })

  bench("cloneNode + firstChild/nextSibling (3 bindings)", () => {
    const parent = document.createElement("div")

    for (let i = 0; i < 100; i++) {
      const clone = rawTemplate.content.cloneNode(true) as DocumentFragment
      const root = clone.firstChild as Element
      // Navigate via firstChild/nextSibling — same as Solid.js pattern
      const header = root.firstChild as Element
      const headerLeft = header.firstChild as Element
      const titleEl = headerLeft.firstChild as Element
      titleEl.textContent = "title"
      const subtitleEl = titleEl.nextSibling as Element
      subtitleEl.textContent = "subtitle"
      const headerRight = headerLeft.nextSibling as Element
      const badgeEl = headerRight.firstChild as Element
      badgeEl.textContent = "new"
      parent.appendChild(root)
    }

    parent.innerHTML = ""
  })
})

// ---------------------------------------------------------------------------
// Large template: 50+ elements, 3 dynamic
// ---------------------------------------------------------------------------

// Build a large template with deep nesting: 50 elements, 3 dynamic bindings
const largeTemplateHtml =
  '<div class="page">' +
    '<header class="page-header">' +
      '<nav class="nav">' +
        '<div class="nav-brand"><a class="logo" href="/"><img class="logo-img"><span class="logo-text">Brand</span></a></div>' +
        '<ul class="nav-links">' +
          '<li class="nav-item"><a class="nav-link" href="/home">Home</a></li>' +
          '<li class="nav-item"><a class="nav-link" href="/about">About</a></li>' +
          '<li class="nav-item"><a class="nav-link" href="/contact">Contact</a></li>' +
        '</ul>' +
        '<div class="nav-actions"><button class="btn-login">Login</button><button class="btn-signup">Sign Up</button></div>' +
      '</nav>' +
    '</header>' +
    '<main class="page-body">' +
      '<section class="hero">' +
        '<div class="hero-content">' +
          '<h1 class="hero-title"></h1>' +    // dynamic: title
          '<p class="hero-subtitle"></p>' +    // dynamic: subtitle
          '<div class="hero-cta"><button class="btn-primary">Get Started</button><button class="btn-secondary">Learn More</button></div>' +
        '</div>' +
        '<div class="hero-image"><div class="image-placeholder"></div></div>' +
      '</section>' +
      '<section class="features">' +
        '<div class="feature-grid">' +
          '<div class="feature-card"><div class="feature-icon"></div><h3 class="feature-title">Feature 1</h3><p class="feature-desc">Description one</p></div>' +
          '<div class="feature-card"><div class="feature-icon"></div><h3 class="feature-title">Feature 2</h3><p class="feature-desc">Description two</p></div>' +
          '<div class="feature-card"><div class="feature-icon"></div><h3 class="feature-title">Feature 3</h3><p class="feature-desc">Description three</p></div>' +
        '</div>' +
      '</section>' +
    '</main>' +
    '<footer class="page-footer">' +
      '<div class="footer-content">' +
        '<div class="footer-col"><h4>Company</h4><ul><li>About</li><li>Careers</li><li>Press</li></ul></div>' +
        '<div class="footer-col"><h4>Product</h4><ul><li>Features</li><li>Pricing</li><li>Docs</li></ul></div>' +
        '<div class="footer-col"><h4>Support</h4><ul><li>Help</li><li>Status</li><li>Contact</li></ul></div>' +
      '</div>' +
      '<div class="footer-bottom"><span class="copyright"></span></div>' +  // dynamic: copyright
    '</footer>' +
  '</div>'

const largeTemplate = document.createElement("template")
largeTemplate.innerHTML = largeTemplateHtml

interface LargeCard {
  title: string
  subtitle: string
  copyright: string
}

// Pre-compiled tree walk for large template dynamic bindings:
// title:     root > main(1) > hero(0) > hero-content(0) > h1(0)
// subtitle:  root > main(1) > hero(0) > hero-content(0) > h1(0).nextSibling = p
// copyright: root > footer(2) > footer-bottom(1) > span(0)
function walkLargeClone(root: Element, data: LargeCard): void {
  const main = (root.firstChild as Element).nextSibling as Element  // skip header, get main
  const hero = main.firstChild as Element
  const heroContent = hero.firstChild as Element
  const titleEl = heroContent.firstChild as Element
  titleEl.textContent = data.title
  const subtitleEl = titleEl.nextSibling as Element
  subtitleEl.textContent = data.subtitle
  const footer = main.nextSibling as Element
  const footerBottom = (footer.firstChild as Element).nextSibling as Element
  const copyrightEl = footerBottom.firstChild as Element
  copyrightEl.textContent = data.copyright
}

// Raw DOM large card via createElement (50 elements)
function rawDOMLargeCard(parent: Node, data: LargeCard): void {
  const page = document.createElement("div")
  page.className = "page"

  // Header (15 elements)
  const header = document.createElement("header")
  header.className = "page-header"
  const nav = document.createElement("nav")
  nav.className = "nav"
  const brand = document.createElement("div")
  brand.className = "nav-brand"
  const logo = document.createElement("a")
  logo.className = "logo"
  ;(logo as HTMLAnchorElement).href = "/"
  const logoImg = document.createElement("img")
  logoImg.className = "logo-img"
  const logoText = document.createElement("span")
  logoText.className = "logo-text"
  logoText.textContent = "Brand"
  logo.appendChild(logoImg)
  logo.appendChild(logoText)
  brand.appendChild(logo)

  const navLinks = document.createElement("ul")
  navLinks.className = "nav-links"
  for (const [href, text] of [
    ["/home", "Home"], ["/about", "About"], ["/contact", "Contact"],
  ] as const) {
    const li = document.createElement("li")
    li.className = "nav-item"
    const a = document.createElement("a")
    a.className = "nav-link"
    ;(a as HTMLAnchorElement).href = href
    a.textContent = text
    li.appendChild(a)
    navLinks.appendChild(li)
  }

  const navActions = document.createElement("div")
  navActions.className = "nav-actions"
  const btnLogin = document.createElement("button")
  btnLogin.className = "btn-login"
  btnLogin.textContent = "Login"
  const btnSignup = document.createElement("button")
  btnSignup.className = "btn-signup"
  btnSignup.textContent = "Sign Up"
  navActions.appendChild(btnLogin)
  navActions.appendChild(btnSignup)

  nav.appendChild(brand)
  nav.appendChild(navLinks)
  nav.appendChild(navActions)
  header.appendChild(nav)

  // Main (20+ elements)
  const main = document.createElement("main")
  main.className = "page-body"

  const hero = document.createElement("section")
  hero.className = "hero"
  const heroContent = document.createElement("div")
  heroContent.className = "hero-content"
  const h1 = document.createElement("h1")
  h1.className = "hero-title"
  h1.textContent = data.title
  const pSub = document.createElement("p")
  pSub.className = "hero-subtitle"
  pSub.textContent = data.subtitle
  const heroCta = document.createElement("div")
  heroCta.className = "hero-cta"
  const btnPrimary = document.createElement("button")
  btnPrimary.className = "btn-primary"
  btnPrimary.textContent = "Get Started"
  const btnSecondary = document.createElement("button")
  btnSecondary.className = "btn-secondary"
  btnSecondary.textContent = "Learn More"
  heroCta.appendChild(btnPrimary)
  heroCta.appendChild(btnSecondary)
  heroContent.appendChild(h1)
  heroContent.appendChild(pSub)
  heroContent.appendChild(heroCta)
  const heroImage = document.createElement("div")
  heroImage.className = "hero-image"
  const imgPlaceholder = document.createElement("div")
  imgPlaceholder.className = "image-placeholder"
  heroImage.appendChild(imgPlaceholder)
  hero.appendChild(heroContent)
  hero.appendChild(heroImage)

  const features = document.createElement("section")
  features.className = "features"
  const featureGrid = document.createElement("div")
  featureGrid.className = "feature-grid"
  for (const [title, desc] of [
    ["Feature 1", "Description one"],
    ["Feature 2", "Description two"],
    ["Feature 3", "Description three"],
  ] as const) {
    const card = document.createElement("div")
    card.className = "feature-card"
    const icon = document.createElement("div")
    icon.className = "feature-icon"
    const h3 = document.createElement("h3")
    h3.className = "feature-title"
    h3.textContent = title
    const p = document.createElement("p")
    p.className = "feature-desc"
    p.textContent = desc
    card.appendChild(icon)
    card.appendChild(h3)
    card.appendChild(p)
    featureGrid.appendChild(card)
  }
  features.appendChild(featureGrid)

  main.appendChild(hero)
  main.appendChild(features)

  // Footer (15+ elements)
  const footer = document.createElement("footer")
  footer.className = "page-footer"
  const footerContent = document.createElement("div")
  footerContent.className = "footer-content"
  for (const [heading, items] of [
    ["Company", ["About", "Careers", "Press"]],
    ["Product", ["Features", "Pricing", "Docs"]],
    ["Support", ["Help", "Status", "Contact"]],
  ] as const) {
    const col = document.createElement("div")
    col.className = "footer-col"
    const h4 = document.createElement("h4")
    h4.textContent = heading
    const ul = document.createElement("ul")
    for (const item of items) {
      const li = document.createElement("li")
      li.textContent = item
      ul.appendChild(li)
    }
    col.appendChild(h4)
    col.appendChild(ul)
    footerContent.appendChild(col)
  }
  const footerBottom = document.createElement("div")
  footerBottom.className = "footer-bottom"
  const copyright = document.createElement("span")
  copyright.className = "copyright"
  copyright.textContent = data.copyright
  footerBottom.appendChild(copyright)
  footer.appendChild(footerContent)
  footer.appendChild(footerBottom)

  page.appendChild(header)
  page.appendChild(main)
  page.appendChild(footer)

  parent.appendChild(page)
}

const LARGE_COUNT = 500

describe(`large template — ${LARGE_COUNT} items (50+ elements, 3 dynamic)`, () => {

  bench("raw DOM (createElement)", () => {
    const container = document.createElement("div")
    const cards = Array.from({ length: LARGE_COUNT }, (_, i) => ({
      title: `Title ${i}`,
      subtitle: `Subtitle ${i}`,
      copyright: `© 2024 Company ${i}`,
    }))

    for (const card of cards) {
      rawDOMLargeCard(container, card)
    }
    container.innerHTML = ""
  })

  bench("raw DOM (cloneNode + firstChild/nextSibling)", () => {
    const container = document.createElement("div")
    const cards = Array.from({ length: LARGE_COUNT }, (_, i) => ({
      title: `Title ${i}`,
      subtitle: `Subtitle ${i}`,
      copyright: `© 2024 Company ${i}`,
    }))

    for (const card of cards) {
      const clone = largeTemplate.content.cloneNode(true) as DocumentFragment
      const root = clone.firstChild as Element
      walkLargeClone(root, card)
      container.appendChild(root)
    }
    container.innerHTML = ""
  })
})

// ---------------------------------------------------------------------------
// Micro: 50-element clone vs createElement
// ---------------------------------------------------------------------------

describe("micro: clone vs createElement — 50 elements, 3 dynamic", () => {

  bench("createElement (50 elements + set 3 values)", () => {
    const parent = document.createElement("div")

    for (let i = 0; i < 100; i++) {
      rawDOMLargeCard(parent, {
        title: "title",
        subtitle: "subtitle",
        copyright: "© 2024",
      })
    }

    parent.innerHTML = ""
  })

  bench("cloneNode + firstChild/nextSibling (3 bindings)", () => {
    const parent = document.createElement("div")

    for (let i = 0; i < 100; i++) {
      const clone = largeTemplate.content.cloneNode(true) as DocumentFragment
      const root = clone.firstChild as Element
      walkLargeClone(root, {
        title: "title",
        subtitle: "subtitle",
        copyright: "© 2024",
      })
      parent.appendChild(root)
    }

    parent.innerHTML = ""
  })
})
