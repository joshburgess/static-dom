import { describe, it, expect, vi } from "vitest"
import { createInPort, createOutPort, portSub, portCmd } from "../src/ports"
import type { Teardown } from "../src/types"

// ---------------------------------------------------------------------------
// InPort
// ---------------------------------------------------------------------------

describe("createInPort", () => {
  it("creates a port with the given name", () => {
    const port = createInPort("test", (v: string) => v)
    expect(port.name).toBe("test")
  })

  it("dispatches toMsg when send is called", () => {
    type Msg = { type: "received"; value: number }
    const port = createInPort<number, Msg>("nums", v => ({ type: "received", value: v }))

    const msgs: Msg[] = []
    const unsub = port._listen(v => msgs.push(port._toMsg(v)))

    port.send(42)
    port.send(99)

    expect(msgs).toEqual([
      { type: "received", value: 42 },
      { type: "received", value: 99 },
    ])

    unsub()
  })

  it("supports multiple listeners", () => {
    const port = createInPort<string, string>("multi", v => v)
    const a: string[] = []
    const b: string[] = []

    const unsubA = port._listen(v => a.push(v))
    const unsubB = port._listen(v => b.push(v))

    port.send("hello")
    expect(a).toEqual(["hello"])
    expect(b).toEqual(["hello"])

    unsubA()
    port.send("world")
    expect(a).toEqual(["hello"]) // unsubscribed
    expect(b).toEqual(["hello", "world"])

    unsubB()
  })

  it("does nothing when no listeners", () => {
    const port = createInPort<number, number>("empty", v => v)
    // Should not throw
    port.send(1)
  })
})

// ---------------------------------------------------------------------------
// OutPort
// ---------------------------------------------------------------------------

describe("createOutPort", () => {
  it("creates a port with the given name", () => {
    const port = createOutPort<string>("out")
    expect(port.name).toBe("out")
  })

  it("delivers values to listeners", () => {
    const port = createOutPort<{ event: string }>( "analytics")
    const received: { event: string }[] = []

    const unsub = port.listen(v => received.push(v))
    port._send({ event: "click" })
    port._send({ event: "scroll" })

    expect(received).toEqual([
      { event: "click" },
      { event: "scroll" },
    ])

    unsub()
  })

  it("supports multiple listeners", () => {
    const port = createOutPort<number>("multi-out")
    const a: number[] = []
    const b: number[] = []

    const unsubA = port.listen(v => a.push(v))
    const unsubB = port.listen(v => b.push(v))

    port._send(1)
    expect(a).toEqual([1])
    expect(b).toEqual([1])

    unsubA()
    port._send(2)
    expect(a).toEqual([1])
    expect(b).toEqual([1, 2])

    unsubB()
  })
})

// ---------------------------------------------------------------------------
// portSub
// ---------------------------------------------------------------------------

describe("portSub", () => {
  it("creates a Sub with port: prefix key", () => {
    const port = createInPort<string, string>("notif", v => v)
    const sub = portSub(port)
    expect(sub.key).toBe("port:notif")
  })

  it("dispatches transformed messages when port.send is called", () => {
    type Msg = { type: "msg"; data: number }
    const port = createInPort<number, Msg>("data", v => ({ type: "msg", data: v }))
    const sub = portSub(port)

    const msgs: Msg[] = []
    const td = sub.start(msg => msgs.push(msg))

    port.send(10)
    port.send(20)

    expect(msgs).toEqual([
      { type: "msg", data: 10 },
      { type: "msg", data: 20 },
    ])

    td.teardown()
  })

  it("stops dispatching after teardown", () => {
    const port = createInPort<string, string>("stop", v => v)
    const sub = portSub(port)

    const msgs: string[] = []
    const td = sub.start(msg => msgs.push(msg))

    port.send("before")
    td.teardown()
    port.send("after")

    expect(msgs).toEqual(["before"])
  })
})

// ---------------------------------------------------------------------------
// portCmd
// ---------------------------------------------------------------------------

describe("portCmd", () => {
  it("sends value through outgoing port", () => {
    const port = createOutPort<{ action: string }>("actions")
    const received: { action: string }[] = []
    port.listen(v => received.push(v))

    const cmd = portCmd(port, { action: "save" })
    // Cmd takes a dispatch function — portCmd ignores it
    cmd(() => {})

    expect(received).toEqual([{ action: "save" }])
  })

  it("delivers to all listeners", () => {
    const port = createOutPort<number>("broadcast")
    const a: number[] = []
    const b: number[] = []

    port.listen(v => a.push(v))
    port.listen(v => b.push(v))

    portCmd(port, 42)(() => {})

    expect(a).toEqual([42])
    expect(b).toEqual([42])
  })
})

// ---------------------------------------------------------------------------
// Integration: InPort + OutPort round-trip
// ---------------------------------------------------------------------------

describe("ports integration", () => {
  it("supports a round-trip: out → external → in → dispatch", () => {
    type InMsg = { type: "response"; data: string }

    const outPort = createOutPort<{ query: string }>("request")
    const inPort = createInPort<string, InMsg>("response", data => ({
      type: "response",
      data,
    }))

    // Simulate external system: when outPort sends, reply to inPort
    outPort.listen(({ query }) => {
      inPort.send(`result for: ${query}`)
    })

    // Wire up the subscription side
    const msgs: InMsg[] = []
    const sub = portSub(inPort)
    const td = sub.start(msg => msgs.push(msg))

    // Send a command
    portCmd(outPort, { query: "test" })(() => {})

    expect(msgs).toEqual([{ type: "response", data: "result for: test" }])

    td.teardown()
  })
})
