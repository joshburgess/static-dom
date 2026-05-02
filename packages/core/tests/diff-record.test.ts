import { describe, it, expect } from "vitest"
import { diffRecord, autoDelta, fields, replace, fieldDelta } from "../src/patch"
import type { RecordDelta } from "../src/patch"

// ---------------------------------------------------------------------------
// diffRecord
// ---------------------------------------------------------------------------

describe("diffRecord", () => {
  it("returns noop when prev === next", () => {
    const model = { name: "Alice", count: 0 }
    expect(diffRecord(model, model)).toEqual({ kind: "noop" })
  })

  it("detects changed fields by reference equality", () => {
    const prev = { name: "Alice", count: 0, items: [1, 2] }
    const next = { name: "Alice", count: 1, items: [1, 2] }
    const delta = diffRecord(prev, next)

    expect(delta.kind).toBe("fields")
    if (delta.kind === "fields") {
      expect(delta.fields.count).toEqual({ kind: "replace", value: 1 })
      expect(delta.fields.name).toBeUndefined() // unchanged
      // items is a different array reference
      expect(delta.fields.items).toEqual({ kind: "replace", value: [1, 2] })
    }
  })

  it("returns noop when all fields are reference-equal", () => {
    const items = [1, 2, 3]
    const prev = { name: "Alice", items }
    const next = { name: "Alice", items } // same reference
    expect(diffRecord(prev, next)).toEqual({ kind: "noop" })
  })

  it("detects multiple changed fields", () => {
    const prev = { a: 1, b: "x", c: true }
    const next = { a: 2, b: "y", c: true }
    const delta = diffRecord(prev, next)

    expect(delta.kind).toBe("fields")
    if (delta.kind === "fields") {
      expect(delta.fields.a).toEqual({ kind: "replace", value: 2 })
      expect(delta.fields.b).toEqual({ kind: "replace", value: "y" })
      expect(delta.fields.c).toBeUndefined()
    }
  })

  it("composes with fieldDelta for sub-field extraction", () => {
    const prev = { user: { name: "Alice" }, count: 0 }
    const next = { user: { name: "Bob" }, count: 0 }
    const delta = diffRecord(prev, next) as RecordDelta<typeof prev>

    const userDelta = fieldDelta(delta, "user")
    expect(userDelta).toEqual({ kind: "replace", value: { name: "Bob" } })

    const countDelta = fieldDelta(delta, "count")
    expect(countDelta).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// autoDelta
// ---------------------------------------------------------------------------

describe("autoDelta", () => {
  it("wraps a plain update function to produce deltas", () => {
    type Model = { name: string; count: number }
    type Msg = { type: "inc" } | { type: "setName"; name: string }

    function update(msg: Msg, model: Model): Model {
      switch (msg.type) {
        case "inc":
          return { ...model, count: model.count + 1 }
        case "setName":
          return { ...model, name: msg.name }
      }
    }

    const deltaUpdate = autoDelta(update)

    const model: Model = { name: "Alice", count: 0 }

    const [next1, delta1] = deltaUpdate({ type: "inc" }, model)
    expect(next1).toEqual({ name: "Alice", count: 1 })
    expect(delta1.kind).toBe("fields")
    if (delta1.kind === "fields") {
      expect(delta1.fields.count).toEqual({ kind: "replace", value: 1 })
      expect(delta1.fields.name).toBeUndefined()
    }

    const [next2, delta2] = deltaUpdate({ type: "setName", name: "Bob" }, model)
    expect(next2).toEqual({ name: "Bob", count: 0 })
    expect(delta2.kind).toBe("fields")
    if (delta2.kind === "fields") {
      expect(delta2.fields.name).toEqual({ kind: "replace", value: "Bob" })
      expect(delta2.fields.count).toBeUndefined()
    }
  })

  it("returns noop when update returns same reference", () => {
    const update = (_msg: string, model: { x: number }) => model
    const deltaUpdate = autoDelta(update)

    const model = { x: 1 }
    const [next, delta] = deltaUpdate("noop", model)
    expect(next).toBe(model)
    expect(delta).toEqual({ kind: "noop" })
  })
})
