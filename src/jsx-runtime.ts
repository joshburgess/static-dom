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

import { element, text, staticText, fragment, compiled, array, optional, ATTR_TO_PROP, applyClassMap } from "./constructors"
import type { SDOM, KeyedItem } from "./types"
import type { Dispatcher } from "./observable"
import type { Prism } from "./optics"

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
// Compiled template support
//
// When all children of a jsx() call are "compilable" (strings, numbers,
// functions, or other jsx-created elements), we generate a compiled()
// node with a single subscription instead of element() with per-attr
// and per-child subscriptions. This is the JSX equivalent of hand-
// writing a compiled() template.
// ---------------------------------------------------------------------------

const _JSX_SPEC = Symbol("sdom.jsxSpec")

interface JsxSpec {
  tag: string
  classified: Record<string, unknown>
  children: JsxChildSpec[]
}

type JsxChildSpec =
  | { kind: "static"; text: string }
  | { kind: "dynamic"; fn: (m: any) => string }
  | { kind: "element"; spec: JsxSpec }

/**
 * Try to build compilable child specs from raw children.
 * Returns null if any child is not compilable (e.g., a pre-existing SDOM node).
 */
function tryBuildChildSpecs(children: unknown): JsxChildSpec[] | null {
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
function tryBuildChildSpec(child: unknown): JsxChildSpec | null | false {
  if (child === null || child === undefined || typeof child === "boolean") return false
  if (typeof child === "string") return { kind: "static", text: child }
  if (typeof child === "number") return { kind: "static", text: String(child) }
  if (typeof child === "function") return { kind: "dynamic", fn: child as (m: any) => string }
  if (isSDOMNode(child) && (child as any)[_JSX_SPEC] !== undefined) {
    return { kind: "element", spec: (child as any)[_JSX_SPEC] }
  }
  return null // opaque SDOM node — not compilable
}

/**
 * Build a compiled() SDOM node from a JsxSpec.
 * All dynamic values share a single subscription.
 */
function compileSpec(spec: JsxSpec): SDOM<any, any> {
  return compiled((parent, initialModel, dispatch) => {
    const updaters: Array<(next: any) => void> = []
    const eventCleanups: Array<() => void> = []
    const el = buildSpecElement(spec, initialModel, dispatch, updaters, eventCleanups)
    parent.appendChild(el)

    const n = updaters.length
    return {
      update(_prev, next) {
        for (let i = 0; i < n; i++) updaters[i]!(next)
      },
      teardown() {
        for (const cleanup of eventCleanups) cleanup()
        el.remove()
      },
    }
  })
}

/**
 * Recursively build a DOM element from a JsxSpec, collecting update
 * functions and event cleanups along the way.
 */
function buildSpecElement(
  spec: JsxSpec,
  model: any,
  dispatch: Dispatcher<any>,
  updaters: Array<(next: any) => void>,
  eventCleanups: Array<() => void>,
): HTMLElement {
  const el = document.createElement(spec.tag)
  const c = spec.classified

  // IDL properties (attrs — direct property assignment)
  if (c.attrs) {
    for (const [name, fn] of Object.entries(c.attrs as Record<string, (m: any) => any>)) {
      let last = fn(model)
      ;(el as any)[name] = last
      updaters.push((next) => {
        const v = fn(next)
        if (v !== last) { last = v; (el as any)[name] = v }
      })
    }
  }

  // Raw attributes (setAttribute / property reflection)
  if (c.rawAttrs) {
    for (const [name, fn] of Object.entries(c.rawAttrs as Record<string, (m: any) => string>)) {
      const propName = ATTR_TO_PROP[name]
      let last = fn(model)
      if (propName) {
        ;(el as any)[propName] = last
        updaters.push((next) => {
          const v = fn(next)
          if (v !== last) { last = v; (el as any)[propName] = v }
        })
      } else {
        el.setAttribute(name, last)
        updaters.push((next) => {
          const v = fn(next)
          if (v !== last) { last = v; el.setAttribute(name, v) }
        })
      }
    }
  }

  // Style
  if (c.style) {
    for (const [prop, fn] of Object.entries(c.style as Record<string, (m: any) => string>)) {
      let last = fn(model)
      ;(el as HTMLElement).style.setProperty(prop, last)
      updaters.push((next) => {
        const v = fn(next)
        if (v !== last) { last = v; (el as HTMLElement).style.setProperty(prop, v) }
      })
    }
  }

  // Class map
  if (c.classes) {
    const fn = c.classes as (m: any) => Record<string, boolean>
    let lastMap = fn(model)
    applyClassMap(el, lastMap)
    updaters.push((next) => {
      const nextMap = fn(next)
      if (nextMap !== lastMap) {
        applyClassMap(el, nextMap, lastMap)
        lastMap = nextMap
      }
    })
  }

  // Events
  if (c.on) {
    for (const [eventName, handler] of Object.entries(c.on as Record<string, Function>)) {
      const ref = { current: model }
      const listener = (event: Event) => {
        const msg = (handler as (e: Event, m: any) => any)(event, ref.current)
        if (msg !== null) dispatch(msg)
      }
      el.addEventListener(eventName, listener)
      eventCleanups.push(() => el.removeEventListener(eventName, listener))
      updaters.push((next) => { ref.current = next })
    }
  }

  // Children
  for (const child of spec.children) {
    switch (child.kind) {
      case "static":
        el.appendChild(document.createTextNode(child.text))
        break
      case "dynamic": {
        let last = child.fn(model)
        const textNode = document.createTextNode(last)
        el.appendChild(textNode)
        updaters.push((next) => {
          const v = child.fn(next)
          if (v !== last) { last = v; textNode.textContent = v }
        })
        break
      }
      case "element":
        el.appendChild(buildSpecElement(child.spec, model, dispatch, updaters, eventCleanups))
        break
    }
  }

  return el
}

// ---------------------------------------------------------------------------
// jsx / jsxs
// ---------------------------------------------------------------------------

export function jsx(
  type: string | symbol | ((props: Record<string, unknown>) => SDOM<any, any>),
  props: Record<string, unknown>,
  _key?: string,
): SDOM<any, any> {
  // Fragment
  if (type === Fragment) {
    return fragment(normalizeChildren(props.children))
  }

  // Function component (Show, For, Optional, or user-defined)
  if (typeof type === "function") {
    return (type as (props: Record<string, unknown>) => SDOM<any, any>)(props)
  }

  // At this point type is string | symbol — only strings are valid element tags
  const tag = type as string

  // Try to build a compiled template when all children are compilable
  const childSpecs = tryBuildChildSpecs(props.children)
  if (childSpecs !== null) {
    const classified = classifyProps(props)
    const spec: JsxSpec = { tag, classified, children: childSpecs }
    const sdom = compileSpec(spec)
    ;(sdom as any)[_JSX_SPEC] = spec
    return sdom
  }

  // Fall back to element() when children include opaque SDOM nodes
  const attrInput = classifyProps(props)
  const children = normalizeChildren(props.children)
  return element(tag as any, attrInput as any, children)
}

export { jsx as jsxs }

// ---------------------------------------------------------------------------
// Built-in JSX components
// ---------------------------------------------------------------------------

/**
 * Conditionally show/hide content based on a model predicate.
 * Uses `display: none` toggling — DOM nodes are always mounted.
 *
 * @example
 * ```tsx
 * <Show when={m => m.visible}>
 *   <div>Visible content</div>
 * </Show>
 * ```
 */
export function Show(props: {
  when: (model: any) => boolean
  children?: SDOMChild | SDOMChild[]
}): SDOM<any, any> {
  const children = normalizeChildren(props.children)
  const inner = children.length === 1 ? children[0]! : fragment(children)
  return inner.showIf(props.when)
}

/**
 * Render a keyed list of items.
 *
 * @example
 * ```tsx
 * <For each={m => m.todos.map(t => ({ key: t.id, model: t }))} tag="ul">
 *   <li>{m => m.text}</li>
 * </For>
 * ```
 */
export function For(props: {
  each: (model: any) => KeyedItem<any>[]
  children?: SDOMChild | SDOMChild[]
  tag?: string
}): SDOM<any, any> {
  const children = normalizeChildren(props.children)
  const itemTemplate = children.length === 1 ? children[0]! : fragment(children)
  return array(
    (props.tag ?? "div") as keyof HTMLElementTagNameMap,
    props.each,
    itemTemplate,
  )
}

/**
 * Conditionally render content based on a prism. Mounts/unmounts DOM.
 *
 * @example
 * ```tsx
 * <Optional prism={nullablePrism<Model>()("user")}>
 *   <UserProfile />
 * </Optional>
 * ```
 */
export function Optional(props: {
  prism: Prism<any, any>
  children?: SDOMChild | SDOMChild[]
}): SDOM<any, any> {
  const children = normalizeChildren(props.children)
  const inner = children.length === 1 ? children[0]! : fragment(children)
  return optional(props.prism, inner)
}

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

  type ElementType =
    | keyof IntrinsicElements
    | ((props: any) => Element)

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
