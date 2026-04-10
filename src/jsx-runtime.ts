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

import { element, fragment, compiled, array, optional, ATTR_TO_PROP, applyClassMap } from "./constructors"
import type { SDOM, KeyedItem } from "./types"
import type { Prism, Affine } from "./optics"
import type { Dispatcher } from "./observable"
import {
  classifyProps, normalizeChildren, tryBuildChildSpecs,
  _TEMPLATE_SPEC,
  type JsxSpec,
} from "./shared"
import { buildTemplate, instantiateTemplate, type TemplateCache } from "./template"

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

/**
 * Build a compiled() SDOM node from a JsxSpec.
 *
 * Default: uses direct createElement chains with a single fused observer.
 * Each attach creates elements imperatively — faster for simple/dynamic
 * templates (no path resolution overhead).
 *
 * Skips event cleanup array allocation when the spec has no events.
 */
export function compileSpec(spec: JsxSpec): SDOM<any, any> {
  // Pre-check once: does this spec tree contain any events?
  const hasEvents = specHasEvents(spec)

  return compiled((parent, initialModel, dispatch) => {
    const updaters: Array<(next: any) => void> = []
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
export function compileSpecCloned(spec: JsxSpec): SDOM<any, any> {
  let cache: TemplateCache | null = null

  return compiled((parent, initialModel, dispatch) => {
    if (!cache) cache = buildTemplate(spec)

    const updaters: Array<(next: any) => void> = []
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
  model: any,
  dispatch: Dispatcher<any>,
  updaters: Array<(next: any) => void>,
  eventCleanups: Array<() => void> | null,
): Element {
  const el = document.createElement(spec.tag)
  const c = spec.classified

  // IDL properties
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

  // Raw attributes
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
      eventCleanups!.push(() => el.removeEventListener(eventName, listener))
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
    ;(sdom as any)[_TEMPLATE_SPEC] = spec
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
export function typed<M, Msg = never>(sdom: SDOM<any, any>): SDOM<M, Msg> {
  return sdom as SDOM<M, Msg>
}

type SDOMChild =
  | SDOM<any, any>
  | ((model: any) => string)
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
export function Show<M = any>(props: {
  when: (model: M) => boolean
  children?: SDOMChild | SDOMChild[]
}): SDOM<M, any> {
  const children = normalizeChildren(props.children)
  const inner = children.length === 1 ? children[0]! : fragment(children)
  return inner.showIf(props.when) as SDOM<M, any>
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
export function For<M = any, Item = any>(props: {
  each: (model: M) => KeyedItem<Item>[]
  children?: SDOMChild | SDOMChild[]
  tag?: string
}): SDOM<M, any> {
  const children = normalizeChildren(props.children)
  const itemTemplate = children.length === 1 ? children[0]! : fragment(children)
  return array(
    (props.tag ?? "div") as keyof HTMLElementTagNameMap,
    props.each as (model: any) => KeyedItem<any>[],
    itemTemplate,
  ) as SDOM<M, any>
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
export function Optional<S = any, A = any>(props: {
  prism: Prism<S, A> | Affine<S, A>
  children?: SDOMChild | SDOMChild[]
}): SDOM<S, any> {
  const children = normalizeChildren(props.children)
  const inner = children.length === 1 ? children[0]! : fragment(children)
  return optional(props.prism as Prism<any, any>, inner) as SDOM<S, any>
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
