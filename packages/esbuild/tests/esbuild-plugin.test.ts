import { describe, it, expect } from "vitest"
import { sdomJsx, sdomJsxOptions, sdomSwcConfig } from "../src/index"

// ---------------------------------------------------------------------------
// esbuild plugin
// ---------------------------------------------------------------------------

describe("sdomJsx (esbuild plugin)", () => {
  it("returns a plugin with correct name", () => {
    const plugin = sdomJsx()
    expect(plugin.name).toBe("esbuild-plugin-sdom-jsx")
    expect(typeof plugin.setup).toBe("function")
  })

  it("sets jsx and jsxImportSource on empty options", () => {
    const plugin = sdomJsx()
    const build = { initialOptions: {} as Record<string, unknown> }
    plugin.setup(build as any)

    expect(build.initialOptions.jsx).toBe("automatic")
    expect(build.initialOptions.jsxImportSource).toBe("@static-dom/core")
  })

  it("does not override explicit jsx settings", () => {
    const plugin = sdomJsx()
    const build = {
      initialOptions: {
        jsx: "transform",
        jsxImportSource: "custom-source",
      } as Record<string, unknown>,
    }
    plugin.setup(build as any)

    expect(build.initialOptions.jsx).toBe("transform")
    expect(build.initialOptions.jsxImportSource).toBe("custom-source")
  })

  it("fills in only missing settings", () => {
    const plugin = sdomJsx()
    const build = {
      initialOptions: { jsx: "preserve" } as Record<string, unknown>,
    }
    plugin.setup(build as any)

    expect(build.initialOptions.jsx).toBe("preserve")
    expect(build.initialOptions.jsxImportSource).toBe("@static-dom/core")
  })
})

// ---------------------------------------------------------------------------
// esbuild options helper
// ---------------------------------------------------------------------------

describe("sdomJsxOptions", () => {
  it("returns correct esbuild options", () => {
    const opts = sdomJsxOptions()
    expect(opts).toEqual({
      jsx: "automatic",
      jsxImportSource: "@static-dom/core",
    })
  })
})

// ---------------------------------------------------------------------------
// SWC config helper
// ---------------------------------------------------------------------------

describe("sdomSwcConfig", () => {
  it("returns correct SWC config fragment", () => {
    const config = sdomSwcConfig()
    expect(config).toEqual({
      jsc: {
        transform: {
          react: {
            runtime: "automatic",
            importSource: "@static-dom/core",
          },
        },
      },
    })
  })

  it("can be merged with existing SWC config", () => {
    const existing = {
      jsc: {
        parser: { syntax: "typescript", tsx: true },
      },
    }
    const sdomConfig = sdomSwcConfig()
    const merged = {
      jsc: {
        ...existing.jsc,
        ...sdomConfig.jsc,
      },
    }

    expect(merged.jsc.parser).toEqual({ syntax: "typescript", tsx: true })
    expect(merged.jsc.transform.react.runtime).toBe("automatic")
  })
})
