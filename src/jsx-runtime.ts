/**
 * jsx-runtime.ts — SDOM JSX runtime
 *
 * Implements the automatic JSX runtime interface that esbuild/TypeScript
 * call when transforming JSX with `jsx: "automatic"` and
 * `jsxImportSource: "@sdom/core"`.
 *
 * esbuild transforms:
 *   <div class={m => m.active ? "active" : ""}>
 *     <span>{m => m.label}</span>
 *   </div>
 *
 * Into:
 *   jsxs("div", { class: m => m.active ? "active" : "", children: [
 *     jsx("span", { children: m => m.label })
 *   ]})
 *
 * This runtime classifies props into SDOM's AttrInput categories
 * and delegates to the existing constructors.
 */

import { element, text, staticText, fragment } from "./constructors"
import type { SDOM } from "./types"

// ---------------------------------------------------------------------------
// IDL properties — routed to `attrs` for direct property assignment
// ---------------------------------------------------------------------------

const IDL_PROPS = new Set([
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

const EVENT_RE = /^on[A-Z]/

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, m => "-" + m.toLowerCase())
}

/** Wrap a static value in a constant function. */
function ensureFn<T>(v: T | ((...args: any[]) => T)): (...args: any[]) => T {
  return typeof v === "function" ? v as (...args: any[]) => T : () => v
}

function isSDOMNode(x: unknown): x is SDOM<any, any> {
  return x !== null && typeof x === "object" && "attach" in x &&
    typeof (x as any).attach === "function"
}

// ---------------------------------------------------------------------------
// Prop classification
// ---------------------------------------------------------------------------

function classifyProps(props: Record<string, unknown>): Record<string, unknown> {
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
      for (const k in val as Record<string, unknown>) {
        const sv = (val as Record<string, unknown>)[k]
        style[camelToKebab(k)] = ensureFn(sv)
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

function normalizeChild(child: unknown): SDOM<any, any> | null {
  if (child === null || child === undefined || typeof child === "boolean") return null
  if (isSDOMNode(child)) return child
  if (typeof child === "function") return text(child as (m: any) => string)
  if (typeof child === "string") return staticText(child)
  if (typeof child === "number") return staticText(String(child))
  return null
}

function normalizeChildren(children: unknown): SDOM<any, any>[] {
  if (children === undefined || children === null) return []
  if (Array.isArray(children)) {
    const result: SDOM<any, any>[] = []
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
// Fragment
// ---------------------------------------------------------------------------

export const Fragment = Symbol.for("sdom.fragment")

// ---------------------------------------------------------------------------
// jsx / jsxs
// ---------------------------------------------------------------------------

export function jsx(
  type: string | symbol,
  props: Record<string, unknown>,
  _key?: string,
): SDOM<any, any> {
  if (type === Fragment) {
    return fragment(normalizeChildren(props.children))
  }

  const attrInput = classifyProps(props)
  const children = normalizeChildren(props.children)
  return element(type as any, attrInput as any, children)
}

export { jsx as jsxs }

// ---------------------------------------------------------------------------
// JSX type namespace
// ---------------------------------------------------------------------------

type AttrValue<T> = ((model: any) => T) | T

type EventHandler<E extends Event = Event> =
  (event: E, model: any) => unknown | null

/** Writable, non-method properties of an element interface. */
type WritableProps<El> = {
  [K in keyof El as
    El[K] extends (...args: any[]) => any ? never :
    K extends string ? K : never
  ]?: El[K] extends string ? AttrValue<string>
    : El[K] extends number ? AttrValue<number>
    : El[K] extends boolean ? AttrValue<boolean>
    : never
}

/** Event handler props: onClick, onInput, etc. */
type EventProps = {
  [K in keyof HTMLElementEventMap as `on${Capitalize<K & string>}`]?:
    EventHandler<HTMLElementEventMap[K]>
}

type SDOMChild =
  | SDOM<any, any>
  | ((model: any) => string)
  | string
  | number
  | boolean
  | null
  | undefined

interface CommonProps {
  class?: AttrValue<string>
  className?: AttrValue<string>
  classes?: (model: any) => Record<string, boolean>
  style?: Record<string, AttrValue<string>>
  children?: SDOMChild | SDOMChild[]
  key?: string
}

interface DataAriaProps {
  [attr: `data-${string}`]: AttrValue<string> | undefined
  [attr: `aria-${string}`]: AttrValue<string> | undefined
}

export declare namespace JSX {
  type Element = SDOM<any, any>

  interface ElementChildrenAttribute {
    children: {}
  }

  type IntrinsicElements = {
    [Tag in keyof HTMLElementTagNameMap]:
      WritableProps<HTMLElementTagNameMap[Tag]> &
      EventProps &
      CommonProps &
      DataAriaProps
  }
}
