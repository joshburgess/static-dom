/**
 * codegen/index.ts — Vite plugin for SDOM build-time JSX codegen.
 *
 * Runs as a `pre` source transform on .tsx/.jsx files. For JSX elements
 * whose shape is statically known, emits a hoisted module-scope
 * `compiled()` template instead of a runtime `jsx()` call. Files with
 * no compilable JSX pass through unchanged so the plugin is safe to
 * enable broadly.
 *
 * Usage:
 *
 * ```ts
 * import { defineConfig } from "vite"
 * import { sdomJsx, sdomCodegen } from "@static-dom/vite"
 *
 * export default defineConfig({
 *   plugins: [sdomCodegen(), sdomJsx()],
 * })
 * ```
 *
 * Order matters: `sdomCodegen()` runs first (`enforce: 'pre'`) and
 * intercepts JSX it can compile away; `sdomJsx()` configures the
 * standard JSX transform for the remainder.
 */

import { compileFile } from "./compile"

interface VitePlugin {
  name: string
  enforce?: "pre" | "post"
  transform?: (code: string, id: string) => { code: string } | null
}

/** Vite plugin that compiles statically-known SDOM JSX to module-scope templates. */
export function sdomCodegen(): VitePlugin {
  return {
    name: "vite-plugin-sdom-codegen",
    enforce: "pre",
    transform(code, id) {
      // Strip Vite query suffix (?foo=bar) before checking extensions.
      const path = id.split("?")[0] ?? id
      if (!path.endsWith(".tsx") && !path.endsWith(".jsx")) return null
      return compileFile(code, path)
    },
  }
}
