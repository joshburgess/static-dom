/**
 * compile.ts — Build-time codegen for SDOM JSX.
 *
 * Transforms .tsx/.jsx source files: finds JSX elements whose shape is
 * statically known, and rewrites them as module-scope `compiled()`
 * calls with the walker chain unrolled and the binding switch
 * eliminated.
 *
 * This module exports `compileFile(code, id) -> { code, map } | null`,
 * the entry point the Vite plugin calls per file.
 *
 * Scope of the current pass (smallest end-to-end slice):
 *   - Only handles `<tag>{ <ArrowFunction> }</tag>` where:
 *     - `tag` is a literal lowercase string,
 *     - the only child is a single arrow-function expression,
 *     - there are no JSX attributes,
 *     - there are no other children.
 *   - Returns `null` (no transform) for files containing no compilable
 *     JSX, so unrelated files pass through untouched.
 *
 * Wider shapes (attrs, multiple children, nested elements, events,
 * `For`/`Show`/`Optional`, etc.) are deferred to follow-up passes.
 */

import ts from "typescript"

export interface CompileResult {
  code: string
}

interface CompiledSite {
  /** Position in the original source where the JSX expression starts. */
  start: number
  /** Position in the original source where the JSX expression ends. */
  end: number
  /** The identifier the JSX site is replaced with. */
  identifier: string
  /** The module-scope code emitted for this site (template + compiled call). */
  hoistedCode: string
}

const COMPILED_IMPORT_NAME = "__sdomCompiled"
const COMPILED_IMPORT_SPECIFIER = "@static-dom/core"

export function compileFile(code: string, id: string): CompileResult | null {
  if (!id.endsWith(".tsx") && !id.endsWith(".jsx")) return null

  const sf = ts.createSourceFile(
    id,
    code,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    id.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JSX,
  )

  const sites: CompiledSite[] = []
  let nextId = 0

  function visit(node: ts.Node): void {
    const compiled = tryCompileJsxElement(node, nextId)
    if (compiled !== null) {
      sites.push(compiled)
      nextId += 1
      // Don't descend into JSX we've fully compiled.
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (sites.length === 0) return null

  return {
    code: applyTransforms(code, sites),
  }
}

function tryCompileJsxElement(node: ts.Node, id: number): CompiledSite | null {
  if (!ts.isJsxElement(node)) return null

  const opening = node.openingElement
  // Tag must be a literal lowercase identifier (intrinsic element).
  if (!ts.isIdentifier(opening.tagName)) return null
  const tag = opening.tagName.text
  if (!/^[a-z][a-zA-Z0-9]*$/.test(tag)) return null

  // No JSX attributes for this slice.
  if (opening.attributes.properties.length !== 0) return null

  // Exactly one child, and it is a JsxExpression wrapping an arrow function.
  if (node.children.length !== 1) return null
  const child = node.children[0]!
  if (!ts.isJsxExpression(child)) return null
  if (child.expression === undefined) return null
  const expr = child.expression
  if (!ts.isArrowFunction(expr) && !ts.isFunctionExpression(expr)) return null

  const fnSource = expr.getText()
  const identifier = `__sdom_compiled_${id}`
  const tplName = `__sdom_tpl_${id}`

  const hoistedCode = emitCompiledTemplate(tplName, identifier, tag, fnSource)

  return {
    start: node.getStart(),
    end: node.getEnd(),
    identifier,
    hoistedCode,
  }
}

function emitCompiledTemplate(
  tplName: string,
  compiledName: string,
  tag: string,
  fnSource: string,
): string {
  // Escape the tag for safe injection into a template string.
  const safeTag = tag.replace(/"/g, '\\"')

  return [
    `const ${tplName} = (() => {`,
    `  const __t = document.createElement("template")`,
    `  __t.innerHTML = "<${safeTag}></${safeTag}>"`,
    `  return __t.content.firstChild`,
    `})()`,
    `const ${compiledName} = ${COMPILED_IMPORT_NAME}((parent, initialModel, _dispatch) => {`,
    `  const root = ${tplName}.cloneNode(true)`,
    `  const text0 = root.appendChild(document.createTextNode(""))`,
    `  const fn0 = ${fnSource}`,
    `  let last0 = fn0(initialModel)`,
    `  text0.nodeValue = String(last0)`,
    `  parent.appendChild(root)`,
    `  return {`,
    `    update(_prev, next) {`,
    `      const v0 = fn0(next)`,
    `      if (v0 !== last0) { last0 = v0; text0.nodeValue = String(v0) }`,
    `    },`,
    `    teardown() { root.remove() },`,
    `  }`,
    `})`,
  ].join("\n")
}

function applyTransforms(code: string, sites: CompiledSite[]): string {
  // Apply replacements in reverse so positions in `sites` stay valid.
  let out = code
  const sorted = [...sites].sort((a, b) => b.start - a.start)
  for (const site of sorted) {
    out = out.slice(0, site.start) + site.identifier + out.slice(site.end)
  }

  // Prepend the import + hoisted module-scope blocks.
  const importLine = `import { compiled as ${COMPILED_IMPORT_NAME} } from "${COMPILED_IMPORT_SPECIFIER}"\n`
  const hoisted = sites.map(s => s.hoistedCode).join("\n\n") + "\n\n"

  return importLine + hoisted + out
}
