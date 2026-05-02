/**
 * jsx-runtime.ts — SDOM JSX runtime
 *
 * Implements the automatic JSX runtime interface that esbuild/TypeScript
 * call when transforming JSX with `jsx: "automatic"` and
 * `jsxImportSource: "static-dom"`.
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

import { element, fragment, compiled, array, optional, ATTR_TO_PROP, applyClassMap } from "./constructors"
import type { SDOM, KeyedItem } from "./types"
import type { Prism, Affine } from "./optics"
import type { Dispatcher } from "./observable"
import {
  classifyProps, normalizeChildren, tryBuildChildSpecs,
  _TEMPLATE_SPEC,
  type ErasedSDOM,
  type JsxSpec,
} from "./shared"
import { buildTemplate, instantiateTemplate, type TemplateCache } from "./template"
import { registerEvent } from "./delegation"

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

/** Symbol used as the JSX element type for `<></>` fragments. */
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

/**
 * Build a compiled() SDOM node from a JsxSpec.
 *
 * Default: uses direct createElement chains with a single fused observer.
 * Each attach creates elements imperatively — faster for simple/dynamic
 * templates (no path resolution overhead).
 *
 * Skips event cleanup array allocation when the spec has no events.
 */
export function compileSpec(spec: JsxSpec): ErasedSDOM {
  // Pre-check once: does this spec tree contain any events?
  const hasEvents = specHasEvents(spec)

  return compiled((parent, initialModel, dispatch) => {
    const updaters: Array<(next: unknown) => void> = []
    const eventCleanups: Array<() => void> | null = hasEvents ? [] : null
    const el = buildSpecElement(spec, initialModel, dispatch, updaters, eventCleanups)
    parent.appendChild(el)

    const n = updaters.length
    return {
      update(_prev, next) {
        for (let i = 0; i < n; i++) updaters[i]!(next)
      },
      teardown() {
        if (eventCleanups) {
          for (let i = 0; i < eventCleanups.length; i++) eventCleanups[i]!()
        }
        el.remove()
      },
    }
  })
}

function specHasEvents(spec: JsxSpec): boolean {
  if (spec.classified.on) return true
  for (const child of spec.children) {
    if (child.kind === "element" && specHasEvents(child.spec)) return true
  }
  return false
}

/**
 * Build a compiled() SDOM node using template cloning.
 *
 * First attach builds a `<template>` element from the spec, subsequent
 * attaches clone it via `cloneNode(true)`. Faster for complex, static-heavy
 * templates where the cloneNode savings outweigh the path resolution cost.
 *
 * Use this explicitly for templates with many static elements and few
 * dynamic bindings.
 */
export function compileSpecCloned(spec: JsxSpec): ErasedSDOM {
  let cache: TemplateCache | null = null

  return compiled((parent, initialModel, dispatch) => {
    if (!cache) cache = buildTemplate(spec)

    const updaters: Array<(next: unknown) => void> = []
    const eventCleanups: Array<() => void> = []
    const el = instantiateTemplate(cache, initialModel, dispatch, updaters, eventCleanups)
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

// ---------------------------------------------------------------------------
// buildSpecElement — direct createElement implementation
// ---------------------------------------------------------------------------

function buildSpecElement(
  spec: JsxSpec,
  model: unknown,
  dispatch: Dispatcher<unknown>,
  updaters: Array<(next: unknown) => void>,
  eventCleanups: Array<() => void> | null,
): Element {
  const el = document.createElement(spec.tag)
  const c = spec.classified

  // IDL properties
  if (c.attrs) {
    const elAny = el as unknown as Record<string, unknown>
    for (const [name, fn] of Object.entries(c.attrs as Record<string, (m: unknown) => unknown>)) {
      let last = fn(model)
      elAny[name] = last
      updaters.push((next) => {
        const v = fn(next)
        if (v !== last) { last = v; elAny[name] = v }
      })
    }
  }

  // Raw attributes
  if (c.rawAttrs) {
    const elAny = el as unknown as Record<string, unknown>
    for (const [name, fn] of Object.entries(c.rawAttrs as Record<string, (m: unknown) => string>)) {
      const propName = ATTR_TO_PROP[name]
      let last = fn(model)
      if (propName) {
        elAny[propName] = last
        updaters.push((next) => {
          const v = fn(next)
          if (v !== last) { last = v; elAny[propName] = v }
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
    for (const [prop, fn] of Object.entries(c.style as Record<string, (m: unknown) => string>)) {
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
    const fn = c.classes as (m: unknown) => Record<string, boolean>
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
        const msg = (handler as (e: Event, m: unknown) => unknown)(event, ref.current)
        if (msg !== null) dispatch(msg)
      }
      eventCleanups!.push(registerEvent(el, eventName, listener))
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
        const fn = child.fn
        let last = fn(model)
        const textNode = document.createTextNode(last)
        el.appendChild(textNode)
        updaters.push((next) => {
          const v = fn(next)
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

/**
 * JSX automatic runtime entry point.
 * Called by the compiler for single-child elements.
 */
export function jsx(
  type: string | symbol | ((props: Record<string, unknown>) => ErasedSDOM),
  props: Record<string, unknown>,
  _key?: string,
): ErasedSDOM {
  // Fragment
  if (type === Fragment) {
    return fragment(normalizeChildren(props.children))
  }

  // Function component (Show, For, Optional, or user-defined)
  if (typeof type === "function") {
    return (type as (props: Record<string, unknown>) => ErasedSDOM)(props)
  }

  // At this point type is string | symbol — only strings are valid element tags
  const tag = type as string

  // Try to build a compiled template when all children are compilable
  const childSpecs = tryBuildChildSpecs(props.children)
  if (childSpecs !== null) {
    const classified = classifyProps(props)
    const spec: JsxSpec = { tag, classified, children: childSpecs }
    const sdom = compileSpecCloned(spec)
    ;(sdom as ErasedSDOM & Record<symbol, unknown>)[_TEMPLATE_SPEC] = spec
    return sdom
  }

  // Fall back to element() when children include opaque SDOM nodes
  const attrInput = classifyProps(props)
  const children = normalizeChildren(props.children)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- element() requires specific tag/attr types; dynamic JSX dispatch erases them
  return element(tag as any, attrInput as any, children)
}

export { jsx as jsxs }

// ---------------------------------------------------------------------------
// Built-in JSX components
// ---------------------------------------------------------------------------

/**
 * Assert Model and Msg types on an SDOM node built from JSX.
 *
 * JSX intrinsic elements erase Model/Msg to `any` (same trade-off as
 * Solid.js). Use `typed()` at the boundary to recover type safety:
 *
 * @example
 * ```tsx
 * const view = typed<Model, Msg>(
 *   <div class={m => m.active ? "active" : ""}>
 *     <span>{m => m.label}</span>
 *   </div>
 * )
 * // view: SDOM<Model, Msg>
 * ```
 */
export function typed<M, Msg = never>(sdom: ErasedSDOM): SDOM<M, Msg> {
  return sdom as SDOM<M, Msg>
}

type SDOMChild =
  | ErasedSDOM
  | ((model: unknown) => string)
  | string
  | number
  | boolean
  | null
  | undefined

/**
 * Conditionally show/hide content based on a model predicate.
 * Uses `display: none` toggling — DOM nodes are always mounted.
 *
 * @example
 * ```tsx
 * <Show when={(m: Model) => m.visible}>
 *   <div>Visible content</div>
 * </Show>
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Public JSX component: M defaults to `any` so users don't need explicit type args
export function Show<M = any>(props: {
  when: (model: M) => boolean
  children?: SDOMChild | SDOMChild[]
}): ErasedSDOM {
  const children = normalizeChildren(props.children)
  const inner = children.length === 1 ? children[0]! : fragment(children)
  return inner.showIf(props.when) as ErasedSDOM
}

/**
 * Render a keyed list of items.
 *
 * @example
 * ```tsx
 * <For each={(m: Model) => m.todos.map(t => ({ key: t.id, model: t }))} tag="ul">
 *   <li>{(m: Todo) => m.text}</li>
 * </For>
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Public JSX component: M/Item default to `any` for inference
export function For<M = any, Item = any>(props: {
  each: (model: M) => KeyedItem<Item>[]
  children?: SDOMChild | SDOMChild[]
  tag?: string
}): ErasedSDOM {
  const children = normalizeChildren(props.children)
  const itemTemplate = children.length === 1 ? children[0]! : fragment(children)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- array() requires concrete types; JSX erases them
  return array(
    (props.tag ?? "div") as keyof HTMLElementTagNameMap,
    props.each as (model: any) => KeyedItem<any>[],
    itemTemplate,
  ) as ErasedSDOM
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Public JSX component: S/A default to `any` for inference
export function Optional<S = any, A = any>(props: {
  prism: Prism<S, A> | Affine<S, A>
  children?: SDOMChild | SDOMChild[]
}): ErasedSDOM {
  const children = normalizeChildren(props.children)
  const inner = children.length === 1 ? children[0]! : fragment(children)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional() requires concrete types; JSX erases them
  return optional(props.prism as Prism<any, any>, inner) as ErasedSDOM
}

// ---------------------------------------------------------------------------
// JSX type namespace
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// JSX type namespace — public-facing types
//
// `any` is required in these types for variance: user-provided functions like
// `(m: MyModel) => m.name` must be assignable to the prop types. Using
// `unknown` would break this because (m: MyModel) => T is not assignable
// to (m: unknown) => T due to contravariance.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Variance: user functions (m: M) => T must be assignable
type AttrValue<T> = ((model: any) => T) | T

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Variance: user event handlers must be assignable
type EventHandler<E extends Event = Event> =
  (event: E, model: any) => unknown | null

/** Writable, non-method properties of an element interface. */
type WritableProps<El> = {
  [K in keyof El as
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for type-level method filtering
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

interface CommonProps {
  class?: AttrValue<string>
  className?: AttrValue<string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Variance: user functions must be assignable
  classes?: (model: any) => Record<string, boolean>
  style?: Record<string, AttrValue<string>>
  children?: SDOMChild | SDOMChild[]
  key?: string
}

interface DataAriaProps {
  [attr: `data-${string}`]: AttrValue<string> | undefined
  [attr: `aria-${string}`]: AttrValue<string> | undefined
}

/** JSX type namespace — defines intrinsic elements and type constraints for JSX expressions. */
export declare namespace JSX {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSX.Element must accept any SDOM (same pattern as React)
  type Element = ErasedSDOM

  type ElementType =
    | keyof IntrinsicElements
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Function components accept any props
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
