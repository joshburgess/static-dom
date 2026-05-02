/**
 * shared.ts — Shared utilities for all templating approaches.
 *
 * Prop classification, child normalization, and compilable spec types
 * extracted from jsx-runtime.ts for reuse by hyperscript, HTM, and
 * lit-html style modules.
 */

import { text, staticText, ATTR_TO_PROP } from "./constructors"
import type { SDOM } from "./types"

// ---------------------------------------------------------------------------
// Erased SDOM type — used at JSX/template boundaries where Model and Msg
// are not statically known. Analogous to React.ReactElement's use of `any`.
// This is the ONLY place in the codebase where `any` is used for SDOM types.
// ---------------------------------------------------------------------------

/** Type-erased SDOM used at JSX/template boundaries where Model and Msg are not statically known. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ErasedSDOM = SDOM<any, any>

// ---------------------------------------------------------------------------
// IDL properties — routed to `attrs` for direct property assignment
// ---------------------------------------------------------------------------

/** Set of HTML IDL property names that should be set via direct property assignment. */
export const IDL_PROPS = new Set([
  // Form elements
  "value", "checked", "disabled", "readOnly", "multiple", "selected",
  "defaultValue", "defaultChecked", "indeterminate",
  // Common
  "type", "href", "src", "alt", "placeholder", "title",
  "id", "name", "target", "rel",
  "min", "max", "step", "pattern", "required",
  "autoFocus", "autoComplete", "autoPlay",
  "width", "height", "hidden",
  "tabIndex", "htmlFor", "contentEditable",
  "draggable", "spellCheck",
  // Media
  "controls", "loop", "muted", "volume", "currentTime",
  "playbackRate", "preload", "poster",
  // Table
  "colSpan", "rowSpan",
  // Form
  "action", "method", "encType", "noValidate",
  "accept", "acceptCharset",
  "open", "wrap", "cols", "rows",
  "download", "ping", "referrerPolicy",
  "sandbox", "allow", "loading",
  "integrity", "crossOrigin",
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Regex matching event handler prop names like `onClick`, `onInput`. */
export const EVENT_RE = /^on[A-Z]/

/** Convert a camelCase string to kebab-case (e.g. `backgroundColor` → `background-color`). */
export function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, m => "-" + m.toLowerCase())
}

/**
 * Symbol marking a constant function created by ensureFn.
 * The value is stored as fn[STATIC_VALUE], enabling template engines
 * to bake static values into HTML strings at build time.
 */
export const STATIC_VALUE = Symbol("sdom.staticValue")

/** Check if a function was created by ensureFn with a static value. */
export function isStaticFn(fn: Function): boolean {
  return STATIC_VALUE in fn
}

/** A function branded with a static value by ensureFn. */
interface StaticFnBrand {
  [STATIC_VALUE]: unknown
}

/** Get the static value from a function marked by ensureFn. */
export function staticValueOf(fn: Function): unknown {
  return (fn as unknown as StaticFnBrand)[STATIC_VALUE]
}

/** Wrap a static value in a constant function, or return an existing function as-is. */
export function ensureFn<T>(v: T | ((...args: unknown[]) => T)): (...args: unknown[]) => T {
  if (typeof v === "function") return v as (...args: unknown[]) => T
  const fn = (() => v) as ((...args: unknown[]) => T) & StaticFnBrand
  fn[STATIC_VALUE] = v
  return fn
}

/** Check whether a value is an SDOM node (has an `attach` method). */
export function isSDOMNode(x: unknown): boolean {
  return x !== null && typeof x === "object" && "attach" in x &&
    typeof (x as { attach: unknown }).attach === "function"
}

// ---------------------------------------------------------------------------
// Prop classification
// ---------------------------------------------------------------------------

/** Classify a JSX/hyperscript props object into attrs, rawAttrs, on, style, and classes. */
export function classifyProps(props: Record<string, unknown>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  const rawAttrs: Record<string, unknown> = {}
  const on: Record<string, unknown> = {}
  let style: Record<string, unknown> | undefined
  let classes: unknown

  for (const key in props) {
    if (key === "children" || key === "key") continue

    const val = props[key]

    if (key === "classes") {
      classes = val
      continue
    }

    if (EVENT_RE.test(key)) {
      const eventName = key[2]!.toLowerCase() + key.slice(3)
      on[eventName] = val
      continue
    }

    if (key === "style" && typeof val === "object" && val !== null) {
      style = {}
      const styleObj = val as Record<string, unknown>
      for (const k in styleObj) {
        style[camelToKebab(k)] = ensureFn(styleObj[k])
      }
      continue
    }

    if (key === "class" || key === "className") {
      rawAttrs["class"] = ensureFn(val)
      continue
    }

    if (key.startsWith("data-") || key.startsWith("aria-")) {
      rawAttrs[key] = ensureFn(val)
      continue
    }

    if (IDL_PROPS.has(key)) {
      attrs[key] = ensureFn(val)
      continue
    }

    // Default: rawAttrs (safe fallback via setAttribute)
    rawAttrs[key] = ensureFn(val)
  }

  const result: Record<string, unknown> = {}
  if (Object.keys(attrs).length > 0) result.attrs = attrs
  if (Object.keys(rawAttrs).length > 0) result.rawAttrs = rawAttrs
  if (Object.keys(on).length > 0) result.on = on
  if (style !== undefined) result.style = style
  if (classes !== undefined) result.classes = classes
  return result
}

// ---------------------------------------------------------------------------
// Children normalization
// ---------------------------------------------------------------------------

/** Normalize a single child value into an SDOM node, or null if skippable. */
export function normalizeChild(child: unknown): ErasedSDOM | null {
  if (child === null || child === undefined || typeof child === "boolean") return null
  if (isSDOMNode(child)) return child as ErasedSDOM
  if (typeof child === "function") return text(child as (m: unknown) => string)
  if (typeof child === "string") return staticText(child)
  if (typeof child === "number") return staticText(String(child))
  return null
}

/** Normalize a children value (single or array) into an array of SDOM nodes. */
export function normalizeChildren(children: unknown): ErasedSDOM[] {
  if (children === undefined || children === null) return []
  if (Array.isArray(children)) {
    const result: ErasedSDOM[] = []
    for (const child of children) {
      const node = normalizeChild(child)
      if (node !== null) result.push(node)
    }
    return result
  }
  const node = normalizeChild(children)
  return node !== null ? [node] : []
}

// ---------------------------------------------------------------------------
// Compilable spec types
// ---------------------------------------------------------------------------

/** Symbol marking an SDOM node as carrying a compilable template spec. */
export const _TEMPLATE_SPEC = Symbol("sdom.templateSpec")

/** A compilable template spec produced by JSX/hyperscript prop classification. */
export interface JsxSpec {
  tag: string
  classified: Record<string, unknown>
  children: JsxChildSpec[]
}

/** A classified child within a JsxSpec — static text, dynamic text, or nested element. */
export type JsxChildSpec =
  | { kind: "static"; text: string }
  | { kind: "dynamic"; fn: (m: unknown) => string }
  | { kind: "element"; spec: JsxSpec }

/**
 * Try to build compilable child specs from raw children.
 * Returns null if any child is not compilable (e.g., a pre-existing SDOM node).
 */
export function tryBuildChildSpecs(children: unknown): JsxChildSpec[] | null {
  if (children === undefined || children === null) return []

  if (Array.isArray(children)) {
    const specs: JsxChildSpec[] = []
    for (const child of children) {
      const spec = tryBuildChildSpec(child)
      if (spec === null) return null // not compilable
      if (spec !== false) specs.push(spec)
    }
    return specs
  }

  const spec = tryBuildChildSpec(children)
  if (spec === null) return null
  if (spec === false) return []
  return [spec]
}

/**
 * Try to classify a single child for compilation.
 * Returns false for skippable children (null/undefined/boolean),
 * null for non-compilable children, or a JsxChildSpec.
 */
export function tryBuildChildSpec(child: unknown): JsxChildSpec | null | false {
  if (child === null || child === undefined || typeof child === "boolean") return false
  if (typeof child === "string") return { kind: "static", text: child }
  if (typeof child === "number") return { kind: "static", text: String(child) }
  if (typeof child === "function") return { kind: "dynamic", fn: child as (m: unknown) => string }
  if (isSDOMNode(child) && _TEMPLATE_SPEC in (child as object)) {
    return { kind: "element", spec: (child as Record<symbol, JsxSpec>)[_TEMPLATE_SPEC]! }
  }
  return null // opaque SDOM node — not compilable
}
