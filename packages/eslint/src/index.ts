/**
 * eslint-plugin.ts — ESLint rules for SDOM JSX
 *
 * Catches common patterns that violate SDOM's static DOM invariant:
 * - Conditional rendering in children (ternary, &&)
 * - Dynamic lists without For wrapper (.map in children)
 *
 * @example Flat config (eslint.config.js):
 * ```javascript
 * import sdom from "@static-dom/eslint"
 *
 * export default [
 *   {
 *     plugins: { sdom },
 *     rules: {
 *       "sdom/no-dynamic-children": "error",
 *     },
 *   },
 * ]
 * ```
 */

// ---------------------------------------------------------------------------
// Inline ESLint types — avoids @types/eslint dependency
// ---------------------------------------------------------------------------

interface RuleContext {
  report(descriptor: {
    node: ASTNode
    messageId: string
  }): void
}

interface ASTNode {
  type: string
  parent?: ASTNode
  expression?: ASTNode
  operator?: string
  callee?: ASTNode
  property?: ASTNode
  name?: string
  [key: string]: unknown
}

interface RuleMeta {
  type: string
  docs: { description: string; recommended: boolean }
  messages: Record<string, string>
  schema: unknown[]
}

interface Rule {
  meta: RuleMeta
  create(context: RuleContext): Record<string, (node: ASTNode) => void>
}

// ---------------------------------------------------------------------------
// Rule: no-dynamic-children
// ---------------------------------------------------------------------------

/**
 * ESLint rule that flags JSX children patterns that create dynamic
 * DOM structure, which violates SDOM's static rendering invariant.
 *
 * Catches:
 * - `{cond ? <A/> : <B/>}` — ternary in children position
 * - `{flag && <Component/>}` — logical && in children position
 * - `{items.map(x => <div/>)}` — .map() without `<For>` wrapper
 */
export const noDynamicChildren: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow dynamic children in SDOM JSX that would violate the static DOM invariant",
      recommended: true,
    },
    messages: {
      noTernary:
        "Ternary in JSX children creates dynamic DOM structure. " +
        "Use <Show> for conditional visibility or <Optional> for mount/unmount.",
      noLogicalAnd:
        "Logical && in JSX children creates dynamic DOM structure. " +
        "Use <Show> for conditional rendering.",
      noMapWithoutFor:
        "Array .map() in JSX children creates dynamic DOM structure. " +
        "Use <For> for keyed lists.",
    },
    schema: [],
  },

  create(context) {
    return {
      JSXExpressionContainer(node: ASTNode) {
        // Only check children position (not attribute values)
        const parent = node.parent
        if (
          !parent ||
          (parent.type !== "JSXElement" && parent.type !== "JSXFragment")
        ) {
          return
        }

        const expr = node.expression
        if (!expr) return

        // Ternary: {cond ? <A/> : <B/>}
        if (expr.type === "ConditionalExpression") {
          context.report({ node, messageId: "noTernary" })
          return
        }

        // Logical &&: {flag && <Component/>}
        if (expr.type === "LogicalExpression" && expr.operator === "&&") {
          context.report({ node, messageId: "noLogicalAnd" })
          return
        }

        // .map() call: {items.map(x => <div/>)}
        if (
          expr.type === "CallExpression" &&
          expr.callee &&
          expr.callee.type === "MemberExpression" &&
          expr.callee.property &&
          (expr.callee.property as ASTNode).type === "Identifier" &&
          (expr.callee.property as ASTNode).name === "map"
        ) {
          context.report({ node, messageId: "noMapWithoutFor" })
          return
        }
      },
    }
  },
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

/** ESLint rules for SDOM JSX best practices. */
export const rules = {
  "no-dynamic-children": noDynamicChildren,
} as const

const plugin = { rules }
export default plugin
