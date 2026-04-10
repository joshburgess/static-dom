# @sdom/core

A TypeScript UI library that eliminates virtual DOM diffing by fixing DOM structure at mount time. Only leaf values (text content, attributes) update in place — no intermediate representation, no reconciliation.

Based on Phil Freeman's [purescript-sdom](https://github.com/paf31/purescript-sdom) and [blog post](https://blog.functorial.com/posts/2018-03-12-You-Might-Not-Need-The-Virtual-DOM.html).

## The idea

Most UI updates don't change the structure of the DOM — they change text, toggle classes, or update attributes. SDOM encodes this as a type-level guarantee: the DOM tree is created once during `attach`, and after that only leaf values are patched directly.

This gives you:
- **No diffing** — updates go straight to the DOM node that changed
- **Predictable performance** — cost is proportional to what changed, not tree size
- **Simple mental model** — components are just functions from model to leaf values

## Quick start

```typescript
import { element, text, program } from "@sdom/core"

interface Model { count: number }
type Msg = { type: "inc" } | { type: "dec" }

const view = element<"div", Model, Msg>("div", {}, [
  text(m => String(m.count)),
  element("button", {
    on: { click: () => ({ type: "inc" }) },
  }, [text(() => "+")]),
  element("button", {
    on: { click: () => ({ type: "dec" }) },
  }, [text(() => "-")]),
])

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

## Core API

### Constructors

| Function | Description |
|---|---|
| `element(tag, attrs, children)` | HTML element with type-safe attributes and events |
| `text(fn)` | Text node derived from the model |
| `staticText(str)` | Static text node (no model dependency) |
| `array(tag, getItems, itemSdom)` | Dynamic keyed list with LIS-based minimum DOM moves |
| `indexedArray(tag, getItems, itemSdom)` | Non-keyed positional patching (no Map overhead) |
| `optional(prism, inner)` | Conditionally present subtree via Prism or Affine |
| `fragment(children)` | Group nodes without a wrapper element |
| `compiled(setup)` | Fused single-observer template for maximum performance |
| `component(setup)` | Escape hatch for third-party integrations |
| `wrapChannel(inner, interpret)` | Lower a channeled SDOM to plain SDOM |

### Combinators (methods on SDOM)

| Method | Description |
|---|---|
| `.focus(lens)` | Narrow the model via a lens (with focus fusion) |
| `.mapMsg(fn)` | Transform outgoing messages |
| `.contramap(fn)` | Narrow the model (read-only) |
| `.showIf(predicate)` | Toggle visibility via `display: none` |

### Program runners

| Function | Description |
|---|---|
| `program(config)` | Mount with synchronous updates |
| `programWithEffects(config)` | `update` returns `[Model, Cmd<Msg>]` |
| `programWithDelta(config)` | Delta-aware with fast-path dispatch |
| `programWithSub(config)` | Pure update loop + Elm-style subscriptions |
| `elmProgram(config)` | Full Elm runtime (Cmd + Sub) |

## Optics

SDOM includes a unified optics system using structural subtyping. A single `Optic` base type produces `Iso`, `Lens`, `Prism`, `Affine`, and `Traversal` as subtypes, with composition rules falling out automatically:

```
         Iso
       /     \
    Lens     Prism
       \     /
       Affine
         |
      Traversal
```

Lens + Prism = Affine. Any optic + Traversal = Traversal.

```typescript
import { prop, at, each, lensOf, prismOf, affineOf, nullablePrism } from "@sdom/core"

// Path selectors — compose prop lenses in one call
const nameLens = at<AppModel>()("user", "profile", "name")
// Lens<AppModel, string>

// Focus a component on a sub-model
const nameInput = stringInput.focus(prop<User>()("name"))

// Traversal — focus on all elements of an array
const allNames = prop<Model>()("users")
  .compose(each<User>())
  .compose(prop<User>()("name"))

allNames.getAll(model)                              // ["Alice", "Bob"]
allNames.modifyAll(s => s.toUpperCase())(model)     // uppercases all names
allNames.fold((acc, n) => acc + 1, 0)(model)        // count

// Prism — discriminated unions
const circlePrism = prismOf<Shape, Circle>(
  s => s.kind === "circle" ? s : null,
  c => c,
)

// Affine — nullable fields (partial get + whole-dependent set)
const bioAffine = nullablePrism<Profile>()("bio")

// modify on any optic type
nameLens.modify(s => s.toUpperCase())(model)
```

All optics carry optional `getDelta` for O(1) delta propagation through `.focus()`.

## Elm Architecture

Full Elm-style architecture with commands, subscriptions, navigation, and ports:

```typescript
import { elmProgram, noCmd, httpGetJson, onUrlChange, delay } from "@sdom/core"

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

### Commands (`Cmd<Msg>`)

`httpRequest`, `httpGetJson`, `httpPostJson`, `randomInt`, `randomFloat`, `delay`, `nextTick`, `mapCmd`, `noCmd`, `batchCmd`

### Subscriptions (`Sub<Msg>`)

`interval`, `animationFrame`, `onWindow`, `onDocument`, `noneSub`, `batchSub`

### Navigation

`pushUrl`, `replaceUrl`, `back`, `forward`, `onUrlChange`, `onHashChange`, `currentUrl`

### Ports (typed JS interop)

`createInPort`, `createOutPort`, `portSub`, `portCmd`

## Incremental Rendering

For large lists, SDOM provides a delta-based rendering system that skips the dispatch chain entirely:

| Function | Description |
|---|---|
| `incrementalArray(tag, getItems, getDelta, itemSdom)` | Keyed delta consumption for O(1) per-patch updates |
| `programWithDelta(config)` | Delta-aware program runner with `extractDelta` and `patchItem` |
| `produce(model, fn)` | Immer-style proxy for automatic delta generation |
| `diffRecord(prev, next)` | Shallow delta inference by field reference equality |

## JSX Runtime

SDOM supports JSX via the automatic runtime (`jsx: "automatic"`). The JSX transform classifies props and delegates to SDOM constructors — compilable subtrees are auto-optimized into `compiled()` nodes.

```tsx
// tsconfig.json or vite config: jsx: "automatic", jsxImportSource: "@sdom/core"

const view = (
  <div class={m => m.active ? "active" : ""}>
    <span>{m => m.label}</span>
    <button onClick={(_e, m) => ({ type: "clicked", id: m.id })}>
      Click me
    </button>
  </div>
)
```

### Build tooling

| Export | Description |
|---|---|
| `@sdom/core/vite` | Vite plugin — `sdomJsx()` |
| `@sdom/core/esbuild` | esbuild plugin + SWC config helper |
| `@sdom/core/eslint` | `no-dynamic-children` rule for static children verification |

### Built-in JSX components

| Component | Description |
|---|---|
| `<Show when={predicate}>` | Conditional visibility (wraps `showIf`) |
| `<For each={getItems}>` | Keyed list (wraps `array`) |
| `<Optional prism={prism}>` | Conditional subtree (wraps `optional`) |

## Typing Strategy

SDOM uses `NoInfer` on `element`'s `attrInput` and `children` parameters so that `Model` and `Msg` types flow top-down via contextual return typing:

- **Root elements** need explicit type parameters: `element<"div", Model, Msg>("div", ...)`
- **Nested elements** infer everything from context
- **Event handlers** return plain objects — contextual typing narrows them to the correct Msg union member

## Performance

SDOM is designed for fast updates, not fast initial renders. On targeted
updates (single row change in a 1,000-row table), SDOM's incremental layer
reaches **88% of Solid.js throughput in real Chromium** while using a simpler
whole-model architecture (no signals, no dependency tracking). On bulk
attribute updates, SDOM's basic `array()` path **beats Solid by 17%**.

See [BENCHMARKS.md](./BENCHMARKS.md) for full results across React, Preact,
Inferno, and Solid.js. See [RECOMMENDATION.md](./RECOMMENDATION.md) for
guidance on which APIs, constructors, and settings to use for best
performance.

### Optimization tiers

| Tier | Technique | Single-row ops/s (Chromium) |
|---|---|---:|
| 0 | `array` + `element` (same-structure fast path) | ~27,000 |
| 1 | `incrementalArray` + keyed deltas | ~50,000 |
| 2 | `programWithDelta` fast-path | ~50,000 |
| 3 | `patchItem` + `compiled` + disabled guards | ~177,000 |
| — | Solid.js (signal-per-leaf) | ~201,000 |

### Optics overhead

| Operation | Optic | Raw baseline | Overhead |
|---|---|---|---|
| Single lens get | 8.5M ops/s | 8.6M ops/s | ~1% |
| Prism preview (match) | 8.6M ops/s | 8.6M ops/s | 0% |
| Prism preview (miss) | 8.7M ops/s | 8.6M ops/s | 0% |
| Composed 3-deep get | 6.9M ops/s | 8.7M ops/s | 1.25x |
| Lens modify | 7.2M ops/s | 8.5M ops/s | 1.17x |

### Additional features

- **Error boundaries** — `setErrorHandler` for catching errors during attach/update
- **Dev mode** — `setDevMode` for model shape validation and warnings
- **Event delegation** — `createDelegator` for shared event handling (from Inferno)
- **Focus fusion** — consecutive `.focus()` calls compose into a single lens/observer

## Status

All 5 layers are complete with 486 tests across 36 test files:

```
Layer 5  JSX runtime & build tooling            [complete]
Layer 4  Delta-based incremental updates         [complete]
Layer 3  Elm architecture (Cmd + Sub + Ports)    [complete]
Layer 2  React boundary component                [complete]
Layer 1  Core library                            [complete]
```

See [ROADMAP.md](./ROADMAP.md) for details on each layer.

## License

MIT
