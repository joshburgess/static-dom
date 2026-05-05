# static-dom

A TypeScript UI library that eliminates virtual DOM diffing by fixing DOM structure at mount time. Only leaf values (text content, attributes) update in place: no intermediate representation, no reconciliation.

Based on Phil Freeman's [purescript-sdom](https://github.com/paf31/purescript-sdom) and [blog post](https://blog.functorial.com/posts/2018-03-12-You-Might-Not-Need-The-Virtual-DOM.html), with a reactive substrate inspired by Jane Street's [Incremental](https://github.com/janestreet/incremental).

- **No diffing**: updates go straight to the DOM node that changed
- **Predictable performance**: cost is proportional to what changed, not tree size
- **Simple mental model**: components are just functions from model to leaf values
- **Multiple authoring styles**: JSX, hyperscript, tagged templates, or low-level constructors

## Install

```bash
npm install static-dom
```

`static-dom` is a thin re-export of `@static-dom/core`. Optional pieces live in their own packages so you only pull in peer deps you actually use:

| Package | What it adds | Peer deps |
|---|---|---|
| `static-dom` | Facade for `@static-dom/core` (or use `@static-dom/core` directly) | none |
| `@static-dom/react` | `<SDOMBoundary>` for embedding in React apps | `react` |
| `@static-dom/vdom` | Per-update structural changes via Tachys | `tachys` |
| `@static-dom/vite` | Vite plugin for the JSX runtime | `vite` |
| `@static-dom/esbuild` | esbuild plugin and SWC config helper | `esbuild` (optional) |
| `@static-dom/eslint` | `no-dynamic-children` lint rule | `eslint` (optional) |

## Quick start

### JSX

Configure your build tool for the automatic JSX runtime:

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import { sdomJsx } from "@static-dom/vite"

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

Dynamic values are functions from model to leaf values: `{m => m.label}` for text, `class={m => m.active ? "active" : ""}` for attributes. Event handlers receive the event and current model: `onClick={(e, m) => ({ type: "clicked", id: m.id })}`.

### Hyperscript

No build step needed; same semantics as JSX, just function calls:

```typescript
import { div, span, button } from "static-dom/hyperscript"

const view = div({}, [
  span({}, [m => String(m.count)]),
  button({ onClick: () => ({ type: "inc" }) }, ["+"]),
  button({ onClick: () => ({ type: "dec" }) }, ["-"]),
])
```

### Tagged templates

Two flavors: `htm` parses at runtime (no build step), `html` uses the browser's native HTML parser with template cloning for faster initial renders:

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

All authoring styles produce the same runtime code. Pick whichever you prefer.

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

**Ports:** `createInPort`, `createOutPort`, `portSub`, `portCmd` (typed JS interop)

### Reactive primitives

Underneath the program runners is a small OCaml-Incremental-flavored
dependency graph. You don't need to touch it for app-style code, but the
primitives are exported for auxiliary state, computed combinations across
independent sources, or interop with imperative code:

```typescript
import { makeVar, mapCell, mapCell2, batch, cellToUpdateStream } from "static-dom"

const x = makeVar(2)
const y = makeVar(3)
const sum = mapCell2(x, y, (a, b) => a + b)
const doubled = mapCell(sum, (n) => n * 2)

batch(() => { x.set(5); y.set(7) })  // single stabilize sweep
doubled.value                         // 24
```

Cells are diamond-correct: in an `a -> b, a -> c, (b, c) -> d` shape, `d`
recomputes once per change to `a`, not twice. Each cell has an equality
cutoff (`===` by default) that stops propagation when a derivation produces
an unchanged value.

Bridge a cell into a program-style view with `cellToUpdateStream(cell)`.
The same primitives back the runners internally, so app model state and
externally-derived state share one notification mechanism.

#### Lifting optics over the graph

Optics compose with the graph: a `Lens<S, A>` over a `Cell<S>` becomes a
`Cell<A>` whose cutoff is the optic's domain equality. Fields the optic
does not read never propagate; fields whose lens-equality says "unchanged"
never fire observers.

```typescript
import { makeVar, focusVar, liftLens, prop } from "static-dom"

interface User { id: number; name: string }
const user = makeVar<User>({ id: 1, name: "alice" })

// Read-only projection through a Lens.
const name = liftLens(prop<User>()("name"), user)
name.value // "alice"

// Bidirectional: focusVar hands back a Var whose .set writes through the lens.
const nameVar = focusVar(prop<User>()("name"), user)
nameVar.set("bob")
user.value // { id: 1, name: "bob" }
```

`liftGetter`, `liftPrism`, `liftAffine`, and `liftFold` cover the rest of
the optic kinds. Prism / Affine lift to `Cell<A | null>` via `preview`.

## Lists

Choose a list constructor based on your update pattern:

| Constructor | Key strategy | Best for |
|---|---|---|
| `arrayBy(tag, getItems, getKey, view)` | Key extractor function | Most lists (zero-allocation) |
| `array(tag, getItems, view)` | `{ key, model }` wrappers | Legacy code |
| `indexedArray(tag, getItems, view)` | Positional (no keys) | Append-only logs, fixed grids |
| `incrementalArray(tag, getItems, getDelta, view)` | Keyed deltas | Large lists with targeted updates |

`incrementalArray` skips reconciliation entirely: O(1) per update regardless of list size. See [RECOMMENDATION.md](./RECOMMENDATION.md) for detailed guidance.

## Dynamic structure

static-dom's core guarantee is that DOM structure is fixed after mount and only leaf values update. But some UI patterns genuinely require structural changes at runtime: loading/error/success states, route switches, user-configured layouts, or embedded rich-text editors.

Three constructors handle these cases at different levels of flexibility. Each one creates a boundary where structural changes can happen, while everything outside the boundary stays on the fast static path.

| Constructor | Use when | Cost model |
|---|---|---|
| `match` | Switching between a known set of views based on a discriminant | O(leaf changes) within a branch; remount cost on branch switch |
| `dynamic` | The set of views isn't known at compile time, or depends on runtime data | Same as match, plus optional DOM caching across key switches |
| `vdom` | A subtree needs per-update structural changes (drag-and-drop, WYSIWYG, animations) | O(tree size) diffing inside the boundary via Tachys |

For binary show/hide (present vs. absent), use `optional` with a prism. For everything else, read on.

### match

Switch between completely different DOM structures based on a discriminant:

```typescript
import { match } from "static-dom"

type State =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "loaded"; data: Data }

const view = match("tag", {
  loading: loadingSpinner,   // SDOM<State, Msg>
  error: errorPanel,         // SDOM<State, Msg>
  loaded: dataTable,         // SDOM<State, Msg>
})
```

Same-branch updates take the standard static-dom fast path (only leaf values update). Branch switches tear down the old subtree and mount the new one.

A function discriminant works when your model isn't a tagged union:

```typescript
const view = match(m => m.loggedIn ? "auth" : "anon", {
  auth: dashboardView,
  anon: loginView,
})
```

### dynamic

For cases where the set of possible views isn't known at compile time, like user-configured dashboards, plugin systems, or data-driven layouts:

```typescript
import { dynamic } from "static-dom"

const view = dynamic(
  m => m.layout,           // cache key: determines when to remount
  m => buildLayout(m),     // factory: returns an SDOM
)
```

Everything inside the `dynamic` boundary is still static-dom (O(leaf changes) per update). The boundary itself pays remount cost only when the key changes.

Enable caching to reuse previously mounted branches instead of rebuilding from scratch:

```typescript
const view = dynamic(m => m.layout, m => buildLayout(m), { cache: true })
```

With caching, branch switches detach and reinsert existing DOM nodes rather than tearing down and remounting. Useful for tab-like patterns where users flip back and forth.

### vdom

For subtrees that need per-update structural changes (drag-and-drop builders, WYSIWYG editors, animation systems), embed a [Tachys](https://github.com/joshburgess/tachys) virtual DOM subtree via its `tachys/sync` entry point:

```typescript
import { vdom } from "@static-dom/vdom"
import { h } from "tachys/sync"

const dynamicContent = vdom<Model, Msg>((model, dispatch) =>
  h("ul", null,
    model.items.map(item =>
      h("li", { key: item.id, onClick: () => dispatch({ type: "click", id: item.id }) },
        item.label
      )
    )
  )
)
```

Everything inside the boundary pays vdom diffing cost (O(tree size)). Everything outside remains static-dom (O(leaf changes)). The trade-off is explicit and scoped.

`tachys/sync` is the synchronous-only build of Tachys: a React-like vdom with an Inferno-style LIS keyed-diff and V8-focused tuning, ~11KB gzipped. The concurrent scheduler is shimmed out, so transitions, time slicing, and Suspense aren't pulled into your bundle.

For integrating any other renderer (Canvas, D3, WebGL), use `vdomWith`:

```typescript
import { vdomWith } from "@static-dom/vdom"

const chart = vdomWith<Model, Msg>({
  render(container, model, dispatch) { /* any rendering logic */ },
  teardown(container) { /* cleanup */ },
})
```

Tachys is an optional peer dependency of `@static-dom/vdom`.

## Focusing on sub-models

Components often operate on a slice of the app model. Use `.focus()` with a path to zoom in:

```typescript
import { at } from "static-dom"

// at() builds a type-safe path into your model
const nameLens = at<AppModel>()("user", "profile", "name")
// Lens<AppModel, string>: reads and writes model.user.profile.name

// Focus a reusable component on a sub-model
const nameInput = stringInput.focus(nameLens)
```

Under the hood, `at()` and `prop()` build **lenses**: composable accessors from the optics tradition. You don't need to know optics to use them, but the full system is there if you want it: `Iso`, `Lens`, `Prism`, `Affine`, `Getter`, `Fold`, `Setter`, `Review`, and `Traversal` with type-safe composition.

```typescript
import { prop, each } from "static-dom"

// Compose optics to traverse nested structures
const allNames = prop<Model>()("users").compose(each<User>()).compose(prop<User>()("name"))
allNames.getAll(model) // ["Alice", "Bob"]
```

### Using third-party optics

`.focus()` accepts any optic with a `get` method, not just static-dom's own lenses. This means lenses from **fp-ts**, **Effect**, **monocle-ts**, or any other optics library work out of the box:

```typescript
// fp-ts
import * as L from "fp-ts/Lens"
const userLens = pipe(L.id<Model>(), L.prop("user"))
const view = userView.focus(userLens) // works because fp-ts Lens has .get

// Effect
import * as Optic from "@effect/optics"
const nameLens = Optic.id<User>().at("name")
const view = nameView.focus(nameLens) // works because Effect optics have .get

// Any object with a get method
const view = nameView.focus({ get: (model: Model) => model.user.name })
```

The structural protocol is called `Focusable<S, A>`. Only `get` is required:

```typescript
interface Focusable<S, A> {
  get(s: S): A                      // required: read the focused value
  compose?(that: Focusable<A, B>): Focusable<S, B>  // optional: enables focus fusion
  getDelta?(parentDelta: unknown): unknown | undefined // optional: O(1) delta propagation
}
```

When `compose` is present, consecutive `.focus()` calls fuse into a single subscription layer (O(1) per update). When absent, each `.focus()` creates its own layer (still correct, just O(depth)). static-dom's own `prop()` and `at()` lenses provide all three methods for maximum performance.

## React interop

Drop static-dom subtrees into existing React apps:

```tsx
import { SDOMBoundary } from "@static-dom/react"

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

On targeted updates (single row in a 1,000-row table), static-dom's incremental path reaches 88% of Solid.js throughput while routing all state through a single whole-model `update(msg, model)` function rather than fine-grained per-leaf signals. On bulk attribute updates, the basic `array()` path beats Solid by 17%. On the krausest js-framework-benchmark suite, static-dom matches or beats Solid 1.9.3 across all nine keyed benchmarks.

See [BENCHMARKS.md](./BENCHMARKS.md) for full results and [RECOMMENDATION.md](./RECOMMENDATION.md) for tuning guidance.

## Build tooling

| Package | Description |
|---|---|
| `@static-dom/vite` | Vite plugin (`sdomJsx()`) |
| `@static-dom/esbuild` | esbuild plugin and SWC config helper |
| `@static-dom/eslint` | `no-dynamic-children` lint rule |
| `@static-dom/vdom` | Tachys-backed virtual DOM boundary |
| `@static-dom/react` | React adapter (`<SDOMBoundary>`) |

## License

Dual licensed under [Apache 2.0](./LICENSE-APACHE) or [MIT](./LICENSE-MIT).
