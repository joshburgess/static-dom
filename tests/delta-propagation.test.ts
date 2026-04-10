import { describe, it, expect } from "vitest"
import { text } from "../src/constructors"
import { prop } from "../src/optics"
import { programWithDelta } from "../src/program"
import { replace, fields, produce } from "../src/patch"

// ─────────────────────────────────────────────────────────────────────
// Delta propagation through focus
// ─────────────────────────────────────────────────────────────────────

describe("focus + delta propagation", () => {
  interface Model { count: number; name: string }

  it("skips inner update when delta says field is unchanged", () => {
    const div = document.createElement("div")
    const view = text<number, never>((n) => String(n)).focus(prop<Model>()("count"))
    const handle = programWithDelta<Model, { field: "count" | "name"; value: number | string }>({
      container: div,
      init: { count: 0, name: "initial" },
      update: (msg, model) => {
        const [next, delta] = produce(model, draft => {
          (draft as any)[msg.field] = msg.value
        })
        return [next, delta]
      },
      view,
    })

    // Initial: text is "0"
    expect(div.textContent).toBe("0")

    // Update name only — count should NOT update
    handle.dispatch({ field: "name", value: "changed" })
    expect(div.textContent).toBe("0")
    expect(handle.getModel().name).toBe("changed")

    // Update count — text should update
    handle.dispatch({ field: "count", value: 42 })
    expect(div.textContent).toBe("42")

    handle.teardown()
  })

  it("propagates sub-delta to nested focus", () => {
    interface Outer { inner: { count: number; label: string } }
    const innerLens = prop<Outer>()("inner")
    const countLens = prop<{ count: number; label: string }>()("count")

    const view = text<number, never>((n) => String(n))
      .focus(countLens)
      .focus(innerLens)

    const div = document.createElement("div")
    type Msg = { path: "count" | "label"; value: number | string }
    const handle = programWithDelta<Outer, Msg>({
      container: div,
      init: { inner: { count: 0, label: "hi" } },
      update: (msg, model) => {
        const [nextInner, innerDelta] = produce(model.inner, draft => {
          (draft as any)[msg.path] = msg.value
        })
        return [
          { inner: nextInner },
          fields<Outer>({ inner: replace(nextInner) }),
        ]
      },
      view,
    })

    expect(div.textContent).toBe("0")

    // Update label — count text should not change (delta propagation through two lenses)
    // Note: the outer delta says `inner` changed (replace), so the inner lens
    // WILL see its field as changed. But the count subfield didn't change.
    // Since we used `replace` on inner, the inner-level prop lens sees a full replace
    // and will propagate. This tests that the mechanism works, not that it skips.
    handle.dispatch({ path: "label", value: "changed" })
    // count didn't change, but inner was replaced so focus falls through to ref-eq check
    expect(div.textContent).toBe("0")

    handle.dispatch({ path: "count", value: 7 })
    expect(div.textContent).toBe("7")

    handle.teardown()
  })
})

// ─────────────────────────────────────────────────────────────────────
// programWithDelta
// ─────────────────────────────────────────────────────────────────────

describe("programWithDelta", () => {
  interface Model { count: number }
  type Msg = "inc" | "dec"

  it("mounts, updates, and tears down", () => {
    const div = document.createElement("div")
    const view = text<Model, Msg>((m) => String(m.count))

    const handle = programWithDelta({
      container: div,
      init: { count: 0 },
      update: (msg, model) => {
        const next = msg === "inc"
          ? { count: model.count + 1 }
          : { count: model.count - 1 }
        return [next, fields<Model>({ count: replace(next.count) })]
      },
      view,
    })

    expect(div.textContent).toBe("0")

    handle.dispatch("inc")
    expect(handle.getModel().count).toBe(1)
    expect(div.textContent).toBe("1")

    handle.dispatch("inc")
    handle.dispatch("inc")
    expect(handle.getModel().count).toBe(3)
    expect(div.textContent).toBe("3")

    handle.dispatch("dec")
    expect(handle.getModel().count).toBe(2)
    expect(div.textContent).toBe("2")

    handle.teardown()
  })

  it("calls onUpdate with delta", () => {
    const div = document.createElement("div")
    const view = text<Model, Msg>((m) => String(m.count))
    const updates: Array<{ msg: Msg; delta: unknown }> = []

    const handle = programWithDelta({
      container: div,
      init: { count: 0 },
      update: (msg, model) => {
        const next = { count: model.count + 1 }
        const delta = fields<Model>({ count: replace(next.count) })
        return [next, delta]
      },
      view,
      onUpdate: (msg, _prev, _next, delta) => {
        updates.push({ msg, delta })
      },
    })

    handle.dispatch("inc")
    expect(updates).toHaveLength(1)
    expect(updates[0]!.msg).toBe("inc")
    expect(updates[0]!.delta).toEqual(fields<Model>({ count: replace(1) }))

    handle.teardown()
  })

  it("works with undefined delta (fallback to ref equality)", () => {
    const div = document.createElement("div")
    const view = text<Model, Msg>((m) => String(m.count))

    const handle = programWithDelta({
      container: div,
      init: { count: 0 },
      update: (msg, model) => {
        const next = msg === "inc"
          ? { count: model.count + 1 }
          : { count: model.count - 1 }
        return [next, undefined] // no delta
      },
      view,
    })

    expect(div.textContent).toBe("0")
    handle.dispatch("inc")
    expect(div.textContent).toBe("1")

    handle.teardown()
  })

  it("works with produce helper", () => {
    interface BigModel { count: number; name: string; active: boolean }
    type BigMsg = { type: "inc" } | { type: "setName"; name: string }

    const div = document.createElement("div")
    const view = text<BigModel, BigMsg>((m) => `${m.name}:${m.count}`)

    const handle = programWithDelta({
      container: div,
      init: { count: 0, name: "test", active: true },
      update: (msg, model) => {
        return produce(model, draft => {
          switch (msg.type) {
            case "inc":
              draft.count = model.count + 1
              break
            case "setName":
              draft.name = msg.name
              break
          }
        })
      },
      view,
    })

    expect(div.textContent).toBe("test:0")

    handle.dispatch({ type: "inc" })
    expect(div.textContent).toBe("test:1")

    handle.dispatch({ type: "setName", name: "updated" })
    expect(div.textContent).toBe("updated:1")

    handle.teardown()
  })
})
