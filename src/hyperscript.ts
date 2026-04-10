/**
 * hyperscript.ts — Hyperscript API for SDOM.
 *
 * Pure function call syntax for building SDOM views without JSX.
 * Uses the same prop classification and compiled template path as JSX.
 *
 * @example
 * ```typescript
 * import { h, div, span, button } from "@sdom/core/hyperscript"
 *
 * const view = div({ class: m => m.active ? "active" : "" }, [
 *   span({}, [m => m.label]),
 *   button({ onClick: (_e, m) => ({ type: "clicked" }) }, ["Go"]),
 * ])
 * ```
 *
 * @module
 */

import { element, fragment } from "./constructors"
import type { SDOM } from "./types"
import {
  classifyProps, normalizeChildren, tryBuildChildSpecs,
  _TEMPLATE_SPEC,
  type JsxSpec,
} from "./shared"
import { compileSpecCloned } from "./jsx-runtime"

// ---------------------------------------------------------------------------
// Child type
// ---------------------------------------------------------------------------

export type HChild =
  | SDOM<any, any>
  | ((model: any) => string)
  | string
  | number
  | boolean
  | null
  | undefined

// ---------------------------------------------------------------------------
// h() — generic hyperscript function
// ---------------------------------------------------------------------------

/**
 * Create an SDOM element using hyperscript syntax.
 *
 * Props use the same classification as JSX:
 * - `onClick`, `onInput`, etc. → event handlers
 * - `class` / `className` → class attribute
 * - `style` (object) → inline styles
 * - `classes` → class map
 * - IDL props (`value`, `checked`, etc.) → direct property assignment
 * - Everything else → setAttribute
 *
 * Children can be strings, numbers, functions `(m) => string`, or SDOM nodes.
 */
export function h(
  tag: string,
  props?: Record<string, unknown> | null,
  children?: HChild[],
): SDOM<any, any> {
  const allProps = props ? { ...props } : {}
  if (children && children.length > 0) {
    allProps.children = children
  }

  // Try compiled template path (with template cloning)
  const childSpecs = tryBuildChildSpecs(allProps.children)
  if (childSpecs !== null) {
    const classified = classifyProps(allProps)
    const spec: JsxSpec = { tag, classified, children: childSpecs }
    const sdom = compileSpecCloned(spec)
    ;(sdom as any)[_TEMPLATE_SPEC] = spec
    return sdom
  }

  // Fallback to element() when children include opaque SDOM nodes
  const attrInput = classifyProps(allProps)
  const normalizedChildren = normalizeChildren(allProps.children)
  return element(tag as any, attrInput as any, normalizedChildren)
}

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

/** Group children without a wrapper element. */
export function frag(children: HChild[]): SDOM<any, any> {
  return fragment(normalizeChildren(children))
}

// ---------------------------------------------------------------------------
// Shorthand tag helpers
// ---------------------------------------------------------------------------

function tag(name: string) {
  return (props?: Record<string, unknown> | null, children?: HChild[]) =>
    h(name, props, children)
}

// Layout
export const div = tag("div")
export const span = tag("span")
export const p = tag("p")
export const section = tag("section")
export const article = tag("article")
export const header = tag("header")
export const footer = tag("footer")
export const main = tag("main")
export const nav = tag("nav")
export const aside = tag("aside")

// Headings
export const h1 = tag("h1")
export const h2 = tag("h2")
export const h3 = tag("h3")
export const h4 = tag("h4")
export const h5 = tag("h5")
export const h6 = tag("h6")

// Text
export const em = tag("em")
export const strong = tag("strong")
export const small = tag("small")
export const pre = tag("pre")
export const code = tag("code")

// Interactive
export const a = tag("a")
export const button = tag("button")
export const input = tag("input")
export const textarea = tag("textarea")
export const select = tag("select")
export const option = tag("option")
export const label = tag("label")
export const form = tag("form")

// List
export const ul = tag("ul")
export const ol = tag("ol")
export const li = tag("li")

// Table
export const table = tag("table")
export const thead = tag("thead")
export const tbody = tag("tbody")
export const tr = tag("tr")
export const th = tag("th")
export const td = tag("td")

// Media
export const img = tag("img")
export const video = tag("video")
export const audio = tag("audio")
export const canvas = tag("canvas")

// Other
export const br = tag("br")
export const hr = tag("hr")
