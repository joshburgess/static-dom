# @static-dom/vite

Vite plugin that wires up the [Static DOM](https://github.com/joshburgess/static-dom) JSX runtime.

## Install

```sh
pnpm add -D @static-dom/vite
```

`vite` (^5 or ^6) is a peer dependency.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite"
import { sdomJsx } from "@static-dom/vite"

export default defineConfig({
  plugins: [sdomJsx()],
})
```

The plugin sets `esbuild.jsx = "automatic"` and `esbuild.jsxImportSource = "@static-dom/core"`, so that JSX in your project compiles against SDOM's runtime.

## License

Dual-licensed under Apache-2.0 OR MIT.
