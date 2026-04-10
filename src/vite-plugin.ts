/**
 * vite-plugin.ts — Vite plugin for SDOM JSX
 *
 * Configures esbuild to use SDOM's JSX runtime. This is all that's
 * needed — esbuild handles parsing and transforming JSX into
 * jsx()/jsxs() calls, and our runtime handles the rest.
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from "vite"
 * import { sdomJsx } from "static-dom-core/vite"
 *
 * export default defineConfig({
 *   plugins: [sdomJsx()],
 * })
 * ```
 */

// Inline the minimal plugin shape to avoid pulling in vite's types
// (which conflict with exactOptionalPropertyTypes).
interface VitePlugin {
  name: string
  config?: () => Record<string, unknown>
}

/** Vite plugin that configures automatic JSX transform for SDOM. */
export function sdomJsx(): VitePlugin {
  return {
    name: "vite-plugin-sdom-jsx",
    config() {
      return {
        esbuild: {
          jsx: "automatic",
          jsxImportSource: "static-dom-core",
        },
      }
    },
  }
}
