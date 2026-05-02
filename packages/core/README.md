# @static-dom/core

Core runtime for [Static DOM](https://github.com/joshburgess/static-dom): a virtual-DOM-free UI library with precise TypeScript types.

Static DOM mounts a fixed DOM tree once and updates leaves directly. There is no diff. Structural change happens only through opt-in primitives (`Show`, `Optional`, `For`, `match`, `dynamic`, `vdom`).

## Install

```sh
pnpm add @static-dom/core
```

## Quick start

```ts
import { div, h1, mount } from "@static-dom/core"

interface Model { count: number }
type Msg = { type: "inc" }

const view = div([
  h1((m: Model) => `Count: ${m.count}`),
])

mount(view, container, { count: 0 }, msg => { /* ... */ })
```

## Subpath exports

| Subpath | Purpose |
|---|---|
| `.` | Main API: constructors, `mount`, `Program`, etc. |
| `./optics` | Lens/Prism/Traversal optics for fine-grained subscriptions |
| `./jsx-runtime` | Automatic JSX runtime (`jsxImportSource: "@static-dom/core"`) |
| `./jsx-dev-runtime` | Dev variant of the JSX runtime |
| `./hyperscript` | `h(tag, props, children)` authoring style |
| `./htm` | Tagged-template authoring (htm) |
| `./html` | Raw HTML string authoring |
| `./internal` | `makeSDOM` and `guard` for adapter authors |

See the [project README](https://github.com/joshburgess/static-dom#readme) for full documentation.

## License

Dual-licensed under Apache-2.0 OR MIT.
