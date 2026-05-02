/**
 * esbuild-plugin.ts — esbuild plugin for SDOM JSX
 *
 * Configures esbuild to use SDOM's automatic JSX runtime.
 * Works with both the esbuild CLI and the JS API.
 *
 * @example Plugin usage (esbuild JS API):
 * ```typescript
 * import esbuild from "esbuild"
 * import { sdomJsx } from "@static-dom/esbuild"
 *
 * await esbuild.build({
 *   entryPoints: ["src/main.tsx"],
 *   bundle: true,
 *   plugins: [sdomJsx()],
 * })
 * ```
 *
 * @example Config helper (manual options):
 * ```typescript
 * import esbuild from "esbuild"
 * import { sdomJsxOptions } from "@static-dom/esbuild"
 *
 * await esbuild.build({
 *   entryPoints: ["src/main.tsx"],
 *   bundle: true,
 *   ...sdomJsxOptions(),
 * })
 * ```
 */

// Inline types to avoid pulling in esbuild's type package
interface EsbuildPlugin {
  name: string
  setup: (build: EsbuildPluginBuild) => void
}

interface EsbuildPluginBuild {
  initialOptions: {
    jsx?: string
    jsxImportSource?: string
    jsxFactory?: string
    jsxFragment?: string
    [key: string]: unknown
  }
}

/**
 * esbuild plugin that configures JSX automatic mode with SDOM's runtime.
 *
 * Sets `jsx: "automatic"` and `jsxImportSource: "@static-dom/core"` unless
 * already configured (won't override explicit user settings).
 */
export function sdomJsx(): EsbuildPlugin {
  return {
    name: "esbuild-plugin-sdom-jsx",
    setup(build) {
      const opts = build.initialOptions
      if (!opts.jsx) opts.jsx = "automatic"
      if (!opts.jsxImportSource) opts.jsxImportSource = "@static-dom/core"
    },
  }
}

/**
 * Returns esbuild build options for SDOM JSX. Spread into your
 * `esbuild.build()` call or `esbuild.context()` options.
 */
export function sdomJsxOptions(): {
  jsx: "automatic"
  jsxImportSource: string
} {
  return {
    jsx: "automatic",
    jsxImportSource: "@static-dom/core",
  }
}

/**
 * Returns an SWC `.swcrc` config fragment for SDOM JSX.
 * Merge into your existing `.swcrc` or `swc-loader` options.
 *
 * @example
 * ```typescript
 * import { sdomSwcConfig } from "@static-dom/esbuild"
 *
 * // .swcrc or swc-loader config:
 * const config = {
 *   jsc: {
 *     ...sdomSwcConfig().jsc,
 *     // other jsc options...
 *   },
 * }
 * ```
 */
export function sdomSwcConfig(): {
  jsc: {
    transform: {
      react: {
        runtime: "automatic"
        importSource: string
      }
    }
  }
} {
  return {
    jsc: {
      transform: {
        react: {
          runtime: "automatic",
          importSource: "@static-dom/core",
        },
      },
    },
  }
}
