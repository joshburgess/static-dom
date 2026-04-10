import { describe, it, expect, vi, afterEach } from "vitest"
import { currentUrl, pushUrl, replaceUrl, back, forward, onUrlChange, onHashChange } from "../src/navigation"
import type { UrlLocation } from "../src/navigation"
import type { Teardown } from "../src/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let teardowns: Teardown[] = []

afterEach(() => {
  for (const td of teardowns) td.teardown()
  teardowns = []
  // Reset URL to avoid leaking between tests
  window.history.replaceState(null, "", "/")
})

// ---------------------------------------------------------------------------
// currentUrl
// ---------------------------------------------------------------------------

describe("currentUrl", () => {
  it("returns a UrlLocation snapshot", () => {
    const url = currentUrl()
    expect(typeof url.pathname).toBe("string")
    expect(typeof url.search).toBe("string")
    expect(typeof url.hash).toBe("string")
    expect(typeof url.href).toBe("string")
  })

  it("reflects the current pathname", () => {
    window.history.replaceState(null, "", "/test-path")
    const url = currentUrl()
    expect(url.pathname).toBe("/test-path")
  })
})

// ---------------------------------------------------------------------------
// pushUrl
// ---------------------------------------------------------------------------

describe("pushUrl", () => {
  it("changes the URL", () => {
    pushUrl("/new-page")(() => {})
    expect(window.location.pathname).toBe("/new-page")
  })

  it("fires popstate so onUrlChange picks it up", () => {
    const handler = vi.fn()
    window.addEventListener("popstate", handler)
    pushUrl("/trigger")(() => {})
    window.removeEventListener("popstate", handler)
    expect(handler).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// replaceUrl
// ---------------------------------------------------------------------------

describe("replaceUrl", () => {
  it("changes the URL without adding history", () => {
    replaceUrl("/replaced")(() => {})
    expect(window.location.pathname).toBe("/replaced")
  })
})

// ---------------------------------------------------------------------------
// back / forward
// ---------------------------------------------------------------------------

describe("back / forward", () => {
  it("calls history.go with correct values", () => {
    const goSpy = vi.spyOn(window.history, "go")

    back()(() => {})
    expect(goSpy).toHaveBeenCalledWith(-1)

    back(3)(() => {})
    expect(goSpy).toHaveBeenCalledWith(-3)

    forward()(() => {})
    expect(goSpy).toHaveBeenCalledWith(1)

    forward(2)(() => {})
    expect(goSpy).toHaveBeenCalledWith(2)

    goSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// onUrlChange subscription
// ---------------------------------------------------------------------------

describe("onUrlChange", () => {
  it("has the correct key", () => {
    const sub = onUrlChange("nav", url => url)
    expect(sub.key).toBe("nav")
  })

  it("dispatches on popstate", () => {
    const msgs: UrlLocation[] = []
    const sub = onUrlChange("nav", url => url)
    const td = sub.start(msg => msgs.push(msg))
    teardowns.push(td)

    window.history.replaceState(null, "", "/listened")
    window.dispatchEvent(new PopStateEvent("popstate"))

    expect(msgs.length).toBe(1)
    expect(msgs[0]!.pathname).toBe("/listened")
  })

  it("stops listening on teardown", () => {
    const msgs: UrlLocation[] = []
    const sub = onUrlChange("nav", url => url)
    const td = sub.start(msg => msgs.push(msg))

    td.teardown()
    window.dispatchEvent(new PopStateEvent("popstate"))

    expect(msgs.length).toBe(0)
  })

  it("integrates with pushUrl command", () => {
    const msgs: UrlLocation[] = []
    const sub = onUrlChange("nav", url => url)
    const td = sub.start(msg => msgs.push(msg))
    teardowns.push(td)

    pushUrl("/from-command")(() => {})

    expect(msgs.length).toBe(1)
    expect(msgs[0]!.pathname).toBe("/from-command")
  })
})

// ---------------------------------------------------------------------------
// onHashChange subscription
// ---------------------------------------------------------------------------

describe("onHashChange", () => {
  it("has the correct key", () => {
    const sub = onHashChange("hash", h => h)
    expect(sub.key).toBe("hash")
  })

  it("dispatches on hashchange event", () => {
    const msgs: string[] = []
    const sub = onHashChange("hash", h => h)
    const td = sub.start(msg => msgs.push(msg))
    teardowns.push(td)

    // Simulate hashchange
    window.dispatchEvent(new HashChangeEvent("hashchange"))

    expect(msgs.length).toBe(1)
    expect(typeof msgs[0]).toBe("string")
  })

  it("stops listening on teardown", () => {
    const msgs: string[] = []
    const sub = onHashChange("hash", h => h)
    const td = sub.start(msg => msgs.push(msg))

    td.teardown()
    window.dispatchEvent(new HashChangeEvent("hashchange"))

    expect(msgs.length).toBe(0)
  })
})
