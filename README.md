# static-dom

A TypeScript UI library that eliminates virtual DOM diffing by fixing DOM structure at mount time. Only leaf values (text content, attributes) update in place — no intermediate representation, no reconciliation.

Based on Phil Freeman's [purescript-sdom](https://github.com/paf31/purescript-sdom) and [blog post](https://blog.functorial.com/posts/2018-03-12-You-Might-Not-Need-The-Virtual-DOM.html).

- **No diffing** — updates go straight to the DOM node that changed
- **Predictable performance** — cost is proportional to what changed, not tree size
- **Simple mental model** — components are just functions from model to leaf values
- **Multiple authoring styles** — JSX, hyperscript, tagged templates, or low-level constructors

## Install

```bash
npm install static-dom
```

## Quick start

### JSX

Configure your build tool for the automatic JSX runtime:

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import { sdomJsx } from "static-dom/vite"

export default defineConfig({ plugins: [sdomJsx()] })
```

Then write views as JSX:

```tsx
import { typed } from "static-dom/jsx-runtime"
import { program } from "static-dom"

interface Model { count: number }
type Msg = { type: "inc" } | { type: "dec" }

const view = typed<Model, Msg>(
  <div>
    <span>{m => String(m.count)}</span>
    <button onClick={() => ({ type: "inc" })}>+</button>
    <button onClick={() => ({ type: "dec" })}>-</button>
  </div>
)

program({
  container: document.getElementById("app")!,
  init: { count: 0 },
  update: (msg, model) => {
    switch (msg.type) {
      case "inc": return { count: model.count + 1 }
      case "dec": return { count: model.count - 1 }
    }
  },
  view,
})
```

Dynamic values are functions from model to leaf values — `{m => m.label}` for text, `class={m => m.active ? "active" : ""}` for attributes. Event handlers receive the event and current model: `onClick={(e, m) => ({ type: "clicked", id: m.id })}`.

### Hyperscript

No build step needed — same semantics as JSX, just function calls:

```typescript
import { div, span, button } from "static-dom/hyperscript"

const view = div({}, [
  span({}, [m => String(m.count)]),
  button({ onClick: () => ({ type: "inc" }) }, ["+"]),
  button({ onClick: () => ({ type: "dec" }) }, ["-"]),
])
```

### Tagged templates

Two flavors — `htm` parses at runtime (no build step), `html` uses the browser's native HTML parser with template cloning for faster initial renders:

```typescript
import { html } from "static-dom/htm"
// or: import { html } from "static-dom/html"

const view = html`
  <div>
    <span>${m => String(m.count)}</span>
    <button onClick=${() => ({ type: "inc" })}>+</button>
    <button onClick=${() => ({ type: "dec" })}>-</button>
  </div>
`
```

All authoring styles produce the same runtime code — pick whichever you prefer.

## Architecture

static-dom uses the Elm architecture: a model, messages, and a pure update function.

```typescript
program({
  container: document.getElementById("app")!,
  init: initialModel,
  update: (msg, model) => newModel,
  view,
})
```

For apps that need side effects, use `elmProgram` with commands and subscriptions:

```typescript
import { elmProgram, noCmd, httpGetJson, delay, onUrlChange } from "static-dom"

elmProgram<Model, Msg>({
  container: document.getElementById("app")!,
  init: [initialModel, noCmd],
  update: (msg, model) => {
    switch (msg.type) {
      case "fetchData":
        return [model, httpGetJson({ url: "/api/data", onSuccess: ..., onError: ... })]
      case "delayedAction":
        return [model, delay(1000, { type: "tick" })]
      default:
        return [newModel, noCmd]
    }
  },
  view,
  subscriptions: (model) => onUrlChange("nav", loc => ({ type: "urlChanged", url: loc.href })),
})
```

**Commands:** `httpRequest`, `httpGetJson`, `httpPostJson`, `randomInt`, `randomFloat`, `delay`, `nextTick`, `batchCmd`

**Subscriptions:** `interval`, `animationFrame`, `onWindow`, `onDocument`, `batchSub`

**Navigation:** `pushUrl`, `replaceUrl`, `back`, `forward`, `onUrlChange`, `onHashChange`

**Ports:** `createInPort`, `createOutPort`, `portSub`, `portCmd` — typed JS interop

## Lists

Choose a list constructor based on your update pattern:

| Constructor | Key strategy | Best for |
|---|---|---|
| `arrayBy(tag, getItems, getKey, view)` | Key extractor function | Most lists (zero-allocation) |
| `array(tag, getItems, view)` | `{ key, model }` wrappers | Legacy code |
| `indexedArray(tag, getItems, view)` | Positional (no keys) | Append-only logs, fixed grids |
| `incrementalArray(tag, getItems, getDelta, view)` | Keyed deltas | Large lists with targeted updates |

`incrementalArray` skips reconciliation entirely — O(1) per update regardless of list size. See [RECOMMENDATION.md](./RECOMMENDATION.md) for detailed guidance.

## Focusing on sub-models

Components often operate on a slice of the app model. Use `.focus()` with a path to zoom in:

```typescript
import { at } from "static-dom"

// at() builds a type-safe path into your model
const nameLens = at<AppModel>()("user", "profile", "name")
// Lens<AppModel, string> — reads and writes model.user.profile.name

// Focus a reusable component on a sub-model
const nameInput = stringInput.focus(nameLens)
```

Under the hood, `at()` and `prop()` build **lenses** — composable accessors from the optics tradition. You don't need to know optics to use them, but the full system is there if you want it: `Iso`, `Lens`, `Prism`, `Affine`, and `Traversal` with type-safe composition.

```typescript
import { prop, each } from "static-dom"

// Compose optics to traverse nested structures
const allNames = prop<Model>()("users").compose(each<User>()).compose(prop<User>()("name"))
allNames.getAll(model) // ["Alice", "Bob"]
```

## React interop

Drop static-dom subtrees into existing React apps:

```tsx
import { SDOMBoundary } from "static-dom/react"

function App({ model, onMsg }) {
  return (
    <div>
      <h1>Dashboard</h1>
      <SDOMBoundary sdom={myTableView} model={model} onMsg={onMsg} />
    </div>
  )
}
```

## Performance

On targeted updates (single row in a 1,000-row table), static-dom's incremental path reaches 88% of Solid.js throughput while using a simpler whole-model architecture — no signals, no dependency tracking. On bulk attribute updates, the basic `array()` path beats Solid by 17%.

See [BENCHMARKS.md](./BENCHMARKS.md) for full results and [RECOMMENDATION.md](./RECOMMENDATION.md) for tuning guidance.

## Build tooling

| Export | Description |
|---|---|
| `static-dom/vite` | Vite plugin — `sdomJsx()` |
| `static-dom/esbuild` | esbuild plugin + SWC config helper |
| `static-dom/eslint` | `no-dynamic-children` lint rule |

## License

Dual licensed under [Apache 2.0](./LICENSE-APACHE) or [MIT](./LICENSE-MIT).
