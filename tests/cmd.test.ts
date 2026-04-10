import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mapCmd, httpRequest, httpGetJson, httpPostJson, randomInt, randomFloat, delay, nextTick } from "../src/cmd"
import { noCmd, batchCmd } from "../src/program"
import type { Cmd } from "../src/program"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectMessages<Msg>(cmd: Cmd<Msg>): Msg[] {
  const msgs: Msg[] = []
  cmd(msg => msgs.push(msg))
  return msgs
}

async function collectMessagesAsync<Msg>(cmd: Cmd<Msg>): Promise<Msg[]> {
  const msgs: Msg[] = []
  cmd(msg => msgs.push(msg))
  // Wait for microtask queue + any timers
  await vi.runAllTimersAsync()
  return msgs
}

// ---------------------------------------------------------------------------
// mapCmd
// ---------------------------------------------------------------------------

describe("mapCmd", () => {
  it("transforms messages from a command", () => {
    const inner: Cmd<number> = dispatch => { dispatch(42) }
    const mapped = mapCmd(inner, n => `number:${n}`)
    const msgs = collectMessages(mapped)
    expect(msgs).toEqual(["number:42"])
  })

  it("transforms multiple messages", () => {
    const inner: Cmd<number> = dispatch => { dispatch(1); dispatch(2); dispatch(3) }
    const mapped = mapCmd(inner, n => n * 10)
    const msgs = collectMessages(mapped)
    expect(msgs).toEqual([10, 20, 30])
  })
})

// ---------------------------------------------------------------------------
// randomInt
// ---------------------------------------------------------------------------

describe("randomInt", () => {
  it("dispatches an integer in [min, max]", () => {
    const msgs = collectMessages(randomInt(1, 6, n => n))
    expect(msgs.length).toBe(1)
    expect(msgs[0]).toBeGreaterThanOrEqual(1)
    expect(msgs[0]).toBeLessThanOrEqual(6)
    expect(Number.isInteger(msgs[0])).toBe(true)
  })

  it("transforms the value with toMsg", () => {
    const msgs = collectMessages(randomInt(0, 100, n => ({ type: "rolled" as const, n })))
    expect(msgs.length).toBe(1)
    expect(msgs[0]!.type).toBe("rolled")
    expect(typeof msgs[0]!.n).toBe("number")
  })
})

// ---------------------------------------------------------------------------
// randomFloat
// ---------------------------------------------------------------------------

describe("randomFloat", () => {
  it("dispatches a float in [0, 1)", () => {
    const msgs = collectMessages(randomFloat(n => n))
    expect(msgs.length).toBe(1)
    expect(msgs[0]).toBeGreaterThanOrEqual(0)
    expect(msgs[0]).toBeLessThan(1)
  })
})

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

describe("delay", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("dispatches after specified ms", async () => {
    const msgs: string[] = []
    delay(500, "timeout")(msg => msgs.push(msg))

    expect(msgs).toEqual([])
    await vi.advanceTimersByTimeAsync(499)
    expect(msgs).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(msgs).toEqual(["timeout"])
  })
})

// ---------------------------------------------------------------------------
// nextTick
// ---------------------------------------------------------------------------

describe("nextTick", () => {
  it("dispatches on next microtask", async () => {
    const msgs: string[] = []
    nextTick("done")(msg => msgs.push(msg))

    expect(msgs).toEqual([])
    await Promise.resolve()
    // Microtask should have run
    await new Promise(r => setTimeout(r, 0))
    expect(msgs).toEqual(["done"])
  })
})

// ---------------------------------------------------------------------------
// httpRequest / httpGetJson / httpPostJson
// ---------------------------------------------------------------------------

describe("httpRequest", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("calls fetch with correct options", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    globalThis.fetch = fetchSpy

    const msgs: unknown[] = []
    httpRequest({
      url: "/api/test",
      method: "POST",
      headers: { "X-Custom": "value" },
      body: "payload",
      expect: async r => ({ status: r.status, data: await r.json() }),
      onError: err => ({ error: err.message }),
    })(msg => msgs.push(msg))

    await vi.waitFor(() => expect(msgs.length).toBe(1))

    expect(fetchSpy).toHaveBeenCalledWith("/api/test", {
      method: "POST",
      headers: { "X-Custom": "value" },
      body: "payload",
    })
    expect(msgs[0]).toEqual({ status: 200, data: { ok: true } })
  })

  it("calls onError when fetch rejects", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"))

    const msgs: unknown[] = []
    httpRequest({
      url: "/fail",
      expect: async r => r,
      onError: err => ({ error: err.message }),
    })(msg => msgs.push(msg))

    await vi.waitFor(() => expect(msgs.length).toBe(1))
    expect(msgs[0]).toEqual({ error: "network error" })
  })

  it("calls onError when expect throws", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("not json", { status: 200 }),
    )

    const msgs: unknown[] = []
    httpRequest({
      url: "/bad-json",
      expect: async r => JSON.parse(await r.text()),
      onError: err => ({ error: err.message }),
    })(msg => msgs.push(msg))

    await vi.waitFor(() => expect(msgs.length).toBe(1))
    expect((msgs[0] as any).error).toBeDefined()
  })
})

describe("httpGetJson", () => {
  afterEach(() => { vi.restoreAllMocks() })

  it("sends GET and parses JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([1, 2, 3]), { status: 200 }),
    )

    const msgs: unknown[] = []
    httpGetJson(
      "/api/items",
      json => ({ type: "loaded", items: json }),
      err => ({ type: "error", msg: err.message }),
    )(msg => msgs.push(msg))

    await vi.waitFor(() => expect(msgs.length).toBe(1))
    expect(msgs[0]).toEqual({ type: "loaded", items: [1, 2, 3] })
  })
})

describe("httpPostJson", () => {
  afterEach(() => { vi.restoreAllMocks() })

  it("sends POST with JSON body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "abc" }), { status: 201 }),
    )
    globalThis.fetch = fetchSpy

    const msgs: unknown[] = []
    httpPostJson(
      "/api/items",
      { name: "test" },
      json => ({ type: "created", data: json }),
      err => ({ type: "error", msg: err.message }),
    )(msg => msgs.push(msg))

    await vi.waitFor(() => expect(msgs.length).toBe(1))

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe("/api/items")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.body).toBe(JSON.stringify({ name: "test" }))
    expect(msgs[0]).toEqual({ type: "created", data: { id: "abc" } })
  })
})
