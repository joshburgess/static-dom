import { describe, it, expect, afterEach } from "vitest"
import { text, element } from "../src/constructors"
import { setErrorHandler, type SDOMError } from "../src/errors"
import { mount, cleanup, type TestHarness } from "./helpers"

let h: TestHarness<any, any>
let restore: (() => void) | null = null

afterEach(() => {
  if (h) cleanup(h)
  restore?.()
  restore = null
})

describe("error boundaries", () => {
  it("catches errors in text derive during attach and reports to handler", () => {
    const errors: SDOMError[] = []
    restore = setErrorHandler(err => errors.push(err))

    const broken = text<{ value: string }>((m) => {
      if (m.value === "boom") throw new Error("derive exploded")
      return m.value
    })

    h = mount(broken, { value: "boom" })

    expect(errors).toHaveLength(1)
    expect(errors[0]!.phase).toBe("attach")
    expect(errors[0]!.context).toBe("text derive")
    expect((errors[0]!.error as Error).message).toBe("derive exploded")
    // Falls back to empty string
    expect(h.container.textContent).toBe("")
  })

  it("catches errors in text derive during update", () => {
    const errors: SDOMError[] = []
    restore = setErrorHandler(err => errors.push(err))

    const broken = text<{ value: string }>((m) => {
      if (m.value === "boom") throw new Error("update exploded")
      return m.value
    })

    h = mount(broken, { value: "ok" })
    expect(h.container.textContent).toBe("ok")

    h.set({ value: "boom" })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.phase).toBe("update")
    // Text falls back to empty string
    expect(h.container.textContent).toBe("")
  })

  it("catches errors in event handlers", () => {
    const errors: SDOMError[] = []
    restore = setErrorHandler(err => errors.push(err))

    const broken = element<"button", {}, string>("button", {
      on: {
        click: () => { throw new Error("handler exploded") },
      },
    }, [])

    h = mount(broken, {})
    h.container.querySelector("button")!.click()

    expect(errors).toHaveLength(1)
    expect(errors[0]!.phase).toBe("event")
    expect(errors[0]!.context).toBe('on "click"')
    // No message dispatched (fallback is null)
    expect(h.dispatched).toEqual([])
  })

  it("catches errors in child attach", () => {
    const errors: SDOMError[] = []
    restore = setErrorHandler(err => errors.push(err))

    const brokenChild = text<{}>(() => { throw new Error("child boom") })
    const parent = element<"div", {}, never>("div", {}, [brokenChild])

    h = mount(parent, {})

    // Error caught during attach
    expect(errors.length).toBeGreaterThanOrEqual(1)
    const attachError = errors.find(e => e.phase === "attach")
    expect(attachError).toBeDefined()
    // Parent div still exists
    expect(h.container.querySelector("div")).toBeTruthy()
  })

  it("catches errors in attribute derive", () => {
    const errors: SDOMError[] = []
    restore = setErrorHandler(err => errors.push(err))

    const broken = element<"div", { value: string }, never>("div", {
      rawAttrs: {
        "data-x": (m) => {
          if (m.value === "boom") throw new Error("attr boom")
          return m.value
        },
      },
    }, [])

    h = mount(broken, { value: "ok" })
    expect(errors).toHaveLength(0)

    h.set({ value: "boom" })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.phase).toBe("update")
    expect(errors[0]!.context).toBe('attr "data-x"')
  })

  it("setErrorHandler returns a restore function", () => {
    const errors1: SDOMError[] = []
    const errors2: SDOMError[] = []

    const restore1 = setErrorHandler(err => errors1.push(err))
    const restore2 = setErrorHandler(err => errors2.push(err))

    const broken = text<{}>(() => { throw new Error("test") })
    h = mount(broken, {})

    expect(errors1).toHaveLength(0)
    expect(errors2).toHaveLength(1)

    restore2()
    // Now errors1 handler is back
    // (cleanup will remove the mount)
    restore = restore1
  })
})
