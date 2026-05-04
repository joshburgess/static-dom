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
 *     `delegateEvent` so they go through the program's ambient
 *     delegator (property-based dispatch — no per-row closure) when
 *     one is installed, or fall back to addEventListener otherwise.
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
const COMPILED_STATE_IMPORT_NAME = "__sdomCompiledState"
const DELEGATE_EVENT_IMPORT_NAME = "__sdomDelegateEvent"
const COMPILED_IMPORT_SPECIFIER = "@static-dom/core"

const EVENT_RE = /^on[A-Z]/

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

// Tags whose direct text children get foster-parented or otherwise displaced
// by the HTML parser. We can't pre-bake text node placeholders inside these
// because innerHTML parsing won't put the text node where the JSX wrote it.
const TEXT_HOSTILE_TAGS = new Set([
  "table", "thead", "tbody", "tfoot", "tr", "colgroup", "select", "datalist",
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

/**
 * True when this element has exactly one dynamic-text child and the parent
 * tag preserves text inside innerHTML. We can pre-bake a placeholder text
 * node into the cloned template and walk to it via `firstChild` instead of
 * paying `document.createTextNode("") + appendChild` per row at clone time.
 */
function canPreBakeText(plan: ElementPlan): boolean {
  if (TEXT_HOSTILE_TAGS.has(plan.tag)) return false
  if (plan.children.length !== 1) return false
  return plan.children[0]!.kind === "dynamic-text"
}

// ---------------------------------------------------------------------------
// Code emission
// ---------------------------------------------------------------------------

interface EmitContext {
  htmlParts: string[]
  /** Module-scope lines: hoisted user functions, defined once per build. */
  moduleScopeLines: string[]
  /** Lines emitted into the body of the per-site setup function. */
  setupLines: string[]
  /** Lines emitted into the body of the per-site update function. */
  updateLines: string[]
  /** Lines emitted into the body of the per-site teardown function. */
  teardownLines: string[]
  /** Initial property bindings for the row state object literal. */
  stateInitProps: string[]
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
    teardownLines: [],
    stateInitProps: [],
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
  const setupName = `__sdom_setup_${siteId}`
  const updateName = `__sdom_update_${siteId}`
  const teardownName = `__sdom_teardown_${siteId}`
  const lines: string[] = []
  // Hoist user arrow functions (attr, text, event) to module scope so each
  // row instantiation doesn't re-allocate them.
  for (const m of ctx.moduleScopeLines) lines.push(m)
  lines.push(`const ${tplName} = (() => {`)
  lines.push(`  const __t = document.createElement("template")`)
  lines.push(`  __t.innerHTML = ${JSON.stringify(innerHtml)}`)
  lines.push(`  return __t.content.firstChild`)
  lines.push(`})()`)

  // Module-scope shared setup. Returns a single per-row state object that
  // carries every field update + teardown need. Listener closures capture
  // `s` (and `dispatch`) so they can read the live model from `s.evtModel`.
  lines.push(`const ${setupName} = (parent, initialModel, dispatch) => {`)
  lines.push(`  const root = ${tplName}.cloneNode(true)`)
  // Build the state object literal in a single shape so V8 can settle on a
  // monomorphic hidden class for every row of this template.
  lines.push(`  const s = {`)
  lines.push(`    root,`)
  if (ctx.hasEvents) {
    lines.push(`    dispatch,`)
    // Live model — listeners read s.evtModel and update reassigns it.
    lines.push(`    evtModel: initialModel,`)
    // Stays null when every event registers through the ambient delegator
    // (delegateEvent returns null on the hot bulk-mount path).
    lines.push(`    evtCleanups: null,`)
  }
  for (const p of ctx.stateInitProps) lines.push(p)
  lines.push(`  }`)
  // Property-based delegation back-reference: the root listener walks up
  // from event.target until it finds an element carrying `__sdom_state`,
  // then dispatches with the live `s.evtModel`. Setting this once per row
  // lets per-event registration skip the per-row listener closure.
  if (ctx.hasEvents) lines.push(`  root.__sdom_state = s`)
  for (const s of ctx.setupLines) lines.push(s)
  lines.push(`  parent.appendChild(root)`)
  lines.push(`  return s`)
  lines.push(`}`)

  // Module-scope shared update. Reads `s.attrLast*` / `s.textLast*` slots,
  // writes them on change, and forwards next-model into `s.evtModel`.
  lines.push(`const ${updateName} = (s, _prev, next) => {`)
  if (ctx.hasEvents) lines.push(`  s.evtModel = next`)
  for (const u of ctx.updateLines) lines.push(u)
  lines.push(`}`)

  // Module-scope shared teardown.
  lines.push(`const ${teardownName} = (s) => {`)
  if (ctx.hasEvents) {
    lines.push(`  const __c = s.evtCleanups`)
    lines.push(`  if (__c !== null) for (const __t of __c) __t()`)
  }
  for (const t of ctx.teardownLines) lines.push(t)
  lines.push(`  s.root.remove()`)
  lines.push(`}`)

  lines.push(`const ${compiledName} = ${COMPILED_STATE_IMPORT_NAME}({`)
  lines.push(`  setup: ${setupName},`)
  lines.push(`  update: ${updateName},`)
  lines.push(`  teardown: ${teardownName},`)
  lines.push(`})`)
  return lines.join("\n")
}

/**
 * JS pass: emit alias allocations, attribute bindings, child node creation,
 * and recurse into element children that need work. Assumes the innerHTML
 * for this subtree was already produced by `bakeElementHtml`.
 *
 * Setup writes per-row state into a single `s` literal whose hidden class
 * stays monomorphic across all rows of this template. Update + teardown
 * are module-scope shared functions that reach back into `s` for any
 * element/text node/attr-last value they need to read or rewrite.
 */
function bindElement(plan: ElementPlan, pathExpr: string, ctx: EmitContext): void {
  // Allocate a walker alias for this element if it has any runtime work.
  // The root reuses the literal `root` ident, so skip aliasing there.
  let elPath = pathExpr
  if (pathExpr !== "root" && elementNeedsWork(plan)) {
    elPath = `__el_${ctx.elIdx++}`
    ctx.setupLines.push(`  const ${elPath} = ${pathExpr}`)
  }

  // Update reads the target element via `s.<elKey>` because update doesn't
  // share scope with setup. For the root that's the always-present `s.root`
  // slot; for any other bound element we lazily promote `__el_N` onto `s`.
  const updateElKey =
    elPath === "root" ? "root" : elPath.replace(/^__el_/, "el")
  let updateElPersisted = elPath === "root"
  const ensureUpdateElPersisted = (): void => {
    if (updateElPersisted) return
    updateElPersisted = true
    ctx.stateInitProps.push(`    ${updateElKey}: undefined,`)
    ctx.setupLines.push(`  s.${updateElKey} = ${elPath}`)
  }

  for (const attr of plan.dynamicAttrs) {
    const i = ctx.attrIdx++
    const fnName = `__sdom_attrFn_${ctx.siteId}_${i}`
    ctx.moduleScopeLines.push(`const ${fnName} = ${attr.fnSource}`)
    ctx.stateInitProps.push(`    attrLast${i}: undefined,`)
    ctx.setupLines.push(`  s.attrLast${i} = ${fnName}(initialModel)`)
    ctx.setupLines.push(
      attr.propName !== null
        ? `  ${elPath}.${attr.propName} = s.attrLast${i}`
        : `  ${elPath}.setAttribute(${JSON.stringify(attr.attrName)}, s.attrLast${i})`,
    )
    ensureUpdateElPersisted()
    ctx.updateLines.push(`  const __attrV${i} = ${fnName}(next)`)
    ctx.updateLines.push(`  if (__attrV${i} !== s.attrLast${i}) {`)
    ctx.updateLines.push(`    s.attrLast${i} = __attrV${i}`)
    ctx.updateLines.push(
      attr.propName !== null
        ? `    s.${updateElKey}.${attr.propName} = __attrV${i}`
        : `    s.${updateElKey}.setAttribute(${JSON.stringify(attr.attrName)}, __attrV${i})`,
    )
    ctx.updateLines.push(`  }`)
  }

  // Event handlers: route through delegateEvent. With an ambient delegator
  // installed (the program() path), the user fn is stored as a property on
  // the element and the root listener walks up to find it + the row's
  // `__sdom_state` back-reference, skipping the per-row listener closure
  // that closure-based delegation needed. Without a delegator (bare/test
  // usage), delegateEvent falls back to addEventListener with a closure
  // and returns a teardown that we collect into `s.evtCleanups`.
  //
  // The user fn is hoisted to module scope so every row reuses it.
  for (const evt of plan.events) {
    ctx.hasEvents = true
    const i = ctx.evtIdx++
    const fnName = `__sdom_evtFn_${ctx.siteId}_${i}`
    ctx.moduleScopeLines.push(`const ${fnName} = ${evt.fnSource}`)
    ctx.setupLines.push(
      `  const __evtC${i} = ${DELEGATE_EVENT_IMPORT_NAME}(${elPath}, ${JSON.stringify(evt.eventName)}, ${fnName}, s)`,
    )
    ctx.setupLines.push(
      `  if (__evtC${i} !== null) (s.evtCleanups ?? (s.evtCleanups = [])).push(__evtC${i})`,
    )
  }

  // Children: either inline-build (text-like case) or recurse into element
  // children whose subtrees were baked into innerHTML.
  const childKinds = childKindsOf(plan.children)
  const preBake = canPreBakeText(plan)
  const inlineChildren = childKinds.hasDynamicText && !preBake
  if (preBake) {
    // The placeholder space we baked into innerHTML cloned with the row.
    // Walk to it directly and overwrite its nodeValue on initial render.
    const child = plan.children[0] as { kind: "dynamic-text"; fnSource: string }
    const i = ctx.textIdx++
    const fnName = `__sdom_textFn_${ctx.siteId}_${i}`
    ctx.moduleScopeLines.push(`const ${fnName} = ${child.fnSource}`)
    ctx.stateInitProps.push(`    textNode${i}: undefined,`)
    ctx.stateInitProps.push(`    textLast${i}: undefined,`)
    ctx.setupLines.push(`  s.textNode${i} = ${elPath}.firstChild`)
    ctx.setupLines.push(`  s.textLast${i} = ${fnName}(initialModel)`)
    ctx.setupLines.push(`  s.textNode${i}.nodeValue = String(s.textLast${i})`)
    ctx.updateLines.push(`  const __textV${i} = ${fnName}(next)`)
    ctx.updateLines.push(`  if (__textV${i} !== s.textLast${i}) {`)
    ctx.updateLines.push(`    s.textLast${i} = __textV${i}`)
    ctx.updateLines.push(`    s.textNode${i}.nodeValue = String(__textV${i})`)
    ctx.updateLines.push(`  }`)
  } else if (inlineChildren) {
    for (const child of plan.children) {
      if (child.kind === "static-text") {
        ctx.setupLines.push(
          `  ${elPath}.appendChild(document.createTextNode(${JSON.stringify(child.text)}))`,
        )
      } else if (child.kind === "dynamic-text") {
        const i = ctx.textIdx++
        const fnName = `__sdom_textFn_${ctx.siteId}_${i}`
        ctx.moduleScopeLines.push(`const ${fnName} = ${child.fnSource}`)
        ctx.stateInitProps.push(`    textNode${i}: undefined,`)
        ctx.stateInitProps.push(`    textLast${i}: undefined,`)
        ctx.setupLines.push(
          `  s.textNode${i} = ${elPath}.appendChild(document.createTextNode(""))`,
        )
        ctx.setupLines.push(`  s.textLast${i} = ${fnName}(initialModel)`)
        ctx.setupLines.push(`  s.textNode${i}.nodeValue = String(s.textLast${i})`)
        ctx.updateLines.push(`  const __textV${i} = ${fnName}(next)`)
        ctx.updateLines.push(`  if (__textV${i} !== s.textLast${i}) {`)
        ctx.updateLines.push(`    s.textLast${i} = __textV${i}`)
        ctx.updateLines.push(`    s.textNode${i}.nodeValue = String(__textV${i})`)
        ctx.updateLines.push(`  }`)
      }
    }
  } else {
    // Walker chain: each bound child gets aliased to a `__el_N` const, and
    // the next sibling walks from that alias rather than re-traversing
    // `firstChild.nextSibling.nextSibling...` from the parent. This keeps
    // the chain length per row bounded to one `.nextSibling` per child
    // instead of growing linearly with sibling index.
    let cursor: string | null = null
    for (const child of plan.children) {
      const childPathExpr: string =
        cursor === null ? `${elPath}.firstChild` : `${cursor}.nextSibling`
      if (child.kind === "element" && elementNeedsWork(child.plan)) {
        const aliasIdxBefore = ctx.elIdx
        bindElement(child.plan, childPathExpr, ctx)
        // bindElement allocates `__el_{aliasIdxBefore}` as the first thing
        // it does for any non-root element with work, so a bumped counter
        // means we can use that alias as the cursor for the next sibling.
        cursor = ctx.elIdx > aliasIdxBefore
          ? `__el_${aliasIdxBefore}`
          : childPathExpr
      } else {
        // Pure-static element or static text: no alias allocated. Keep
        // extending the chain so the next bound sibling sees the right node.
        cursor = childPathExpr
      }
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
  // element will create its children inline. The prebake-text shortcut
  // bakes a placeholder text node directly so cloneNode produces it,
  // saving one createTextNode + appendChild per row at mount time.
  const kinds = childKindsOf(plan.children)
  const preBake = canPreBakeText(plan)
  const inlineChildren = kinds.hasDynamicText && !preBake
  if (preBake) {
    ctx.htmlParts.push(" ")
  } else if (!inlineChildren) {
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
    `import { compiled as ${COMPILED_IMPORT_NAME}, compiledState as ${COMPILED_STATE_IMPORT_NAME}, delegateEvent as ${DELEGATE_EVENT_IMPORT_NAME} } from "${COMPILED_IMPORT_SPECIFIER}"\n`
  const hoisted = sites.map(s => s.hoistedCode).join("\n\n") + "\n\n"
  return importLine + hoisted + out
}
