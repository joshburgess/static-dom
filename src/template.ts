/**
 * template.ts — Template cloning engine.
 *
 * Separates static DOM structure from dynamic bindings. On first attach,
 * builds a <template> element from a JsxSpec. On subsequent attaches,
 * cloneNode(true) copies the entire subtree in a single native call —
 * 3-5x faster than equivalent createElement chains.
 *
 * Used by compileSpec() in jsx-runtime.ts and by the lit-html style module.
 */

import { ATTR_TO_PROP, applyClassMap } from "./constructors"
import type { Dispatcher } from "./observable"
import type { JsxSpec } from "./shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateCache {
  /** The <template> element with the static DOM skeleton. */
  template: HTMLTemplateElement
  /** Instructions for wiring up dynamic parts after cloneNode. */
  bindings: TemplateBinding[]
}

export type TemplateBinding =
  | { kind: "prop"; path: number[]; name: string; fn: (m: any) => any }
  | { kind: "rawAttr"; path: number[]; name: string; propName: string | undefined; fn: (m: any) => string }
  | { kind: "style"; path: number[]; prop: string; fn: (m: any) => string }
  | { kind: "classMap"; path: number[]; fn: (m: any) => Record<string, boolean> }
  | { kind: "event"; path: number[]; eventName: string; handler: Function }
  | { kind: "dynamicText"; path: number[]; fn: (m: any) => string }

// ---------------------------------------------------------------------------
// Build template (runs once per spec)
// ---------------------------------------------------------------------------

/**
 * Build a TemplateCache from a JsxSpec.
 * Creates the static DOM structure inside a <template> element and
 * records bindings for all dynamic parts.
 */
export function buildTemplate(spec: JsxSpec): TemplateCache {
  const template = document.createElement("template")
  const bindings: TemplateBinding[] = []
  buildTemplateElement(spec, template.content, [], bindings)
  return { template, bindings }
}

function buildTemplateElement(
  spec: JsxSpec,
  parent: Node,
  parentPath: number[],
  bindings: TemplateBinding[],
): void {
  const el = document.createElement(spec.tag)
  const childIndex = parent.childNodes.length
  parent.appendChild(el)

  const path = [...parentPath, childIndex]
  const c = spec.classified

  // IDL properties
  if (c.attrs) {
    for (const [name, fn] of Object.entries(c.attrs as Record<string, (m: any) => any>)) {
      bindings.push({ kind: "prop", path, name, fn })
    }
  }

  // Raw attributes
  if (c.rawAttrs) {
    for (const [name, fn] of Object.entries(c.rawAttrs as Record<string, (m: any) => string>)) {
      bindings.push({ kind: "rawAttr", path, name, propName: ATTR_TO_PROP[name], fn })
    }
  }

  // Style
  if (c.style) {
    for (const [prop, fn] of Object.entries(c.style as Record<string, (m: any) => string>)) {
      bindings.push({ kind: "style", path, prop, fn })
    }
  }

  // Class map
  if (c.classes) {
    bindings.push({ kind: "classMap", path, fn: c.classes as (m: any) => Record<string, boolean> })
  }

  // Events
  if (c.on) {
    for (const [eventName, handler] of Object.entries(c.on as Record<string, Function>)) {
      bindings.push({ kind: "event", path, eventName, handler })
    }
  }

  // Children
  for (const child of spec.children) {
    switch (child.kind) {
      case "static":
        el.appendChild(document.createTextNode(child.text))
        break
      case "dynamic": {
        // Placeholder text node — will be patched after clone
        const textIdx = el.childNodes.length
        el.appendChild(document.createTextNode(""))
        bindings.push({ kind: "dynamicText", path: [...path, textIdx], fn: child.fn })
        break
      }
      case "element":
        buildTemplateElement(child.spec, el, path, bindings)
        break
    }
  }
}

// ---------------------------------------------------------------------------
// Instantiate template (runs per attach)
// ---------------------------------------------------------------------------

/** Resolve a child-index path to a node in a cloned tree. */
function resolvePath(root: Node, path: number[]): Node {
  let node = root
  for (let i = 0; i < path.length; i++) {
    node = node.childNodes[path[i]!]!
  }
  return node
}

/**
 * Clone a cached template and wire up all dynamic bindings.
 * Returns the root element of the clone.
 */
export function instantiateTemplate(
  cache: TemplateCache,
  model: any,
  dispatch: Dispatcher<any>,
  updaters: Array<(next: any) => void>,
  eventCleanups: Array<() => void>,
): Element {
  const clone = cache.template.content.cloneNode(true) as DocumentFragment
  // The root element is the first (and only) child of the fragment
  const el = clone.firstChild as Element

  for (let i = 0; i < cache.bindings.length; i++) {
    const binding = cache.bindings[i]!
    // Resolve path relative to the root element's parent (the fragment)
    const node = resolvePath(clone, binding.path)

    switch (binding.kind) {
      case "prop": {
        const { name, fn } = binding
        let last = fn(model)
        ;(node as any)[name] = last
        updaters.push((next) => {
          const v = fn(next)
          if (v !== last) { last = v; (node as any)[name] = v }
        })
        break
      }
      case "rawAttr": {
        const { name, propName, fn } = binding
        let last = fn(model)
        if (propName) {
          ;(node as any)[propName] = last
          updaters.push((next) => {
            const v = fn(next)
            if (v !== last) { last = v; (node as any)[propName] = v }
          })
        } else {
          ;(node as Element).setAttribute(name, last)
          updaters.push((next) => {
            const v = fn(next)
            if (v !== last) { last = v; (node as Element).setAttribute(name, v) }
          })
        }
        break
      }
      case "style": {
        const { prop, fn } = binding
        let last = fn(model)
        ;(node as HTMLElement).style.setProperty(prop, last)
        updaters.push((next) => {
          const v = fn(next)
          if (v !== last) { last = v; (node as HTMLElement).style.setProperty(prop, v) }
        })
        break
      }
      case "classMap": {
        const { fn } = binding
        let lastMap = fn(model)
        applyClassMap(node as Element, lastMap)
        updaters.push((next) => {
          const nextMap = fn(next)
          if (nextMap !== lastMap) {
            applyClassMap(node as Element, nextMap, lastMap)
            lastMap = nextMap
          }
        })
        break
      }
      case "event": {
        const { eventName, handler } = binding
        const ref = { current: model }
        const listener = (event: Event) => {
          const msg = (handler as (e: Event, m: any) => any)(event, ref.current)
          if (msg !== null) dispatch(msg)
        }
        ;(node as Element).addEventListener(eventName, listener)
        eventCleanups.push(() => (node as Element).removeEventListener(eventName, listener))
        updaters.push((next) => { ref.current = next })
        break
      }
      case "dynamicText": {
        const { fn } = binding
        let last = fn(model)
        ;(node as Text).textContent = last
        updaters.push((next) => {
          const v = fn(next)
          if (v !== last) { last = v; (node as Text).textContent = v }
        })
        break
      }
    }
  }

  return el
}
