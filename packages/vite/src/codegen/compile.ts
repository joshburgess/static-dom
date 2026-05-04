/**
 * compile.ts — Build-time codegen for SDOM JSX.
 *
 * Transforms .tsx/.jsx source files: finds JSX elements whose shape is
 * statically known and rewrites them as module-scope `compiled()`
 * calls with the walker chain unrolled and the binding switch
 * eliminated.
 *
 * Supported shapes (current slice):
 *   - Lowercase intrinsic tags only.
 *   - Attributes whose values are string literals (baked into the
 *     template's innerHTML) or single arrow / function expressions
 *     (emitted as a per-attr binding).
 *   - Event handler props (onClick, onInput, etc.) routed through
 *     `registerEvent` so they go through the program's ambient
 *     delegator when one is installed.
 *   - Children that are static text, single arrow / function
 *     expressions (dynamic text), and nested JSX elements with the
 *     same restrictions (recursive).
 *   - Pure-static subtrees collapse fully into innerHTML; only
 *     descendants with bindings get walker aliases.
 *
 * Out of scope (deferred to later slices):
 *   - `style` object form, `classes` map, refs, keys, spread.
 *   - An element whose children mix dynamic-text holes with element
 *     children at the same level (would need insertBefore plumbing).
 *   - Expressions other than a single arrow/function or a literal.
 */

import ts from "typescript"

export interface CompileResult {
  code: string
}

const COMPILED_IMPORT_NAME = "__sdomCompiled"
const REGISTER_EVENT_IMPORT_NAME = "__sdomRegisterEvent"
const COMPILED_IMPORT_SPECIFIER = "@static-dom/core"

const EVENT_RE = /^on[A-Z]/

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

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
// Plan types
// ---------------------------------------------------------------------------

interface DynamicAttr {
  attrName: string
  propName: string | null
  fnSource: string
}

interface EventHandler {
  /** DOM event name, e.g. "click" or "input". */
  eventName: string
  fnSource: string
}

type ChildPlan =
  | { kind: "static-text"; text: string }
  | { kind: "dynamic-text"; fnSource: string }
  | { kind: "element"; plan: ElementPlan }

interface ElementPlan {
  tag: string
  staticAttrs: Array<{ name: string; value: string }>
  dynamicAttrs: DynamicAttr[]
  events: EventHandler[]
  children: ChildPlan[]
}

interface RootPlan extends ElementPlan {
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
          hoistedCode: emitFromPlan(plan, tplName, identifier, nextId),
        })
        nextId += 1
      }
      // JSX nodes are atomic from the visitor's perspective: an outer
      // non-compilable element owns its children, so substituting an
      // inner element with an identifier in a text-child position would
      // break the parent. Wider compilation lives inside `analyzeJsx`.
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (sites.length === 0) return null
  return { code: applyTransforms(code, sites) }
}

// ---------------------------------------------------------------------------
// AST analysis
// ---------------------------------------------------------------------------

function analyzeJsx(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): RootPlan | null {
  const plan = analyzeElement(node)
  if (plan === null) return null
  return { ...plan, start: node.getStart(), end: node.getEnd() }
}

function analyzeElement(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): ElementPlan | null {
  const opening = ts.isJsxElement(node) ? node.openingElement : node
  const tagName = opening.tagName
  if (!ts.isIdentifier(tagName)) return null
  const tag = tagName.text
  if (!/^[a-z][a-zA-Z0-9]*$/.test(tag)) return null

  const staticAttrs: Array<{ name: string; value: string }> = []
  const dynamicAttrs: DynamicAttr[] = []
  const events: EventHandler[] = []

  for (const prop of opening.attributes.properties) {
    if (!ts.isJsxAttribute(prop)) return null
    if (!ts.isIdentifier(prop.name)) return null

    const rawName = prop.name.text
    if (rawName === "style" || rawName === "classes") return null
    if (rawName === "key" || rawName === "ref") return null

    if (EVENT_RE.test(rawName)) {
      const init = prop.initializer
      if (init === undefined) return null
      if (!ts.isJsxExpression(init) || init.expression === undefined) return null
      const expr = init.expression
      if (!ts.isArrowFunction(expr) && !ts.isFunctionExpression(expr)) return null
      const eventName = rawName[2]!.toLowerCase() + rawName.slice(3)
      events.push({ eventName, fnSource: expr.getText() })
      continue
    }

    const attrName = rawName === "className" ? "class" : rawName

    const init = prop.initializer
    if (init === undefined) {
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
      return null
    }
    return null
  }

  const children = ts.isJsxElement(node)
    ? analyzeChildren(node.children)
    : []
  if (children === null) return null

  return { tag, staticAttrs, dynamicAttrs, events, children }
}

function analyzeChildren(
  children: ts.NodeArray<ts.JsxChild>,
): ChildPlan[] | null {
  if (children.length === 0) return []

  const out: ChildPlan[] = []
  let hasDynamicText = false
  let hasElement = false

  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text = child.text
      if (text.trim() === "") continue
      out.push({ kind: "static-text", text })
      continue
    }
    if (ts.isJsxExpression(child)) {
      if (child.expression === undefined) continue
      const expr = child.expression
      if (ts.isStringLiteral(expr) || ts.isNumericLiteral(expr)) {
        out.push({ kind: "static-text", text: expr.text })
        continue
      }
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        out.push({ kind: "dynamic-text", fnSource: expr.getText() })
        hasDynamicText = true
        continue
      }
      return null
    }
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const inner = analyzeElement(child)
      if (inner === null) return null
      out.push({ kind: "element", plan: inner })
      hasElement = true
      continue
    }
    return null
  }

  // Reject the mixed case (dynamic text + element children at the same level).
  if (hasDynamicText && hasElement) return null
  return out
}

function resolvePropName(attrName: string): string | null {
  if (IDL_PROPS.has(attrName)) return attrName
  if (ATTR_TO_PROP[attrName] !== undefined) return ATTR_TO_PROP[attrName]
  return null
}

// ---------------------------------------------------------------------------
// "Needs binding" analysis
//
// An element needs runtime work (alias allocation, child node creation, attr
// binding) iff it has dynamic attrs, dynamic text children, or descendants
// that themselves need work. Pure-static subtrees collapse fully into the
// template's innerHTML and never get touched at clone time.
// ---------------------------------------------------------------------------

function elementNeedsWork(plan: ElementPlan): boolean {
  if (plan.dynamicAttrs.length > 0) return true
  if (plan.events.length > 0) return true
  for (const c of plan.children) {
    if (c.kind === "dynamic-text") return true
    if (c.kind === "element" && elementNeedsWork(c.plan)) return true
  }
  return false
}

function planHasAnyEvents(plan: ElementPlan): boolean {
  if (plan.events.length > 0) return true
  for (const c of plan.children) {
    if (c.kind === "element" && planHasAnyEvents(c.plan)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Code emission
// ---------------------------------------------------------------------------

interface EmitContext {
  htmlParts: string[]
  /** Module-scope lines: hoisted user functions, defined once per build. */
  moduleScopeLines: string[]
  setupLines: string[]
  updateLines: string[]
  attrIdx: number
  textIdx: number
  elIdx: number
  evtIdx: number
  hasEvents: boolean
  /** Site index, used to namespace hoisted identifiers across compiled sites. */
  siteId: number
}

function emitFromPlan(
  plan: RootPlan,
  tplName: string,
  compiledName: string,
  siteId: number,
): string {
  const ctx: EmitContext = {
    htmlParts: [],
    moduleScopeLines: [],
    setupLines: [],
    updateLines: [],
    attrIdx: 0,
    textIdx: 0,
    elIdx: 0,
    evtIdx: 0,
    hasEvents: false,
    siteId,
  }

  // Two passes: build innerHTML for the whole tree, then walk the tree
  // again to emit JS for dynamic attrs / dynamic text / events / nested
  // bindings. The root reuses the literal `root` ident as its path expr.
  bakeElementHtml(plan, ctx)
  bindElement(plan, "root", ctx)

  const innerHtml = ctx.htmlParts.join("")
  const lines: string[] = []
  // Hoist user arrow functions to module scope so each row instantiation
  // doesn't re-allocate them. Major win on row-template benchmarks.
  for (const m of ctx.moduleScopeLines) lines.push(m)
  lines.push(`const ${tplName} = (() => {`)
  lines.push(`  const __t = document.createElement("template")`)
  lines.push(`  __t.innerHTML = ${JSON.stringify(innerHtml)}`)
  lines.push(`  return __t.content.firstChild`)
  lines.push(`})()`)
  lines.push(`const ${compiledName} = ${COMPILED_IMPORT_NAME}((parent, initialModel, dispatch) => {`)
  lines.push(`  const root = ${tplName}.cloneNode(true)`)
  if (ctx.hasEvents) {
    // Live model ref shared by every event listener in this subtree, so
    // handlers always see the current model without re-registering.
    lines.push(`  const __evtRef = { current: initialModel }`)
    lines.push(`  const __evtCleanups = []`)
  }
  for (const s of ctx.setupLines) lines.push(s)
  lines.push(`  parent.appendChild(root)`)
  lines.push(`  return {`)
  lines.push(`    update(_prev, next) {`)
  if (ctx.hasEvents) lines.push(`      __evtRef.current = next`)
  for (const u of ctx.updateLines) lines.push(u)
  lines.push(`    },`)
  if (ctx.hasEvents) {
    lines.push(`    teardown() {`)
    lines.push(`      for (const __c of __evtCleanups) __c()`)
    lines.push(`      root.remove()`)
    lines.push(`    },`)
  } else {
    lines.push(`    teardown() { root.remove() },`)
  }
  lines.push(`  }`)
  lines.push(`})`)
  return lines.join("\n")
}

/**
 * JS pass: emit alias allocations, attribute bindings, child node creation,
 * and recurse into element children that need work. Assumes the innerHTML
 * for this subtree was already produced by `bakeElementHtml`.
 */
function bindElement(plan: ElementPlan, pathExpr: string, ctx: EmitContext): void {
  // Allocate a walker alias for this element if it has any runtime work.
  // The root reuses the literal `root` ident, so skip aliasing there.
  let elPath = pathExpr
  if (pathExpr !== "root" && elementNeedsWork(plan)) {
    elPath = `__el_${ctx.elIdx++}`
    ctx.setupLines.push(`  const ${elPath} = ${pathExpr}`)
  }

  // Dynamic attributes on this element. The user's function is hoisted
  // to module scope (see __sdom_attrFn_*) so each row only allocates the
  // `__attrLast${i}` slot, not the function itself.
  for (const attr of plan.dynamicAttrs) {
    const i = ctx.attrIdx++
    const fnName = `__sdom_attrFn_${ctx.siteId}_${i}`
    ctx.moduleScopeLines.push(`const ${fnName} = ${attr.fnSource}`)
    ctx.setupLines.push(`  let __attrLast${i} = ${fnName}(initialModel)`)
    ctx.setupLines.push(
      attr.propName !== null
        ? `  ${elPath}.${attr.propName} = __attrLast${i}`
        : `  ${elPath}.setAttribute(${JSON.stringify(attr.attrName)}, __attrLast${i})`,
    )
    ctx.updateLines.push(`      const __attrV${i} = ${fnName}(next)`)
    ctx.updateLines.push(`      if (__attrV${i} !== __attrLast${i}) {`)
    ctx.updateLines.push(`        __attrLast${i} = __attrV${i}`)
    ctx.updateLines.push(
      attr.propName !== null
        ? `        ${elPath}.${attr.propName} = __attrV${i}`
        : `        ${elPath}.setAttribute(${JSON.stringify(attr.attrName)}, __attrV${i})`,
    )
    ctx.updateLines.push(`      }`)
  }

  // Event handlers: route through registerEvent so the program's ambient
  // delegator picks them up. With no delegator (e.g. tests using bare
  // `attach`), registerEvent falls back to addEventListener and returns a
  // teardown function that we collect into __evtCleanups.
  //
  // The handler body itself is hoisted to module scope; only the listener
  // wrapper stays per-row because it must close over the per-row __evtRef.
  for (const evt of plan.events) {
    ctx.hasEvents = true
    const i = ctx.evtIdx++
    const fnName = `__sdom_evtFn_${ctx.siteId}_${i}`
    ctx.moduleScopeLines.push(`const ${fnName} = ${evt.fnSource}`)
    ctx.setupLines.push(`  const __evtL${i} = (event) => {`)
    ctx.setupLines.push(`    const __m = ${fnName}(event, __evtRef.current)`)
    ctx.setupLines.push(`    if (__m !== null && __m !== undefined) dispatch(__m)`)
    ctx.setupLines.push(`  }`)
    ctx.setupLines.push(
      `  const __evtC${i} = ${REGISTER_EVENT_IMPORT_NAME}(${elPath}, ${JSON.stringify(evt.eventName)}, __evtL${i})`,
    )
    ctx.setupLines.push(`  if (__evtC${i} !== null) __evtCleanups.push(__evtC${i})`)
  }

  // Children: either inline-build (text-like case) or recurse into element
  // children whose subtrees were baked into innerHTML.
  const childKinds = childKindsOf(plan.children)
  const inlineChildren = childKinds.hasDynamicText
  if (inlineChildren) {
    for (const child of plan.children) {
      if (child.kind === "static-text") {
        ctx.setupLines.push(
          `  ${elPath}.appendChild(document.createTextNode(${JSON.stringify(child.text)}))`,
        )
      } else if (child.kind === "dynamic-text") {
        const i = ctx.textIdx++
        const fnName = `__sdom_textFn_${ctx.siteId}_${i}`
        ctx.moduleScopeLines.push(`const ${fnName} = ${child.fnSource}`)
        ctx.setupLines.push(
          `  const __textNode${i} = ${elPath}.appendChild(document.createTextNode(""))`,
        )
        ctx.setupLines.push(`  let __textLast${i} = ${fnName}(initialModel)`)
        ctx.setupLines.push(`  __textNode${i}.nodeValue = String(__textLast${i})`)
        ctx.updateLines.push(`      const __textV${i} = ${fnName}(next)`)
        ctx.updateLines.push(`      if (__textV${i} !== __textLast${i}) {`)
        ctx.updateLines.push(`        __textLast${i} = __textV${i}`)
        ctx.updateLines.push(`        __textNode${i}.nodeValue = String(__textV${i})`)
        ctx.updateLines.push(`      }`)
      }
    }
  } else {
    let prevPath: string | null = null
    for (const child of plan.children) {
      // Each child node (static text or element, baked into innerHTML)
      // advances the sibling cursor.
      const childPathExpr: string =
        prevPath === null ? `${elPath}.firstChild` : `${prevPath}.nextSibling`
      prevPath = childPathExpr
      if (child.kind === "element" && elementNeedsWork(child.plan)) {
        bindElement(child.plan, childPathExpr, ctx)
      }
      // Pure-static elements and static text were baked into innerHTML and
      // need no JS work.
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function childKindsOf(children: ChildPlan[]): {
  hasStaticText: boolean
  hasDynamicText: boolean
  hasElement: boolean
} {
  let hasStaticText = false
  let hasDynamicText = false
  let hasElement = false
  for (const c of children) {
    if (c.kind === "static-text") hasStaticText = true
    else if (c.kind === "dynamic-text") hasDynamicText = true
    else if (c.kind === "element") hasElement = true
  }
  return { hasStaticText, hasDynamicText, hasElement }
}

/** Recursively serialize a plan's static structure into the innerHTML buffer. */
function bakeElementHtml(plan: ElementPlan, ctx: EmitContext): void {
  ctx.htmlParts.push(`<${plan.tag}`)
  for (const a of plan.staticAttrs) {
    if (a.value === "") ctx.htmlParts.push(` ${a.name}`)
    else ctx.htmlParts.push(` ${a.name}="${escapeAttrValue(a.value)}"`)
  }
  ctx.htmlParts.push(">")

  // Mirror walkPlan's children-baking logic: skip child baking when this
  // element will create its children inline.
  const kinds = childKindsOf(plan.children)
  const inlineChildren = kinds.hasDynamicText
  if (!inlineChildren) {
    for (const child of plan.children) {
      if (child.kind === "static-text") {
        ctx.htmlParts.push(escapeHtmlText(child.text))
      } else if (child.kind === "element") {
        bakeElementHtml(child.plan, ctx)
      }
    }
  }

  if (!VOID_TAGS.has(plan.tag)) {
    ctx.htmlParts.push(`</${plan.tag}>`)
  }
}

function escapeAttrValue(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
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
  const importLine =
    `import { compiled as ${COMPILED_IMPORT_NAME}, registerEvent as ${REGISTER_EVENT_IMPORT_NAME} } from "${COMPILED_IMPORT_SPECIFIER}"\n`
  const hoisted = sites.map(s => s.hoistedCode).join("\n\n") + "\n\n"
  return importLine + hoisted + out
}
