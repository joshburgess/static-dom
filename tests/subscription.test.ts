import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { interval, onDocument, noneSub, batchSub, diffSubs } from "../src/subscription"
import { programWithSub, elmProgram, noCmd } from "../src/program"
import { text, staticText, element } from "../src/constructors"
import type { Teardown } from "../src/types"
import type { Sub } from "../src/subscription"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(() => {
  vi.useRealTimers()
  container?.remove()
})

// ---------------------------------------------------------------------------
// Sub constructors
// ---------------------------------------------------------------------------

describe("interval", () => {
  it("dispatches a static message on interval", () => {
    const msgs: string[] = []
    const sub = interval<string>("tick", 100, "tick")
    const td = sub.start(msg => msgs.push(msg))

    vi.advanceTimersByTime(350)
    expect(msgs).toEqual(["tick", "tick", "tick"])

    td.teardown()
    vi.advanceTimersByTime(200)
    expect(msgs.length).toBe(3) // no more after teardown
  })

  it("dispatches a computed message with timestamp", () => {
    const msgs: number[] = []
    const sub = interval<number>("time", 50, t => t)
    const td = sub.start(msg => msgs.push(msg))

    vi.advanceTimersByTime(100)
    expect(msgs.length).toBe(2)
    expect(typeof msgs[0]).toBe("number")

    td.teardown()
  })
})

describe("onDocument", () => {
  it("listens and dispatches on document events", () => {
    const msgs: string[] = []
    const sub = onDocument<string, "click">("doc-click", "click", () => "clicked")
    const td = sub.start(msg => msgs.push(msg))

    document.dispatchEvent(new Event("click"))
    expect(msgs).toEqual(["clicked"])

    td.teardown()
    document.dispatchEvent(new Event("click"))
    expect(msgs.length).toBe(1) // no more after teardown
  })

  it("suppresses dispatch when handler returns null", () => {
    const msgs: string[] = []
    const sub = onDocument<string, "click">("doc-click", "click", () => null)
    const td = sub.start(msg => msgs.push(msg))

    document.dispatchEvent(new Event("click"))
    expect(msgs.length).toBe(0)

    td.teardown()
  })
})

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

describe("noneSub / batchSub", () => {
  it("noneSub returns empty array", () => {
    expect(noneSub()).toEqual([])
  })

  it("batchSub flattens groups", () => {
    const a = interval("a", 100, "a")
    const b = interval("b", 200, "b")
    const c = interval("c", 300, "c")
    const result = batchSub([a], [b, c])
    expect(result.map(s => s.key)).toEqual(["a", "b", "c"])
  })
})

// ---------------------------------------------------------------------------
// diffSubs
// ---------------------------------------------------------------------------

describe("diffSubs", () => {
  it("starts new subs and stops removed subs", () => {
    const started: string[] = []
    const stopped: string[] = []
    const active = new Map<string, Teardown>()

    const makeSub = (key: string): Sub<string> => ({
      key,
      start() {
        started.push(key)
        return { teardown: () => stopped.push(key) }
      },
    })

    // Start a and b
    diffSubs(active, [makeSub("a"), makeSub("b")], () => {})
    expect(started).toEqual(["a", "b"])
    expect(active.size).toBe(2)

    // Replace b with c — b stops, c starts
    diffSubs(active, [makeSub("a"), makeSub("c")], () => {})
    expect(stopped).toEqual(["b"])
    expect(started).toEqual(["a", "b", "c"])
    expect(active.size).toBe(2)
    expect(active.has("a")).toBe(true)
    expect(active.has("c")).toBe(true)
  })

  it("does not restart existing subs", () => {
    let startCount = 0
    const active = new Map<string, Teardown>()

    const sub: Sub<string> = {
      key: "x",
      start() {
        startCount++
        return { teardown() {} }
      },
    }

    diffSubs(active, [sub], () => {})
    diffSubs(active, [sub], () => {})
    diffSubs(active, [sub], () => {})
    expect(startCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// programWithSub
// ---------------------------------------------------------------------------

describe("programWithSub", () => {
  it("starts initial subscriptions and updates on dispatch", () => {
    const ticks: number[] = []

    type Model = { count: number }
    type Msg = { type: "tick" } | { type: "inc" }

    const view = element<"div", Model, Msg>("div", {}, [
      text(m => String(m.count)),
    ])

    const handle = programWithSub<Model, Msg>({
      container,
      init: { count: 0 },
      update(msg, model) {
        if (msg.type === "inc") return { count: model.count + 1 }
        if (msg.type === "tick") {
          ticks.push(model.count)
          return model
        }
        return model
      },
      view,
      subscriptions() {
        return [interval("tick", 100, { type: "tick" as const })]
      },
    })

    // Tick fires
    vi.advanceTimersByTime(100)
    expect(ticks.length).toBe(1)

    handle.dispatch({ type: "inc" })
    expect(handle.getModel().count).toBe(1)

    handle.teardown()

    // No more ticks after teardown
    vi.advanceTimersByTime(500)
    expect(ticks.length).toBe(1)
  })

  it("diffs subscriptions when model changes", () => {
    const started: string[] = []
    const stopped: string[] = []

    type Model = { running: boolean }
    type Msg = { type: "toggle" }

    const view = element<"div", Model, Msg>("div", {}, [])

    const handle = programWithSub<Model, Msg>({
      container,
      init: { running: false },
      update(_, model) {
        return { running: !model.running }
      },
      view,
      subscriptions(model) {
        if (model.running) {
          return [{
            key: "timer",
            start() {
              started.push("timer")
              return { teardown: () => stopped.push("timer") }
            },
          }]
        }
        return []
      },
    })

    expect(started.length).toBe(0) // not running initially

    handle.dispatch({ type: "toggle" }) // running = true
    expect(started).toEqual(["timer"])

    handle.dispatch({ type: "toggle" }) // running = false
    expect(stopped).toEqual(["timer"])

    handle.teardown()
  })
})

// ---------------------------------------------------------------------------
// elmProgram
// ---------------------------------------------------------------------------

describe("elmProgram", () => {
  it("runs init command and subscriptions", () => {
    const log: string[] = []

    type Msg = "init-done" | "tick"

    const view = element<"div", { n: number }, Msg>("div", {}, [
      text(m => String(m.n)),
    ])

    const handle = elmProgram<{ n: number }, Msg>({
      container,
      init: [{ n: 0 }, (dispatch) => dispatch("init-done")],
      update(msg, model) {
        log.push(msg)
        return [{ n: model.n + 1 }, noCmd()]
      },
      view,
      subscriptions(model) {
        return model.n < 2
          ? [interval("tick", 50, "tick" as const)]
          : []
      },
    })

    expect(log).toContain("init-done")
    expect(handle.getModel().n).toBe(1)

    vi.advanceTimersByTime(50)
    expect(log).toContain("tick")

    handle.teardown()
  })
})
