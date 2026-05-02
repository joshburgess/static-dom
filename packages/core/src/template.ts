/**
 * template.ts — Template cloning engine.
 *
 * Separates static DOM structure from dynamic bindings. On first attach,
 * builds a <template> element via innerHTML (browser's native HTML parser)
 * and compiles firstChild/nextSibling walker functions for each binding.
 * On subsequent attaches, cloneNode(true) copies the entire subtree in a
 * single native call — including all static attributes baked into the HTML.
 *
 * Key design choices:
 * - innerHTML-based template construction (leverages native parser)
 * - Static attributes/styles baked into the HTML string (free on clone)
 * - Compiled walker functions using firstChild/nextSibling chains (O(1))
 * - Comment placeholders for dynamic text (replaced with text nodes on clone)
 *
 * Used by compileSpecCloned() in jsx-runtime.ts and by the lit-html style module.
 */

import { ATTR_TO_PROP, applyClassMap } from "./constructors"
import type { Dispatcher } from "./observable"
import { registerEvent } from "./delegation"
import type { JsxSpec } from "./shared"
import { isStaticFn, staticValueOf } from "./shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateCache {
  /** The <template> element with the static DOM skeleton. */
  template: HTMLTemplateElement
  /** Instructions for wiring up dynamic parts after cloneNode. */
  bindings: TemplateBinding[]
}

/**
 * A compiled walker function that navigates from a root node to a target
 * node using only firstChild/nextSibling — O(1) property accesses with
 * no array indexing or childNodes lookups.
 */
type NodeWalker = (root: Node) => Node

export type TemplateBinding =
  | { kind: "prop"; walk: NodeWalker; name: string; fn: (m: unknown) => unknown }
  | { kind: "rawAttr"; walk: NodeWalker; name: string; propName: string | undefined; fn: (m: unknown) => string }
  | { kind: "style"; walk: NodeWalker; prop: string; fn: (m: unknown) => string }
  | { kind: "classMap"; walk: NodeWalker; fn: (m: unknown) => Record<string, boolean> }
  | { kind: "event"; walk: NodeWalker; eventName: string; handler: Function }
  | { kind: "dynamicText"; walk: NodeWalker; fn: (m: unknown) => string }

// ---------------------------------------------------------------------------
// Walker compilation
// ---------------------------------------------------------------------------

const identityWalker: NodeWalker = (root) => root

/**
 * Compile a path (array of child indices) into a walker function that uses
 * firstChild + nextSibling chains. Each path step means: enter firstChild,
 * then skip N siblings.
 *
 * For path [0, 2, 1]:
 *   root.firstChild                    → child 0
 *       .firstChild.nextSibling×2      → child 2
 *       .firstChild.nextSibling        → child 1
 */
function compileWalker(path: number[]): NodeWalker {
  const n = path.length
  if (n === 0) return identityWalker

  // Copy path to prevent external mutation
  const p = path.slice()

  return (root: Node) => {
    let node = root
    for (let i = 0; i < n; i++) {
      node = node.firstChild!
      for (let j = p[i]!; j > 0; j--) {
        node = node.nextSibling!
      }
    }
    return node
  }
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

const ESC_RE = /[&<>"]/g
const ESC_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
}

function escapeHtml(s: string): string {
  return s.replace(ESC_RE, ch => ESC_MAP[ch]!)
}

// Void elements that must not have closing tags
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

// ---------------------------------------------------------------------------
// Build template (runs once per spec)
// ---------------------------------------------------------------------------

/**
 * Build a TemplateCache from a JsxSpec.
 * Creates the static DOM structure via innerHTML (leveraging the browser's
 * native HTML parser for optimal cloneNode performance) and compiles walker
 * functions for all dynamic parts.
 */
export function buildTemplate(spec: JsxSpec): TemplateCache {
  const bindings: TemplateBinding[] = []
  const html = buildHtml(spec, [0], bindings)
  const template = document.createElement("template")
  template.innerHTML = html
  return { template, bindings }
}

/**
 * Recursively build an HTML string from a JsxSpec and record bindings.
 *
 * Static attributes and styles are baked directly into the HTML string —
 * they become part of the template and are free on every subsequent clone.
 * Dynamic parts record a walker function for post-clone wiring.
 *
 * Child index tracking accounts for text node merging in the HTML parser:
 * adjacent static text segments produce a single text node, and comment
 * placeholders (for dynamic text) break text runs.
 */
function buildHtml(
  spec: JsxSpec,
  currentPath: number[],
  bindings: TemplateBinding[],
): string {
  const { tag, classified: c, children } = spec
  const isVoid = VOID_ELEMENTS.has(tag)

  // ── Opening tag with static attributes ──────────────────────────────

  let html = `<${tag}`

  // Collect dynamic rawAttrs — static ones get baked into the HTML
  let dynamicRawAttrs: Record<string, (m: unknown) => string> | null = null
  if (c.rawAttrs) {
    for (const [name, fn] of Object.entries(c.rawAttrs as Record<string, (m: unknown) => string>)) {
      if (isStaticFn(fn)) {
        html += ` ${name}="${escapeHtml(String(staticValueOf(fn)))}"`
      } else {
        if (!dynamicRawAttrs) dynamicRawAttrs = {}
        dynamicRawAttrs[name] = fn
      }
    }
  }

  // Collect dynamic styles — static ones get baked into a style attribute
  let dynamicStyles: Record<string, (m: unknown) => string> | null = null
  if (c.style) {
    const staticParts: string[] = []
    for (const [prop, fn] of Object.entries(c.style as Record<string, (m: unknown) => string>)) {
      if (isStaticFn(fn)) {
        staticParts.push(`${prop}: ${staticValueOf(fn)}`)
      } else {
        if (!dynamicStyles) dynamicStyles = {}
        dynamicStyles[prop] = fn
      }
    }
    if (staticParts.length > 0) {
      html += ` style="${escapeHtml(staticParts.join("; "))}"`
    }
  }

  html += ">"

  // ── Record bindings for dynamic parts on this element ───────────────

  const walk = compileWalker(currentPath)

  // IDL properties (always bindings — baking into HTML attrs is unreliable
  // due to IDL/attribute divergence for boolean props, value, etc.)
  if (c.attrs) {
    for (const [name, fn] of Object.entries(c.attrs as Record<string, (m: unknown) => unknown>)) {
      bindings.push({ kind: "prop", walk, name, fn })
    }
  }

  // Dynamic raw attributes
  if (dynamicRawAttrs) {
    for (const [name, fn] of Object.entries(dynamicRawAttrs)) {
      bindings.push({ kind: "rawAttr", walk, name, propName: ATTR_TO_PROP[name], fn })
    }
  }

  // Dynamic styles
  if (dynamicStyles) {
    for (const [prop, fn] of Object.entries(dynamicStyles)) {
      bindings.push({ kind: "style", walk, prop, fn })
    }
  }

  // Class map (always dynamic)
  if (c.classes) {
    bindings.push({ kind: "classMap", walk, fn: c.classes as (m: unknown) => Record<string, boolean> })
  }

  // Events (always bindings)
  if (c.on) {
    for (const [eventName, handler] of Object.entries(c.on as Record<string, Function>)) {
      bindings.push({ kind: "event", walk, eventName, handler })
    }
  }

  // ── Children ────────────────────────────────────────────────────────

  if (!isVoid) {
    // Track the actual DOM childIndex, accounting for text node merging.
    // Adjacent static text produces a single text node in the browser's
    // HTML parser. Comments and elements break text runs.
    let childIndex = 0
    let inTextRun = false

    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci]!
      switch (child.kind) {
        case "static":
          html += escapeHtml(child.text)
          inTextRun = true
          break

        case "dynamic":
          // Close any active text run — it produced one text node
          if (inTextRun) { childIndex++; inTextRun = false }
          // Comment placeholder — creates a Comment node in the DOM
          html += "<!---->"
          bindings.push({
            kind: "dynamicText",
            walk: compileWalker([...currentPath, childIndex]),
            fn: child.fn,
          })
          childIndex++
          break

        case "element":
          if (inTextRun) { childIndex++; inTextRun = false }
          html += buildHtml(child.spec, [...currentPath, childIndex], bindings)
          childIndex++
          break
      }
    }

    html += `</${tag}>`
  }

  return html
}

// ---------------------------------------------------------------------------
// Instantiate template (runs per attach)
// ---------------------------------------------------------------------------

/**
 * Clone a cached template and wire up all dynamic bindings.
 *
 * Walkers resolve target nodes via firstChild/nextSibling chains.
 * Comment placeholders for dynamic text are replaced with real text nodes.
 * Returns the root element of the clone.
 */
export function instantiateTemplate(
  cache: TemplateCache,
  model: unknown,
  dispatch: Dispatcher<unknown>,
  updaters: Array<(next: unknown) => void>,
  eventCleanups: Array<() => void>,
): Element {
  const clone = cache.template.content.cloneNode(true) as DocumentFragment

  for (let i = 0; i < cache.bindings.length; i++) {
    const binding = cache.bindings[i]!
    const node = binding.walk(clone)

    switch (binding.kind) {
      case "prop": {
        const { name, fn } = binding
        let last = fn(model)
        ;(node as unknown as Record<string, unknown>)[name] = last
        updaters.push((next) => {
          const v = fn(next)
          if (v !== last) {
            last = v
            ;(node as unknown as Record<string, unknown>)[name] = v
          }
        })
        break
      }
      case "rawAttr": {
        const { name, propName, fn } = binding
        let last = fn(model)
        if (propName) {
          ;(node as unknown as Record<string, unknown>)[propName] = last
          updaters.push((next) => {
            const v = fn(next)
            if (v !== last) {
              last = v
              ;(node as unknown as Record<string, unknown>)[propName] = v
            }
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
          const msg = (handler as (e: Event, m: unknown) => unknown)(event, ref.current)
          if (msg !== null) dispatch(msg)
        }
        eventCleanups.push(registerEvent(node as Element, eventName, listener))
        updaters.push((next) => { ref.current = next })
        break
      }
      case "dynamicText": {
        const { fn } = binding
        let last = fn(model)
        // Replace the comment placeholder with a real text node in one
        // DOM mutation. Walkers resolved by sibling chain still work.
        const textNode = document.createTextNode(last)
        node.parentNode!.replaceChild(textNode, node)
        updaters.push((next) => {
          const v = fn(next)
          if (v !== last) { last = v; textNode.textContent = v }
        })
        break
      }
    }
  }

  // The root element is the first (and only) child of the fragment
  return clone.firstChild as Element
}
