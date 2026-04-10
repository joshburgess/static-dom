import { describe, it, expect, afterEach } from "vitest"
import { createDelegator, type EventDelegator } from "../src/delegation"

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
