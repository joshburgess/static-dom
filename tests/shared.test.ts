import { describe, it, expect } from "vitest"
import {
  IDL_PROPS,
  EVENT_RE,
  camelToKebab,
  STATIC_VALUE,
  isStaticFn,
  staticValueOf,
  ensureFn,
  isSDOMNode,
  classifyProps,
  normalizeChild,
  normalizeChildren,
  _TEMPLATE_SPEC,
  tryBuildChildSpecs,
  tryBuildChildSpec,
} from "../src/shared"
import { text, staticText, element } from "../src/constructors"

// ---------------------------------------------------------------------------
// IDL_PROPS
// ---------------------------------------------------------------------------

describe("IDL_PROPS", () => {
  it("contains common form IDL properties", () => {
    expect(IDL_PROPS.has("value")).toBe(true)
    expect(IDL_PROPS.has("checked")).toBe(true)
    expect(IDL_PROPS.has("disabled")).toBe(true)
    expect(IDL_PROPS.has("readOnly")).toBe(true)
  })

  it("contains media properties", () => {
    expect(IDL_PROPS.has("controls")).toBe(true)
    expect(IDL_PROPS.has("muted")).toBe(true)
    expect(IDL_PROPS.has("volume")).toBe(true)
  })

  it("does not contain non-IDL attributes", () => {
    expect(IDL_PROPS.has("class")).toBe(false)
    expect(IDL_PROPS.has("style")).toBe(false)
    expect(IDL_PROPS.has("onClick")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// EVENT_RE
// ---------------------------------------------------------------------------

describe("EVENT_RE", () => {
  it("matches onX patterns", () => {
    expect(EVENT_RE.test("onClick")).toBe(true)
    expect(EVENT_RE.test("onInput")).toBe(true)
    expect(EVENT_RE.test("onMouseDown")).toBe(true)
  })

  it("does not match non-event patterns", () => {
    expect(EVENT_RE.test("onclick")).toBe(false)
    expect(EVENT_RE.test("on")).toBe(false)
    expect(EVENT_RE.test("only")).toBe(false)
    expect(EVENT_RE.test("class")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// camelToKebab
// ---------------------------------------------------------------------------

describe("camelToKebab", () => {
  it("converts camelCase to kebab-case", () => {
    expect(camelToKebab("backgroundColor")).toBe("background-color")
    expect(camelToKebab("fontSize")).toBe("font-size")
    expect(camelToKebab("borderTopWidth")).toBe("border-top-width")
  })

  it("leaves lowercase strings unchanged", () => {
    expect(camelToKebab("color")).toBe("color")
    expect(camelToKebab("display")).toBe("display")
  })
})

// ---------------------------------------------------------------------------
// ensureFn / isStaticFn / staticValueOf
// ---------------------------------------------------------------------------

describe("ensureFn", () => {
  it("wraps a static value in a constant function", () => {
    const fn = ensureFn("hello")
    expect(fn()).toBe("hello")
    expect(fn("ignored")).toBe("hello")
  })

  it("returns an existing function as-is", () => {
    const original = (x: unknown) => String(x)
    const result = ensureFn(original)
    expect(result).toBe(original)
  })

  it("brands static-wrapped functions with STATIC_VALUE", () => {
    const fn = ensureFn(42)
    expect(isStaticFn(fn)).toBe(true)
    expect(staticValueOf(fn)).toBe(42)
  })

  it("existing functions are not branded", () => {
    const fn = ensureFn(() => "hi")
    expect(isStaticFn(fn)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isSDOMNode
// ---------------------------------------------------------------------------

describe("isSDOMNode", () => {
  it("returns true for objects with an attach method", () => {
    const node = { attach() {} }
    expect(isSDOMNode(node)).toBe(true)
  })

  it("returns false for non-objects", () => {
    expect(isSDOMNode(null)).toBe(false)
    expect(isSDOMNode(undefined)).toBe(false)
    expect(isSDOMNode("string")).toBe(false)
    expect(isSDOMNode(42)).toBe(false)
  })

  it("returns false for objects without attach", () => {
    expect(isSDOMNode({})).toBe(false)
    expect(isSDOMNode({ update() {} })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// classifyProps
// ---------------------------------------------------------------------------

describe("classifyProps", () => {
  it("classifies IDL props into attrs", () => {
    const fn = () => "text"
    const result = classifyProps({ value: fn })
    expect(result.attrs).toBeDefined()
    expect((result.attrs as Record<string, unknown>).value).toBeDefined()
  })

  it("classifies onX props into on with lowercased event name", () => {
    const handler = () => null
    const result = classifyProps({ onClick: handler })
    expect(result.on).toBeDefined()
    expect((result.on as Record<string, unknown>).click).toBe(handler)
  })

  it("classifies class prop into rawAttrs", () => {
    const result = classifyProps({ class: "foo" })
    expect(result.rawAttrs).toBeDefined()
    expect((result.rawAttrs as Record<string, unknown>).class).toBeDefined()
  })

  it("classifies className as class in rawAttrs", () => {
    const result = classifyProps({ className: "bar" })
    expect(result.rawAttrs).toBeDefined()
    expect((result.rawAttrs as Record<string, unknown>).class).toBeDefined()
  })

  it("classifies style object with kebab-cased keys", () => {
    const fn = () => "red"
    const result = classifyProps({ style: { backgroundColor: fn } })
    expect(result.style).toBeDefined()
    expect((result.style as Record<string, unknown>)["background-color"]).toBeDefined()
  })

  it("classifies classes prop", () => {
    const fn = () => ({ active: true })
    const result = classifyProps({ classes: fn })
    expect(result.classes).toBe(fn)
  })

  it("classifies data-* and aria-* as rawAttrs", () => {
    const result = classifyProps({ "data-id": "123", "aria-label": "test" })
    const raw = result.rawAttrs as Record<string, unknown>
    expect(raw["data-id"]).toBeDefined()
    expect(raw["aria-label"]).toBeDefined()
  })

  it("skips children and key", () => {
    const result = classifyProps({ children: ["a"], key: "k", value: () => "" })
    expect(result.attrs).toBeDefined()
    expect((result as Record<string, unknown>).children).toBeUndefined()
    expect((result as Record<string, unknown>).key).toBeUndefined()
  })

  it("wraps static values via ensureFn", () => {
    const result = classifyProps({ class: "static-class" })
    const fn = (result.rawAttrs as Record<string, Function>).class
    expect(typeof fn).toBe("function")
    expect(fn()).toBe("static-class")
  })

  it("returns empty object when no props", () => {
    const result = classifyProps({})
    expect(Object.keys(result).length).toBe(0)
  })

  it("classifies unknown attributes as rawAttrs", () => {
    const result = classifyProps({ "my-custom": () => "val" })
    expect(result.rawAttrs).toBeDefined()
    expect((result.rawAttrs as Record<string, unknown>)["my-custom"]).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// normalizeChild / normalizeChildren
// ---------------------------------------------------------------------------

describe("normalizeChild", () => {
  it("returns null for null, undefined, and booleans", () => {
    expect(normalizeChild(null)).toBeNull()
    expect(normalizeChild(undefined)).toBeNull()
    expect(normalizeChild(true)).toBeNull()
    expect(normalizeChild(false)).toBeNull()
  })

  it("returns SDOM nodes as-is", () => {
    const node = staticText("hi")
    const result = normalizeChild(node)
    expect(result).toBe(node)
  })

  it("wraps functions as text nodes", () => {
    const fn = (m: unknown) => String(m)
    const result = normalizeChild(fn)
    expect(result).not.toBeNull()
    expect(typeof result!.attach).toBe("function")
  })

  it("wraps strings as static text", () => {
    const result = normalizeChild("hello")
    expect(result).not.toBeNull()
    expect(typeof result!.attach).toBe("function")
  })

  it("wraps numbers as static text", () => {
    const result = normalizeChild(42)
    expect(result).not.toBeNull()
    expect(typeof result!.attach).toBe("function")
  })
})

describe("normalizeChildren", () => {
  it("returns empty array for null/undefined", () => {
    expect(normalizeChildren(null)).toEqual([])
    expect(normalizeChildren(undefined)).toEqual([])
  })

  it("wraps a single child in an array", () => {
    const result = normalizeChildren("hello")
    expect(result.length).toBe(1)
  })

  it("normalizes array children and filters out nulls", () => {
    const result = normalizeChildren(["hello", null, 42, true, "world"])
    // "hello", 42, "world" — null and true are filtered
    expect(result.length).toBe(3)
  })

  it("returns SDOM nodes from arrays", () => {
    const node = staticText("test")
    const result = normalizeChildren([node, "text"])
    expect(result.length).toBe(2)
    expect(result[0]).toBe(node)
  })
})

// ---------------------------------------------------------------------------
// tryBuildChildSpec / tryBuildChildSpecs
// ---------------------------------------------------------------------------

describe("tryBuildChildSpec", () => {
  it("returns false for null/undefined/boolean (skippable)", () => {
    expect(tryBuildChildSpec(null)).toBe(false)
    expect(tryBuildChildSpec(undefined)).toBe(false)
    expect(tryBuildChildSpec(true)).toBe(false)
    expect(tryBuildChildSpec(false)).toBe(false)
  })

  it("returns static spec for strings", () => {
    const spec = tryBuildChildSpec("hello")
    expect(spec).toEqual({ kind: "static", text: "hello" })
  })

  it("returns static spec for numbers", () => {
    const spec = tryBuildChildSpec(42)
    expect(spec).toEqual({ kind: "static", text: "42" })
  })

  it("returns dynamic spec for functions", () => {
    const fn = (m: unknown) => String(m)
    const spec = tryBuildChildSpec(fn)
    expect(spec).not.toBeNull()
    expect(spec).not.toBe(false)
    if (spec && spec !== false) {
      expect(spec.kind).toBe("dynamic")
    }
  })

  it("returns element spec for SDOM nodes with template spec", () => {
    // Simulate a compiled SDOM node with _TEMPLATE_SPEC
    const fakeSpec = { tag: "div", classified: {}, children: [] }
    const fakeSdom = {
      attach() { return { teardown() {} } },
      [_TEMPLATE_SPEC]: fakeSpec,
    }
    const spec = tryBuildChildSpec(fakeSdom)
    expect(spec).not.toBeNull()
    expect(spec).not.toBe(false)
    if (spec && spec !== false) {
      expect(spec.kind).toBe("element")
      expect((spec as { kind: "element"; spec: unknown }).spec).toBe(fakeSpec)
    }
  })

  it("returns null for opaque SDOM nodes without template spec", () => {
    const node = staticText("hi")
    const spec = tryBuildChildSpec(node)
    expect(spec).toBeNull()
  })
})

describe("tryBuildChildSpecs", () => {
  it("returns empty array for null/undefined", () => {
    expect(tryBuildChildSpecs(null)).toEqual([])
    expect(tryBuildChildSpecs(undefined)).toEqual([])
  })

  it("returns specs for compilable array children", () => {
    const specs = tryBuildChildSpecs(["hello", 42])
    expect(specs).not.toBeNull()
    expect(specs!.length).toBe(2)
    expect(specs![0]).toEqual({ kind: "static", text: "hello" })
    expect(specs![1]).toEqual({ kind: "static", text: "42" })
  })

  it("skips null/undefined/boolean children in arrays", () => {
    const specs = tryBuildChildSpecs(["a", null, true, "b"])
    expect(specs).not.toBeNull()
    expect(specs!.length).toBe(2)
  })

  it("returns null if any child is not compilable", () => {
    const opaqueNode = staticText("opaque")
    const specs = tryBuildChildSpecs(["hello", opaqueNode])
    expect(specs).toBeNull()
  })

  it("handles a single compilable child (not array)", () => {
    const specs = tryBuildChildSpecs("hello")
    expect(specs).toEqual([{ kind: "static", text: "hello" }])
  })

  it("returns null for a single non-compilable child", () => {
    const node = staticText("opaque")
    const specs = tryBuildChildSpecs(node)
    expect(specs).toBeNull()
  })
})
