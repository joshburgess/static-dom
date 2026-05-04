/**
 * compile.ts — Build-time codegen for SDOM JSX.
 *
 * Transforms .tsx/.jsx source files: finds JSX elements whose shape is
 * statically known and rewrites them as module-scope `compiled()`
 * calls with the walker chain unrolled and the binding switch
 * eliminated.
 *
 * Supported shapes (current slice):
 *   - Lowercase intrinsic tag (`<div>`, `<span>`, ...).
 *   - Attributes whose values are string literals (baked into the
 *     template's innerHTML) or single arrow / function expressions
 *     (emitted as a per-attr binding).
 *   - Children that are static text (JsxText), or single arrow /
 *     function expressions (emitted as a per-text-node binding).
 *
 * Out of scope (deferred to later slices):
 *   - Events (`onClick`, ...), `style` object form, `classes` map,
 *     refs, keys, spread attributes.
 *   - Nested JSX elements.
 *   - Expressions other than a single arrow/function (string literals,
 *     identifiers, member expressions, ternaries, etc.).
 *
 * Files containing no compilable JSX return `null` so they pass
 * through untouched.
 */

import ts from "typescript"

export interface CompileResult {
  code: string
}

const COMPILED_IMPORT_NAME = "__sdomCompiled"
const COMPILED_IMPORT_SPECIFIER = "@static-dom/core"

// HTML void elements: emitted as `<tag>` (no closing) inside innerHTML.
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

// Attribute name -> DOM property name. Mirrors the runtime's ATTR_TO_PROP.
const ATTR_TO_PROP: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  cellspacing: "cellSpacing",
  rowspan: "rowSpan",
  colspan: "colSpan",
  usemap: "useMap",
  frameborder: "frameBorder",
  contenteditable: "contentEditable",
  crossorigin: "crossOrigin",
  accesskey: "accessKey",
}

// IDL properties that are set via direct property assignment, not setAttribute.
// Mirrors the runtime's IDL_PROPS in shared.ts.
const IDL_PROPS = new Set([
  "value", "checked", "disabled", "readOnly", "multiple", "selected",
  "defaultValue", "defaultChecked", "indeterminate",
  "type", "href", "src", "alt", "placeholder", "title",
  "id", "name", "target", "rel",
  "min", "max", "step", "pattern", "required",
  "autoFocus", "autoComplete", "autoPlay",
  "width", "height", "hidden",
  "tabIndex", "htmlFor", "contentEditable",
  "draggable", "spellCheck",
  "controls", "loop", "muted", "volume", "currentTime",
  "playbackRate", "preload", "poster",
  "colSpan", "rowSpan",
  "action", "method", "encType", "noValidate",
  "accept", "acceptCharset",
  "open", "wrap", "cols", "rows",
  "download", "ping", "referrerPolicy",
  "sandbox", "allow", "loading",
  "integrity", "crossOrigin",
])

// ---------------------------------------------------------------------------
// CompilePlan — the structured representation we build from the JSX AST
// before emitting code.
// ---------------------------------------------------------------------------

interface DynamicAttr {
  /** The attribute name as written in JSX (or normalized for class/className). */
  attrName: string
  /** DOM property to assign to, or null if `setAttribute(attrName, ...)` is required. */
  propName: string | null
  /** Source text of the user's arrow/function expression. */
  fnSource: string
}

type ChildPlan =
  | { kind: "static-text"; text: string }
  | { kind: "dynamic-text"; fnSource: string }

interface CompilePlan {
  tag: string
  /** Attributes baked into the template's innerHTML as `name="value"` pairs. */
  staticAttrs: Array<{ name: string; value: string }>
  /** Attributes that update from a function projection of the model. */
  dynamicAttrs: DynamicAttr[]
  children: ChildPlan[]
  /** Source range of the JSX expression in the original file. */
  start: number
  end: number
}

interface CompiledSite {
  start: number
  end: number
  identifier: string
  hoistedCode: string
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function compileFile(code: string, id: string): CompileResult | null {
  if (!id.endsWith(".tsx") && !id.endsWith(".jsx")) return null

  const sf = ts.createSourceFile(
    id,
    code,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    id.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JSX,
  )

  const sites: CompiledSite[] = []
  let nextId = 0

  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const plan = analyzeJsx(node)
      if (plan !== null) {
        const identifier = `__sdom_compiled_${nextId}`
        const tplName = `__sdom_tpl_${nextId}`
        sites.push({
          start: plan.start,
          end: plan.end,
          identifier,
          hoistedCode: emitFromPlan(plan, tplName, identifier),
        })
        nextId += 1
      }
      // Don't descend into JSX subtrees: an outer non-compilable element
      // owns its children, and substituting an inner element with an
      // identifier in a text-child position would break the parent.
      // When nested-element compilation lands, the analyzer will handle
      // the whole tree at once.
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (sites.length === 0) return null

  return { code: applyTransforms(code, sites) }
}

// ---------------------------------------------------------------------------
// AST analysis: JsxElement / JsxSelfClosingElement  ->  CompilePlan | null
// ---------------------------------------------------------------------------

function analyzeJsx(node: ts.JsxElement | ts.JsxSelfClosingElement): CompilePlan | null {
  const opening = ts.isJsxElement(node) ? node.openingElement : node
  const tagName = opening.tagName
  if (!ts.isIdentifier(tagName)) return null
  const tag = tagName.text
  if (!/^[a-z][a-zA-Z0-9]*$/.test(tag)) return null

  const staticAttrs: Array<{ name: string; value: string }> = []
  const dynamicAttrs: DynamicAttr[] = []

  for (const prop of opening.attributes.properties) {
    if (!ts.isJsxAttribute(prop)) return null // spreads are out of scope
    if (!ts.isIdentifier(prop.name)) return null

    const rawName = prop.name.text
    // Defer events / style / classes for now.
    if (rawName.startsWith("on") && /^on[A-Z]/.test(rawName)) return null
    if (rawName === "style" || rawName === "classes") return null
    if (rawName === "key" || rawName === "ref") return null

    // Normalize className -> class (matches runtime classifyProps behavior).
    const attrName = rawName === "className" ? "class" : rawName

    const init = prop.initializer
    if (init === undefined) {
      // Boolean attribute with no value, e.g. `<input disabled>`.
      staticAttrs.push({ name: attrName, value: "" })
      continue
    }
    if (ts.isStringLiteral(init)) {
      staticAttrs.push({ name: attrName, value: init.text })
      continue
    }
    if (ts.isJsxExpression(init) && init.expression !== undefined) {
      const expr = init.expression
      if (ts.isStringLiteral(expr) || ts.isNumericLiteral(expr)) {
        staticAttrs.push({ name: attrName, value: expr.text })
        continue
      }
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        const propName = resolvePropName(attrName)
        dynamicAttrs.push({ attrName, propName, fnSource: expr.getText() })
        continue
      }
      // Other expression forms (identifiers, member access, conditionals)
      // are out of scope for this slice.
      return null
    }
    return null
  }

  const childPlan = analyzeChildren(ts.isJsxElement(node) ? node.children : undefined)
  if (childPlan === null) return null

  return {
    tag,
    staticAttrs,
    dynamicAttrs,
    children: childPlan,
    start: node.getStart(),
    end: node.getEnd(),
  }
}

function analyzeChildren(children: ts.NodeArray<ts.JsxChild> | undefined): ChildPlan[] | null {
  if (children === undefined || children.length === 0) return []

  const out: ChildPlan[] = []
  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text = child.text
      // Skip whitespace-only JSX text per the standard JSX rule, where it
      // doesn't survive into the rendered output.
      if (text.trim() === "") continue
      out.push({ kind: "static-text", text })
      continue
    }
    if (ts.isJsxExpression(child)) {
      if (child.expression === undefined) continue // empty `{}`
      const expr = child.expression
      if (ts.isStringLiteral(expr) || ts.isNumericLiteral(expr)) {
        out.push({ kind: "static-text", text: expr.text })
        continue
      }
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        out.push({ kind: "dynamic-text", fnSource: expr.getText() })
        continue
      }
      return null // other expression forms deferred
    }
    return null // nested elements, fragments, etc. deferred
  }
  return out
}

function resolvePropName(attrName: string): string | null {
  if (IDL_PROPS.has(attrName)) return attrName
  if (ATTR_TO_PROP[attrName] !== undefined) return ATTR_TO_PROP[attrName]
  return null
}

// ---------------------------------------------------------------------------
// Code emission
// ---------------------------------------------------------------------------

function emitFromPlan(plan: CompilePlan, tplName: string, compiledName: string): string {
  const lines: string[] = []

  // Template element: bake static attrs into innerHTML.
  const innerHtml = buildInnerHtml(plan)
  lines.push(`const ${tplName} = (() => {`)
  lines.push(`  const __t = document.createElement("template")`)
  lines.push(`  __t.innerHTML = ${JSON.stringify(innerHtml)}`)
  lines.push(`  return __t.content.firstChild`)
  lines.push(`})()`)

  // Dynamic-attr declarations -> closure-scoped vars.
  // Dynamic-text children -> closure-scoped vars + appended text nodes.
  lines.push(`const ${compiledName} = ${COMPILED_IMPORT_NAME}((parent, initialModel, _dispatch) => {`)
  lines.push(`  const root = ${tplName}.cloneNode(true)`)

  // Per-attr setup.
  plan.dynamicAttrs.forEach((attr, i) => {
    lines.push(`  const __attrFn${i} = ${attr.fnSource}`)
    lines.push(`  let __attrLast${i} = __attrFn${i}(initialModel)`)
    if (attr.propName !== null) {
      lines.push(`  root.${attr.propName} = __attrLast${i}`)
    } else {
      lines.push(`  root.setAttribute(${JSON.stringify(attr.attrName)}, __attrLast${i})`)
    }
  })

  // Per-child setup.
  plan.children.forEach((child, i) => {
    if (child.kind === "static-text") {
      lines.push(
        `  root.appendChild(document.createTextNode(${JSON.stringify(child.text)}))`,
      )
    } else {
      lines.push(`  const __textNode${i} = root.appendChild(document.createTextNode(""))`)
      lines.push(`  const __textFn${i} = ${child.fnSource}`)
      lines.push(`  let __textLast${i} = __textFn${i}(initialModel)`)
      lines.push(`  __textNode${i}.nodeValue = String(__textLast${i})`)
    }
  })

  lines.push(`  parent.appendChild(root)`)

  // update body.
  lines.push(`  return {`)
  lines.push(`    update(_prev, next) {`)
  plan.dynamicAttrs.forEach((attr, i) => {
    lines.push(`      const __attrV${i} = __attrFn${i}(next)`)
    lines.push(`      if (__attrV${i} !== __attrLast${i}) {`)
    lines.push(`        __attrLast${i} = __attrV${i}`)
    if (attr.propName !== null) {
      lines.push(`        root.${attr.propName} = __attrV${i}`)
    } else {
      lines.push(`        root.setAttribute(${JSON.stringify(attr.attrName)}, __attrV${i})`)
    }
    lines.push(`      }`)
  })
  plan.children.forEach((child, i) => {
    if (child.kind !== "dynamic-text") return
    lines.push(`      const __textV${i} = __textFn${i}(next)`)
    lines.push(`      if (__textV${i} !== __textLast${i}) {`)
    lines.push(`        __textLast${i} = __textV${i}`)
    lines.push(`        __textNode${i}.nodeValue = String(__textV${i})`)
    lines.push(`      }`)
  })
  lines.push(`    },`)
  lines.push(`    teardown() { root.remove() },`)
  lines.push(`  }`)
  lines.push(`})`)

  return lines.join("\n")
}

function buildInnerHtml(plan: CompilePlan): string {
  const attrStr = plan.staticAttrs
    .map(a => {
      if (a.value === "") return ` ${a.name}`
      return ` ${a.name}="${escapeAttrValue(a.value)}"`
    })
    .join("")
  if (VOID_TAGS.has(plan.tag)) {
    return `<${plan.tag}${attrStr}>`
  }
  return `<${plan.tag}${attrStr}></${plan.tag}>`
}

function escapeAttrValue(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

// ---------------------------------------------------------------------------
// Source rewriting
// ---------------------------------------------------------------------------

function applyTransforms(code: string, sites: CompiledSite[]): string {
  let out = code
  const sorted = [...sites].sort((a, b) => b.start - a.start)
  for (const site of sorted) {
    out = out.slice(0, site.start) + site.identifier + out.slice(site.end)
  }
  const importLine = `import { compiled as ${COMPILED_IMPORT_NAME} } from "${COMPILED_IMPORT_SPECIFIER}"\n`
  const hoisted = sites.map(s => s.hoistedCode).join("\n\n") + "\n\n"
  return importLine + hoisted + out
}
