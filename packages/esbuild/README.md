# @static-dom/esbuild

esbuild plugin and config helpers for [Static DOM](https://github.com/joshburgess/static-dom) JSX.

## Install

```sh
pnpm add -D @static-dom/esbuild
```

`esbuild` is an optional peer dependency (>=0.20.0).

## Usage

### Plugin (esbuild JS API)

```ts
import esbuild from "esbuild"
import { sdomJsx } from "@static-dom/esbuild"

await esbuild.build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  plugins: [sdomJsx()],
})
```

### Config helper

```ts
import esbuild from "esbuild"
import { sdomJsxOptions } from "@static-dom/esbuild"

await esbuild.build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  ...sdomJsxOptions(),
})
```

### SWC

```ts
import { sdomSwcConfig } from "@static-dom/esbuild"

const config = {
  jsc: { ...sdomSwcConfig().jsc },
}
```

All helpers configure JSX automatic mode against `@static-dom/core` as the import source.

## License

Dual-licensed under Apache-2.0 OR MIT.
