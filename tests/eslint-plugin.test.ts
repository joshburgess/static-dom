import { describe, it, expect } from "vitest"
import plugin, { rules, noDynamicChildren } from "../src/eslint-plugin"

// ---------------------------------------------------------------------------
// Helpers — minimal ESLint context mock
// ---------------------------------------------------------------------------

interface ReportCall {
  node: unknown
  messageId: string
}

function createMockContext() {
  const reports: ReportCall[] = []
  return {
    report(descriptor: ReportCall) {
      reports.push(descriptor)
    },
    reports,
  }
}

function makeNode(overrides: Record<string, unknown>) {
  return { type: "Unknown", ...overrides }
}

// ---------------------------------------------------------------------------
// Plugin structure
// ---------------------------------------------------------------------------

describe("eslint plugin", () => {
  it("exports rules object", () => {
    expect(rules).toBeDefined()
    expect(rules["no-dynamic-children"]).toBe(noDynamicChildren)
  })

  it("default export has rules", () => {
    expect(plugin.rules).toBe(rules)
  })

  it("rule has correct meta", () => {
    expect(noDynamicChildren.meta.type).toBe("problem")
    expect(noDynamicChildren.meta.messages.noTernary).toBeDefined()
    expect(noDynamicChildren.meta.messages.noLogicalAnd).toBeDefined()
    expect(noDynamicChildren.meta.messages.noMapWithoutFor).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Rule: no-dynamic-children
// ---------------------------------------------------------------------------

describe("no-dynamic-children rule", () => {
  it("reports ternary in JSX children", () => {
    const ctx = createMockContext()
    const visitors = noDynamicChildren.create(ctx as any)
    const handler = visitors.JSXExpressionContainer!

    handler(
      makeNode({
        type: "JSXExpressionContainer",
        parent: makeNode({ type: "JSXElement" }),
        expression: makeNode({ type: "ConditionalExpression" }),
      }),
    )

    expect(ctx.reports.length).toBe(1)
    expect(ctx.reports[0]!.messageId).toBe("noTernary")
  })

  it("reports logical && in JSX children", () => {
    const ctx = createMockContext()
    const visitors = noDynamicChildren.create(ctx as any)
    const handler = visitors.JSXExpressionContainer!

    handler(
      makeNode({
        type: "JSXExpressionContainer",
        parent: makeNode({ type: "JSXElement" }),
        expression: makeNode({
          type: "LogicalExpression",
          operator: "&&",
        }),
      }),
    )

    expect(ctx.reports.length).toBe(1)
    expect(ctx.reports[0]!.messageId).toBe("noLogicalAnd")
  })

  it("reports .map() in JSX children", () => {
    const ctx = createMockContext()
    const visitors = noDynamicChildren.create(ctx as any)
    const handler = visitors.JSXExpressionContainer!

    handler(
      makeNode({
        type: "JSXExpressionContainer",
        parent: makeNode({ type: "JSXElement" }),
        expression: makeNode({
          type: "CallExpression",
          callee: makeNode({
            type: "MemberExpression",
            property: makeNode({ type: "Identifier", name: "map" }),
          }),
        }),
      }),
    )

    expect(ctx.reports.length).toBe(1)
    expect(ctx.reports[0]!.messageId).toBe("noMapWithoutFor")
  })

  it("ignores expressions in attribute position", () => {
    const ctx = createMockContext()
    const visitors = noDynamicChildren.create(ctx as any)
    const handler = visitors.JSXExpressionContainer!

    // Parent is JSXAttribute, not JSXElement
    handler(
      makeNode({
        type: "JSXExpressionContainer",
        parent: makeNode({ type: "JSXAttribute" }),
        expression: makeNode({ type: "ConditionalExpression" }),
      }),
    )

    expect(ctx.reports.length).toBe(0)
  })

  it("ignores non-dynamic expressions in children", () => {
    const ctx = createMockContext()
    const visitors = noDynamicChildren.create(ctx as any)
    const handler = visitors.JSXExpressionContainer!

    // A simple identifier reference is fine
    handler(
      makeNode({
        type: "JSXExpressionContainer",
        parent: makeNode({ type: "JSXElement" }),
        expression: makeNode({ type: "Identifier", name: "someVar" }),
      }),
    )

    expect(ctx.reports.length).toBe(0)
  })

  it("reports in JSXFragment children too", () => {
    const ctx = createMockContext()
    const visitors = noDynamicChildren.create(ctx as any)
    const handler = visitors.JSXExpressionContainer!

    handler(
      makeNode({
        type: "JSXExpressionContainer",
        parent: makeNode({ type: "JSXFragment" }),
        expression: makeNode({
          type: "LogicalExpression",
          operator: "&&",
        }),
      }),
    )

    expect(ctx.reports.length).toBe(1)
    expect(ctx.reports[0]!.messageId).toBe("noLogicalAnd")
  })

  it("ignores logical || (not a conditional render pattern)", () => {
    const ctx = createMockContext()
    const visitors = noDynamicChildren.create(ctx as any)
    const handler = visitors.JSXExpressionContainer!

    handler(
      makeNode({
        type: "JSXExpressionContainer",
        parent: makeNode({ type: "JSXElement" }),
        expression: makeNode({
          type: "LogicalExpression",
          operator: "||",
        }),
      }),
    )

    expect(ctx.reports.length).toBe(0)
  })

  it("ignores .filter() and other member calls", () => {
    const ctx = createMockContext()
    const visitors = noDynamicChildren.create(ctx as any)
    const handler = visitors.JSXExpressionContainer!

    handler(
      makeNode({
        type: "JSXExpressionContainer",
        parent: makeNode({ type: "JSXElement" }),
        expression: makeNode({
          type: "CallExpression",
          callee: makeNode({
            type: "MemberExpression",
            property: makeNode({ type: "Identifier", name: "filter" }),
          }),
        }),
      }),
    )

    expect(ctx.reports.length).toBe(0)
  })
})
