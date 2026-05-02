# static-dom

Unscoped facade for [`@static-dom/core`](https://www.npmjs.com/package/@static-dom/core).

This package re-exports `@static-dom/core` (and all of its subpaths) under the unscoped name `static-dom`. Use it if you prefer `import { ... } from "static-dom"` over the scoped name.

## Install

```sh
pnpm add static-dom
```

## Usage

```ts
import { div, h1, mount } from "static-dom"
import { lens } from "static-dom/optics"
```

The available subpaths mirror `@static-dom/core`:

| Subpath | Re-exports |
|---|---|
| `.` | `@static-dom/core` |
| `./optics` | `@static-dom/core/optics` |
| `./jsx-runtime` | `@static-dom/core/jsx-runtime` |
| `./jsx-dev-runtime` | `@static-dom/core/jsx-dev-runtime` |
| `./hyperscript` | `@static-dom/core/hyperscript` |
| `./htm` | `@static-dom/core/htm` |
| `./html` | `@static-dom/core/html` |

See the [project README](https://github.com/joshburgess/static-dom#readme) for documentation.

## License

Dual-licensed under Apache-2.0 OR MIT.
