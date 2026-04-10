import { describe, it, expect } from "vitest"
import { sdomJsx } from "../src/vite-plugin"

describe("sdomJsx (Vite plugin)", () => {
  it("returns a plugin with correct name", () => {
    const plugin = sdomJsx()
    expect(plugin.name).toBe("vite-plugin-sdom-jsx")
  })

  it("has a config hook", () => {
    const plugin = sdomJsx()
    expect(typeof plugin.config).toBe("function")
  })

  it("returns esbuild jsx config", () => {
    const plugin = sdomJsx()
    const config = plugin.config!()
    expect(config).toEqual({
      esbuild: {
        jsx: "automatic",
        jsxImportSource: "static-dom-core",
      },
    })
  })

  it("returns a fresh config object each call", () => {
    const plugin = sdomJsx()
    const a = plugin.config!()
    const b = plugin.config!()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})
