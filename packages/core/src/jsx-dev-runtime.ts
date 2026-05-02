/**
 * jsx-dev-runtime.ts — SDOM JSX dev runtime
 *
 * Used by esbuild/TypeScript in development mode.
 * Delegates to the production runtime for now.
 * Future: add source location info to SDOM error messages.
 */

import { jsx, Fragment } from "./jsx-runtime"
import type { ErasedSDOM } from "./shared"

export { Fragment }

/** JSX development runtime entry point — delegates to production runtime. */
export function jsxDEV(
  type: string | symbol | ((props: Record<string, unknown>) => ErasedSDOM),
  props: Record<string, unknown>,
  _key?: string,
  _isStatic?: boolean,
  _source?: { fileName?: string; lineNumber?: number; columnNumber?: number },
  _self?: unknown,
): ErasedSDOM {
  return jsx(type, props, _key)
}
