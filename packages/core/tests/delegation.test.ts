import { describe, it, expect, afterEach } from "vitest"
import { createDelegator, type EventDelegator } from "../src/delegation"
import { program } from "../src/program"
import { element, arrayBy } from "../src/constructors"
import { text } from "../src/constructors"
import type { SDOM } from "../src/types"

describe("createDelegator", () => {
  let root: HTMLDivElement
  let delegator: EventDelegator

  afterEach(() => {
    delegator?.teardown()
    root?.remove()
  })

  function setup() {
    root = document.createElement("div")
    document.body.appendChild(root)
    delegator = createDelegator(root)
  }

  it("routes click events to registered handlers", () => {
    setup()
    const button = document.createElement("button")
    root.appendChild(button)

    const clicks: Event[] = []
    delegator.on(button, "click", e => clicks.push(e))

    button.click()
    expect(clicks.length).toBe(1)
  })

  it("routes events from nested children", () => {
    setup()
    const div = document.createElement("div")
    const span = document.createElement("span")
    div.appendChild(span)
    root.appendChild(div)

    const clicks: Event[] = []
    delegator.on(div, "click", e => clicks.push(e))

    // Click on the span — event bubbles to the div's registered handler
    span.click()
    expect(clicks.length).toBe(1)
  })

  it("unregisters handlers", () => {
    setup()
    const button = document.createElement("button")
    root.appendChild(button)

    const clicks: Event[] = []
    const unregister = delegator.on(button, "click", e => clicks.push(e))

    button.click()
    expect(clicks.length).toBe(1)

    unregister()
    button.click()
    expect(clicks.length).toBe(1) // No new click recorded
  })

  it("handles multiple elements with same event type", () => {
    setup()
    const btn1 = document.createElement("button")
    const btn2 = document.createElement("button")
    root.appendChild(btn1)
    root.appendChild(btn2)

    const results: string[] = []
    delegator.on(btn1, "click", () => results.push("btn1"))
    delegator.on(btn2, "click", () => results.push("btn2"))

    btn1.click()
    btn2.click()
    expect(results).toEqual(["btn1", "btn2"])
  })

  it("handles different event types on same element", () => {
    setup()
    const input = document.createElement("input")
    root.appendChild(input)

    const events: string[] = []
    delegator.on(input, "click", () => events.push("click"))
    delegator.on(input, "focus", () => events.push("focus"))

    input.click()
    expect(events).toContain("click")
  })

  it("teardown removes all root listeners", () => {
    setup()
    const button = document.createElement("button")
    root.appendChild(button)

    const clicks: Event[] = []
    delegator.on(button, "click", e => clicks.push(e))

    delegator.teardown()
    button.click()
    expect(clicks.length).toBe(0)
  })
})

describe("program-level delegation", () => {
  it("routes events from arrayBy items through a single root listener", () => {
    interface Item { id: string; label: string }
    interface M { items: Item[] }
    type Msg = { type: "click"; id: string }

    const itemSdom: SDOM<Item, Msg> = element<"li", Item, Msg>("li", {
      on: { click: (_e, m) => ({ type: "click", id: m.id }) },
    }, [text(m => m.label)])

    const view = arrayBy<M, Item, Msg>(
      "ul",
      m => m.items,
      i => i.id,
      itemSdom,
    )

    const container = document.createElement("div")
    document.body.appendChild(container)

    const dispatched: Msg[] = []
    const handle = program<M, Msg>({
      container,
      init: { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
      update: (msg, m) => { dispatched.push(msg); return m },
      view,
    })

    // Sanity check: only one click listener at the root container.
    // We can't directly count listeners, but we can verify clicks route
    // correctly and that adding more rows doesn't add per-row listeners
    // (covered by the bench, but we at least confirm dispatch works here).
    const lis = container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    ;(lis[0] as HTMLElement).click()
    ;(lis[1] as HTMLElement).click()
    expect(dispatched).toEqual([
      { type: "click", id: "a" },
      { type: "click", id: "b" },
    ])

    handle.teardown()
    container.remove()
  })
})
