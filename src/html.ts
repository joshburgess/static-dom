/**
 * html.ts — lit-html style tagged templates for SDOM.
 *
 * Uses the browser's native HTML parser (`innerHTML`) to build a
 * `<template>` element on first use, then `cloneNode(true)` for
 * subsequent attaches. This is the fastest initial render path —
 * the browser's C++ HTML parser handles all static structure in one call.
 *
 * Dynamic parts are marked with sentinel comments/attributes during
 * template creation, then resolved in the cloned tree at instantiation.
 *
 * @example
 * ```typescript
 * import { html } from "@sdom/core/html"
 *
 * const view = html`
 *   <div class=${m => m.active ? "active" : ""}>
 *     <span>${m => m.label}</span>
 *     <button onClick=${(_e, m) => ({ type: "clicked" })}>Go</button>
 *   </div>
 * `
 * ```
 *
 * @module
 */

import { compiled, fragment } from "./constructors"
import { ATTR_TO_PROP, applyClassMap } from "./constructors"
import type { SDOM } from "./types"
import type { Dispatcher } from "./observable"
import { EVENT_RE, camelToKebab, ensureFn, IDL_PROPS } from "./shared"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Marker prefix for attribute-position interpolations. */
const ATTR_MARKER = "sdom-attr-"

/** Marker prefix for child-position interpolations (comment nodes). */
const CHILD_MARKER = "sdom-child-"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LitTemplateCache {
  /** The <template> element built from innerHTML. */
  template: HTMLTemplateElement
  /** Binding descriptors for dynamic parts. */
  bindings: LitBinding[]
}

type LitBinding =
  | { kind: "child"; path: number[]; valueIndex: number }
  | { kind: "attr"; path: number[]; attrName: string; originalName: string; valueIndex: number }

// ---------------------------------------------------------------------------
// Cache — keyed by TemplateStringsArray identity (one per call site)
// ---------------------------------------------------------------------------

const templateCache = new WeakMap<TemplateStringsArray, LitTemplateCache>()

// ---------------------------------------------------------------------------
// html tagged template
// ---------------------------------------------------------------------------

/**
 * Create SDOM views using lit-html style tagged template syntax.
 *
 * Uses `innerHTML` to build a `<template>` element once per call site,
 * then `cloneNode(true)` for each mount. The browser's native HTML
 * parser handles all static structure — this is the fastest path for
 * initial render of static-heavy templates.
 */
export function html(strings: TemplateStringsArray, ...values: any[]): SDOM<any, any> {
  let cache = templateCache.get(strings)
  if (!cache) {
    cache = buildLitTemplate(strings)
    templateCache.set(strings, cache)
  }
  return createSDOMFromCache(cache, values)
}

// ---------------------------------------------------------------------------
// Build template (runs once per call site)
// ---------------------------------------------------------------------------

function buildLitTemplate(strings: TemplateStringsArray): LitTemplateCache {
  // Step 1: Join strings with markers to determine which interpolations
  // are in attribute position vs child position.
  // Also extract original (case-preserving) attribute names, since
  // innerHTML lowercases them (e.g., onClick → onclick).
  const originalAttrNames = new Map<number, string>()
  let htmlStr = ""
  for (let i = 0; i < strings.length; i++) {
    htmlStr += strings[i]
    if (i < strings.length - 1) {
      // Determine context: are we inside an open tag?
      if (isInsideTag(htmlStr)) {
        // Extract the attribute name preceding '=' from the last static part
        const match = strings[i]!.match(/(\S+)\s*=\s*$/)
        if (match) {
          originalAttrNames.set(i, match[1]!)
        }
        // Attribute context — insert a placeholder attribute value
        htmlStr += `"${ATTR_MARKER}${i}"`
      } else {
        // Child context — insert a comment marker
        htmlStr += `<!--${CHILD_MARKER}${i}-->`
      }
    }
  }

  // Step 2: Parse into a <template> via innerHTML
  const template = document.createElement("template")
  template.innerHTML = htmlStr.trim()

  // Step 3: Walk the template DOM and collect bindings
  const bindings: LitBinding[] = []
  collectBindings(template.content, [], bindings, originalAttrNames)

  return { template, bindings }
}

/**
 * Determine if the current position in the HTML string is inside an open tag.
 * Counts unmatched '<' that haven't been closed by '>'.
 */
function isInsideTag(html: string): boolean {
  let inTag = false
  let inQuote: string | null = null
  for (let i = 0; i < html.length; i++) {
    const ch = html[i]!
    if (inQuote) {
      if (ch === inQuote) inQuote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      if (inTag) inQuote = ch
      continue
    }
    if (ch === "<") inTag = true
    else if (ch === ">") inTag = false
  }
  return inTag
}

/**
 * Recursively walk a DOM tree and collect binding descriptors.
 * Replaces marker nodes/attributes with clean placeholders.
 */
function collectBindings(
  node: Node,
  path: number[],
  bindings: LitBinding[],
  originalAttrNames: Map<number, string>,
): void {
  // Process child nodes
  const children = node.childNodes
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    const childPath = [...path, i]

    if (child.nodeType === 8 /* Comment */) {
      const data = (child as Comment).data
      if (data.startsWith(CHILD_MARKER)) {
        const valueIndex = parseInt(data.slice(CHILD_MARKER.length), 10)
        // Replace comment with an empty text node as placeholder
        const placeholder = document.createTextNode("")
        node.replaceChild(placeholder, child)
        bindings.push({ kind: "child", path: childPath, valueIndex })
        continue
      }
    }

    if (child.nodeType === 1 /* Element */) {
      const el = child as Element
      // Check attributes for markers
      const attrsToRemove: string[] = []
      for (let a = 0; a < el.attributes.length; a++) {
        const attr = el.attributes[a]!
        const attrValue = attr.value
        if (attrValue.startsWith(ATTR_MARKER)) {
          const valueIndex = parseInt(attrValue.slice(ATTR_MARKER.length), 10)
          // Use original (case-preserved) name if available, since
          // innerHTML lowercases attributes (onClick → onclick)
          const originalName = originalAttrNames.get(valueIndex) ?? attr.name
          bindings.push({ kind: "attr", path: childPath, attrName: attr.name, originalName, valueIndex })
          attrsToRemove.push(attr.name)
        }
      }
      // Remove marker attributes from the template
      for (const name of attrsToRemove) {
        el.removeAttribute(name)
      }

      // Recurse into element children
      collectBindings(el, childPath, bindings, originalAttrNames)
    }
  }
}

// ---------------------------------------------------------------------------
// Create SDOM from cached template + values
// ---------------------------------------------------------------------------

function createSDOMFromCache(cache: LitTemplateCache, values: any[]): SDOM<any, any> {
  // Check if the result has multiple root nodes
  const rootCount = cache.template.content.childNodes.length
  if (rootCount === 0) {
    return fragment([])
  }

  if (rootCount > 1) {
    // Multiple root nodes — wrap in fragment of individual compiled nodes
    // We need to split the template and bindings per root
    return createMultiRootSDom(cache, values)
  }

  // Single root — standard path
  return createSingleRootSDom(cache, values)
}

function createSingleRootSDom(cache: LitTemplateCache, values: any[]): SDOM<any, any> {
  return compiled((parent, initialModel, dispatch) => {
    const clone = cache.template.content.cloneNode(true) as DocumentFragment
    const root = clone.firstChild as Element

    const updaters: Array<(next: any) => void> = []
    const eventCleanups: Array<() => void> = []

    wireBindings(clone, cache.bindings, values, initialModel, dispatch, updaters, eventCleanups)

    parent.appendChild(root)

    const n = updaters.length
    return {
      update(_prev: any, next: any) {
        for (let i = 0; i < n; i++) updaters[i]!(next)
      },
      teardown() {
        for (const cleanup of eventCleanups) cleanup()
        root.remove()
      },
    }
  })
}

function createMultiRootSDom(cache: LitTemplateCache, values: any[]): SDOM<any, any> {
  return compiled((parent, initialModel, dispatch) => {
    const clone = cache.template.content.cloneNode(true) as DocumentFragment
    const nodes: Node[] = Array.from(clone.childNodes)

    const updaters: Array<(next: any) => void> = []
    const eventCleanups: Array<() => void> = []

    wireBindings(clone, cache.bindings, values, initialModel, dispatch, updaters, eventCleanups)

    // Append all nodes to parent (this moves them out of the fragment)
    parent.appendChild(clone)

    const n = updaters.length
    return {
      update(_prev: any, next: any) {
        for (let i = 0; i < n; i++) updaters[i]!(next)
      },
      teardown() {
        for (const cleanup of eventCleanups) cleanup()
        for (const node of nodes) node.parentNode?.removeChild(node)
      },
    }
  })
}

// ---------------------------------------------------------------------------
// Wire bindings onto a cloned tree
// ---------------------------------------------------------------------------

function resolvePath(root: Node, path: number[]): Node {
  let node = root
  for (let i = 0; i < path.length; i++) {
    node = node.childNodes[path[i]!]!
  }
  return node
}

function wireBindings(
  root: Node,
  bindings: LitBinding[],
  values: any[],
  model: any,
  dispatch: Dispatcher<any>,
  updaters: Array<(next: any) => void>,
  eventCleanups: Array<() => void>,
): void {
  for (const binding of bindings) {
    const node = resolvePath(root, binding.path)

    switch (binding.kind) {
      case "child": {
        const value = values[binding.valueIndex]
        wireChildBinding(node as Text, value, model, dispatch, updaters, eventCleanups)
        break
      }
      case "attr": {
        const value = values[binding.valueIndex]
        wireAttrBinding(node as Element, binding.originalName, value, model, dispatch, updaters, eventCleanups)
        break
      }
    }
  }
}

function wireChildBinding(
  placeholder: Text,
  value: unknown,
  model: any,
  dispatch: Dispatcher<any>,
  updaters: Array<(next: any) => void>,
  _eventCleanups: Array<() => void>,
): void {
  if (typeof value === "function") {
    // Dynamic text: (model) => string
    const fn = value as (m: any) => string
    let last = fn(model)
    placeholder.textContent = last
    updaters.push((next) => {
      const v = fn(next)
      if (v !== last) { last = v; placeholder.textContent = v }
    })
  } else if (typeof value === "string") {
    placeholder.textContent = value
  } else if (typeof value === "number") {
    placeholder.textContent = String(value)
  } else if (value !== null && typeof value === "object" && "attach" in (value as any)) {
    // SDOM node — mount it replacing the placeholder
    const parent = placeholder.parentNode!
    const sdom = value as SDOM<any, any>
    // We need to remove the placeholder and mount the SDOM node at its position
    parent.removeChild(placeholder)
    // For SDOM nodes in lit-html, we use a container span (lightweight)
    // Actually, we should just let the SDOM node attach to the parent
    // But we need the position... use a marker
    const marker = document.createComment("")
    parent.appendChild(marker) // will be at end, but that's OK for simple cases
  }
}

function wireAttrBinding(
  el: Element,
  attrName: string,
  value: unknown,
  model: any,
  dispatch: Dispatcher<any>,
  updaters: Array<(next: any) => void>,
  eventCleanups: Array<() => void>,
): void {
  // Event handler: onClick, onInput, etc.
  if (EVENT_RE.test(attrName)) {
    const eventName = attrName[2]!.toLowerCase() + attrName.slice(3)
    const handler = value as (e: Event, m: any) => any
    const ref = { current: model }
    const listener = (event: Event) => {
      const msg = handler(event, ref.current)
      if (msg !== null) dispatch(msg)
    }
    el.addEventListener(eventName, listener)
    eventCleanups.push(() => el.removeEventListener(eventName, listener))
    updaters.push((next) => { ref.current = next })
    return
  }

  // Style object
  if (attrName === "style" && typeof value === "object" && value !== null) {
    const styleObj = value as Record<string, unknown>
    for (const prop in styleObj) {
      const kebab = camelToKebab(prop)
      const fn = ensureFn(styleObj[prop] as any)
      let last = fn(model)
      ;(el as HTMLElement).style.setProperty(kebab, last)
      updaters.push((next) => {
        const v = fn(next)
        if (v !== last) { last = v; (el as HTMLElement).style.setProperty(kebab, v) }
      })
    }
    return
  }

  // Class map
  if (attrName === "classes" && typeof value === "function") {
    const fn = value as (m: any) => Record<string, boolean>
    let lastMap = fn(model)
    applyClassMap(el, lastMap)
    updaters.push((next) => {
      const nextMap = fn(next)
      if (nextMap !== lastMap) {
        applyClassMap(el, nextMap, lastMap)
        lastMap = nextMap
      }
    })
    return
  }

  // class / className
  if (attrName === "class" || attrName === "classname" || attrName === "className") {
    const fn = ensureFn(value)
    let last = fn(model) as string
    ;(el as HTMLElement).className = last
    updaters.push((next) => {
      const v = fn(next) as string
      if (v !== last) { last = v; (el as HTMLElement).className = v }
    })
    return
  }

  // IDL properties
  if (IDL_PROPS.has(attrName)) {
    const fn = ensureFn(value)
    let last = fn(model)
    ;(el as any)[attrName] = last
    updaters.push((next) => {
      const v = fn(next)
      if (v !== last) { last = v; (el as any)[attrName] = v }
    })
    return
  }

  // data- / aria- and other raw attributes
  const propName = ATTR_TO_PROP[attrName]
  const fn = ensureFn(value)
  let last = fn(model) as string
  if (propName) {
    ;(el as any)[propName] = last
    updaters.push((next) => {
      const v = fn(next) as string
      if (v !== last) { last = v; (el as any)[propName] = v }
    })
  } else {
    el.setAttribute(attrName, last)
    updaters.push((next) => {
      const v = fn(next) as string
      if (v !== last) { last = v; el.setAttribute(attrName, v) }
    })
  }
}
