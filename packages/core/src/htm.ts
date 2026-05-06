/**
 * htm.ts — HTM (Hyperscript Tagged Markup) for SDOM.
 *
 * Tagged template literal with a runtime parser. No build step needed.
 * Parses HTML-like syntax at runtime, caches the parse result per
 * call site (via TemplateStringsArray identity), and feeds into the
 * same compiled template path as JSX.
 *
 * @example
 * ```typescript
 * import { html } from "@static-dom/core/htm"
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

import { element, fragment } from "./constructors"
import {
  classifyProps, normalizeChildren, tryBuildChildSpecs,
  _TEMPLATE_SPEC,
  type ErasedSDOM,
  type JsxSpec,
} from "./shared"
import { compileSpecCloned } from "./jsx-runtime"

// ---------------------------------------------------------------------------
// Parser types
// ---------------------------------------------------------------------------

/** A parsed shape for a call site — reused across invocations. */
interface ParsedShape {
  /** Tree of parsed nodes. */
  nodes: ParsedNode[]
}

type ParsedNode =
  | { type: "element"; tag: string; props: ParsedProp[]; children: ParsedNode[] }
  | { type: "text"; value: string }
  | { type: "dynamicText"; index: number }
  | { type: "component"; index: number; props: ParsedProp[]; children: ParsedNode[] }

type ParsedProp =
  | { kind: "static"; name: string; value: string }
  | { kind: "dynamic"; name: string; index: number }
  | { kind: "spread"; index: number }

// ---------------------------------------------------------------------------
// Parser cache
// ---------------------------------------------------------------------------

const shapeCache = new WeakMap<TemplateStringsArray, ParsedShape>()

// ---------------------------------------------------------------------------
// html tagged template
// ---------------------------------------------------------------------------

/**
 * Create SDOM views using HTM (Hyperscript Tagged Markup) syntax.
 *
 * Uses a runtime parser to convert HTML-like template literals into
 * SDOM nodes. The parse result is cached per call site, so subsequent
 * calls only pay the cost of merging in new dynamic values.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): ErasedSDOM {
  let shape = shapeCache.get(strings)
  if (!shape) {
    shape = parse(strings)
    shapeCache.set(strings, shape)
  }
  return buildFromShape(shape, values)
}

// ---------------------------------------------------------------------------
// Build SDOM from parsed shape + values
// ---------------------------------------------------------------------------

function buildFromShape(shape: ParsedShape, values: unknown[]): ErasedSDOM {
  const nodes = shape.nodes.map(n => buildNode(n, values))
  if (nodes.length === 1) return nodes[0]!
  return fragment(nodes)
}

function buildNode(node: ParsedNode, values: unknown[]): ErasedSDOM {
  switch (node.type) {
    case "text":
      return { attach: makeStaticTextAttach(node.value) } as unknown as ErasedSDOM

    case "dynamicText": {
      const val = values[node.index]
      // If it's an SDOM node, return it directly
      if (val !== null && typeof val === "object" && "attach" in val) return val as ErasedSDOM
      // Otherwise delegate to h()-like path
      return buildElement("span", {}, [node], values)
    }

    case "component": {
      const comp = values[node.index]
      if (typeof comp !== "function") {
        throw new Error(`HTM: expected a component function at interpolation ${node.index}`)
      }
      const props = resolveProps(node.props, values)
      if (node.children.length > 0) {
        props.children = node.children.map(c => buildNode(c, values))
      }
      return comp(props) as ErasedSDOM
    }

    case "element":
      return buildElement(node.tag, resolveProps(node.props, values), node.children, values)
  }
}

function buildElement(
  tag: string,
  props: Record<string, unknown>,
  children: ParsedNode[],
  values: unknown[],
): ErasedSDOM {
  const allProps: Record<string, unknown> = { ...props }

  if (children.length > 0) {
    allProps.children = children.map(c => {
      switch (c.type) {
        case "text": return c.value
        case "dynamicText": return values[c.index]
        case "element": return buildNode(c, values)
        case "component": return buildNode(c, values)
      }
    })
  }

  // Try compiled template path
  const childSpecs = tryBuildChildSpecs(allProps.children)
  if (childSpecs !== null) {
    const classified = classifyProps(allProps)
    const spec: JsxSpec = { tag, classified, children: childSpecs }
    const sdom = compileSpecCloned(spec)
    ;(sdom as unknown as Record<symbol, unknown>)[_TEMPLATE_SPEC] = spec
    return sdom
  }

  // Fallback
  const attrInput = classifyProps(allProps)
  const normalizedChildren = normalizeChildren(allProps.children)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `element` expects a specific tag literal type and classified prop shape, but both are dynamically constructed at this boundary
  return element(tag as any, attrInput as any, normalizedChildren)
}

function resolveProps(parsedProps: ParsedProp[], values: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const p of parsedProps) {
    switch (p.kind) {
      case "static":
        result[p.name] = p.value
        break
      case "dynamic":
        result[p.name] = values[p.index]
        break
      case "spread": {
        const obj = values[p.index]
        if (obj && typeof obj === "object") {
          Object.assign(result, obj)
        }
        break
      }
    }
  }
  return result
}

function makeStaticTextAttach(text: string) {
  return (parent: Node, _model: unknown, _updates: unknown, _dispatch: unknown) => {
    const node = document.createTextNode(text)
    parent.appendChild(node)
    return { teardown() { node.remove() } }
  }
}

// ---------------------------------------------------------------------------
// Parser — state machine
// ---------------------------------------------------------------------------

const enum State {
  TEXT,
  TAG_OPEN,        // just saw '<'
  TAG_NAME,        // reading tag name
  ATTRS,           // between attributes
  ATTR_NAME,       // reading attribute name
  ATTR_EQ,         // just saw '='
  ATTR_VALUE_DQ,   // inside "..."
  ATTR_VALUE_SQ,   // inside '...'
  ATTR_VALUE_UQ,   // unquoted attr value
  TAG_CLOSE,       // saw '</'
  CLOSE_TAG_NAME,  // reading closing tag name
  SELF_CLOSING,    // saw '/' in tag, expecting '>'
}

function parse(strings: TemplateStringsArray): ParsedShape {
  // Flatten into a token stream: alternating static strings and value indices
  const tokens: Array<{ type: "str"; value: string } | { type: "val"; index: number }> = []
  for (let i = 0; i < strings.length; i++) {
    if (strings[i]!.length > 0) tokens.push({ type: "str", value: strings[i]! })
    if (i < strings.length - 1) tokens.push({ type: "val", index: i })
  }

  // Parse state
  let state: State = State.TEXT
  const nodeStack: ParsedNode[][] = [[]]
  const tagStack: string[] = []
  let currentTag = ""
  let currentAttrName = ""
  let currentAttrValue = ""
  let currentText = ""
  let currentProps: ParsedProp[] = []

  function pushText() {
    if (currentText.length > 0) {
      const trimmed = currentText
      if (trimmed.trim().length > 0) {
        // Preserve meaningful whitespace but collapse pure whitespace between tags
        nodeStack[nodeStack.length - 1]!.push({ type: "text", value: trimmed })
      }
      currentText = ""
    }
  }

  function pushAttr() {
    if (currentAttrName.length > 0) {
      currentProps.push({ kind: "static", name: currentAttrName, value: currentAttrValue || "true" })
      currentAttrName = ""
      currentAttrValue = ""
    }
  }

  function openElement() {
    const children: ParsedNode[] = []
    const node: ParsedNode = currentTag.charCodeAt(0) >= 65 && currentTag.charCodeAt(0) <= 90
      ? { type: "component", index: -1, props: currentProps, children }  // placeholder
      : { type: "element", tag: currentTag, props: currentProps, children }
    nodeStack[nodeStack.length - 1]!.push(node)
    nodeStack.push(children)
    tagStack.push(currentTag)
    currentProps = []
    currentTag = ""
  }

  function selfCloseElement() {
    const children: ParsedNode[] = []
    const node: ParsedNode = { type: "element", tag: currentTag, props: currentProps, children }
    nodeStack[nodeStack.length - 1]!.push(node)
    currentProps = []
    currentTag = ""
  }

  function closeElement() {
    if (nodeStack.length > 1) {
      nodeStack.pop()
      tagStack.pop()
    }
  }

  for (const token of tokens) {
    if (token.type === "val") {
      // Handle value interpolation based on current state
      switch (state) {
        case State.TEXT:
          pushText()
          nodeStack[nodeStack.length - 1]!.push({ type: "dynamicText", index: token.index })
          break

        case State.ATTRS: {
          // Spread props: ...${obj}
          currentProps.push({ kind: "spread", index: token.index })
          break
        }

        case State.TAG_NAME:
        case State.TAG_OPEN: {
          // Dynamic tag name — treat as component
          pushText()
          const children: ParsedNode[] = []
          const node: ParsedNode = { type: "component", index: token.index, props: currentProps, children }
          nodeStack[nodeStack.length - 1]!.push(node)
          nodeStack.push(children)
          tagStack.push("$component")
          currentProps = []
          currentTag = ""
          state = State.ATTRS
          break
        }

        case State.ATTR_EQ:
          currentProps.push({ kind: "dynamic", name: currentAttrName, index: token.index })
          currentAttrName = ""
          currentAttrValue = ""
          state = State.ATTRS
          break

        case State.ATTR_VALUE_DQ:
        case State.ATTR_VALUE_SQ:
        case State.ATTR_VALUE_UQ:
          // Dynamic value inside a quoted attribute
          currentProps.push({ kind: "dynamic", name: currentAttrName, index: token.index })
          currentAttrName = ""
          currentAttrValue = ""
          // If we were in quoted context, keep looking for closing quote
          if (state === State.ATTR_VALUE_DQ || state === State.ATTR_VALUE_SQ) {
            state = State.ATTRS
          } else {
            state = State.ATTRS
          }
          break

        case State.ATTR_NAME:
          // Might be a spread: name so far + dynamic value
          if (currentAttrName === "...") {
            currentProps.push({ kind: "spread", index: token.index })
            currentAttrName = ""
            state = State.ATTRS
          } else {
            // Boolean attr followed by dynamic value interpolation — push the boolean, then handle value
            pushAttr()
            currentProps.push({ kind: "spread", index: token.index })
            state = State.ATTRS
          }
          break

        default:
          break
      }
      continue
    }

    // Static string processing — character by character
    const str = token.value
    for (let i = 0; i < str.length; i++) {
      const ch = str[i]!

      switch (state) {
        case State.TEXT:
          if (ch === "<") {
            pushText()
            // Check if next char is '/'
            if (i + 1 < str.length && str[i + 1] === "/") {
              state = State.TAG_CLOSE
              i++ // skip '/'
            } else {
              state = State.TAG_OPEN
            }
          } else {
            currentText += ch
          }
          break

        case State.TAG_OPEN:
          if (ch === "/" ){
            state = State.TAG_CLOSE
          } else if (/\s/.test(ch)) {
            // skip
          } else {
            currentTag = ch
            state = State.TAG_NAME
          }
          break

        case State.TAG_NAME:
          if (/\s/.test(ch)) {
            state = State.ATTRS
          } else if (ch === ">") {
            openElement()
            state = State.TEXT
          } else if (ch === "/") {
            state = State.SELF_CLOSING
          } else {
            currentTag += ch
          }
          break

        case State.ATTRS:
          if (/\s/.test(ch)) {
            // skip whitespace
          } else if (ch === ">") {
            pushAttr()
            openElement()
            state = State.TEXT
          } else if (ch === "/") {
            pushAttr()
            state = State.SELF_CLOSING
          } else if (ch === ".") {
            // Might be start of spread "..."
            currentAttrName = "."
            state = State.ATTR_NAME
          } else {
            currentAttrName = ch
            state = State.ATTR_NAME
          }
          break

        case State.ATTR_NAME:
          if (ch === "=") {
            state = State.ATTR_EQ
          } else if (/\s/.test(ch)) {
            pushAttr()
            state = State.ATTRS
          } else if (ch === ">") {
            pushAttr()
            openElement()
            state = State.TEXT
          } else if (ch === "/") {
            pushAttr()
            state = State.SELF_CLOSING
          } else {
            currentAttrName += ch
          }
          break

        case State.ATTR_EQ:
          if (ch === '"') {
            state = State.ATTR_VALUE_DQ
          } else if (ch === "'") {
            state = State.ATTR_VALUE_SQ
          } else if (/\s/.test(ch)) {
            // skip
          } else {
            currentAttrValue = ch
            state = State.ATTR_VALUE_UQ
          }
          break

        case State.ATTR_VALUE_DQ:
          if (ch === '"') {
            pushAttr()
            state = State.ATTRS
          } else {
            currentAttrValue += ch
          }
          break

        case State.ATTR_VALUE_SQ:
          if (ch === "'") {
            pushAttr()
            state = State.ATTRS
          } else {
            currentAttrValue += ch
          }
          break

        case State.ATTR_VALUE_UQ:
          if (/\s/.test(ch)) {
            pushAttr()
            state = State.ATTRS
          } else if (ch === ">") {
            pushAttr()
            openElement()
            state = State.TEXT
          } else if (ch === "/") {
            pushAttr()
            state = State.SELF_CLOSING
          } else {
            currentAttrValue += ch
          }
          break

        case State.SELF_CLOSING:
          if (ch === ">") {
            selfCloseElement()
            state = State.TEXT
          }
          break

        case State.TAG_CLOSE:
          if (/\s/.test(ch)) {
            // skip
          } else if (ch === ">") {
            closeElement()
            currentTag = ""
            state = State.TEXT
          } else {
            currentTag += ch
            state = State.CLOSE_TAG_NAME
          }
          break

        case State.CLOSE_TAG_NAME:
          if (ch === ">") {
            closeElement()
            currentTag = ""
            state = State.TEXT
          } else if (!/\s/.test(ch)) {
            currentTag += ch
          }
          break
      }
    }
  }

  // Flush any remaining text
  pushText()

  return { nodes: nodeStack[0]! }
}
