# @sdom/core

A UI library that eliminates virtual DOM diffing by fixing DOM structure at mount time. Only leaf values (text content, attributes) update in place — no intermediate representation, no reconciliation.

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

## API

### Constructors

| Function | Description |
|---|---|
| `element(tag, attrs, children)` | HTML element with type-safe attributes and events |
| `text(fn)` | Text node derived from the model |
| `staticText(str)` | Static text node (no model dependency) |
| `array(tag, getItems, itemSdom)` | Dynamic keyed list with DOM node reuse |
| `optional(prism, inner)` | Conditionally present subtree |
| `fragment(children)` | Group nodes without a wrapper element |
| `component(setup)` | Escape hatch for third-party integrations |

### Combinators (methods on SDOM)

| Method | Description |
|---|---|
| `.focus(lens)` | Narrow the model via a lens |
| `.mapMsg(fn)` | Transform outgoing messages |
| `.contramap(fn)` | Narrow the model (read-only) |
| `.showIf(predicate)` | Toggle visibility via `display: none` |

### Program runners

| Function | Description |
|---|---|
| `program(config)` | Mount an SDOM program with synchronous updates |
| `programWithEffects(config)` | Same, but `update` returns `[Model, Cmd<Msg>]` |

### Optics

```typescript
import { prop, lens, prism, composeLenses } from "@sdom/core"

// Focus a component on a sub-model field:
const nameInput = stringInput.focus(prop<User>()("name"))

// Compose lenses:
const streetLens = composeLenses(prop<User>()("address"), prop<Address>()("street"))
```

## Typing strategy

SDOM uses `NoInfer` on `element`'s `attrInput` and `children` parameters so that `Model` and `Msg` types flow top-down via contextual return typing. In practice this means:

- **Root elements** need explicit type parameters: `element<"div", Model, Msg>("div", ...)`
- **Nested elements** infer everything from context — no casts, no annotations
- **Event handlers** return plain objects: `() => ({ type: "inc" })` — contextual typing narrows them to the correct Msg union member
- **Method chains** (`.showIf()`, `.mapMsg()`) break the contextual chain, so those elements also need explicit type params

## Performance

SDOM is designed for fast updates, not fast initial renders. On targeted
updates (single row change in a 1,000-row table), SDOM's incremental layer
reaches **80% of Solid.js throughput in real Chromium** while using a simpler
whole-model architecture (no signals, no dependency tracking).

See [BENCHMARKS.md](./BENCHMARKS.md) for full results across React, Preact,
Inferno, and Solid.js in both happy-dom and real Chromium. See
[PERFORMANCE.md](./PERFORMANCE.md) for the optimization techniques and how
they compose.

### Optimization tiers

| Tier | Technique | Single-row ops/s (Chromium) |
|---|---|---:|
| 0 | `array` + `element` | ~4,400 |
| 1 | `incrementalArray` + keyed deltas | ~50,000 |
| 2 | `programWithDelta` fast-path | ~52,000 |
| 3 | `patchItem` + `compiled` + disabled guards | ~179,000 |
| — | Solid.js (signal-per-leaf) | ~223,000 |

## Advanced constructors

| Function | Description |
|---|---|
| `indexedArray(tag, getItems, itemSdom)` | Non-keyed positional patching — no Map overhead |
| `incrementalArray(tag, getItems, getDelta, itemSdom)` | Keyed delta consumption for O(1) updates |
| `compiled(setup)` | Fused single-observer template — maximum control |
| `programWithDelta(config)` | Delta-aware program runner with fast-path dispatch |

## Status

Layer 1 (core library) is complete with 127 tests and benchmarks across
happy-dom and real Chromium. Layer 4 (incremental/delta rendering) is
substantially complete. Layer 2 (React adapter) is in progress. See
[ROADMAP.md](./ROADMAP.md) for the full layer plan.

## License

MIT
