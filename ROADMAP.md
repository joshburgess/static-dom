# SDOM — Project Roadmap

## What this is

A TypeScript implementation of Phil Freeman's `purescript-sdom` concept:
a UI library that eliminates virtual DOM diffing by encoding the guarantee
that DOM structure is fixed after initial render. Only leaf values (text
nodes, attributes) update in place, directly, with no intermediate representation.

## Layer 1 (current): Core library — `@sdom/core`

**Status: skeleton complete**

### What's done

- `observable.ts` — typed `Signal<T>`, `UpdateStream<T>`, `Dispatcher<Msg>`,
  `mapUpdate` (the fine-grained subscription primitive)
- `optics.ts` — `Lens<S,A>`, `Prism<S,A>`, `Iso<S,A>`, `prop()`, `composeLenses`,
  `unionMember`, `indexLens`
- `types.ts` — `SDOM<Model, Msg>` type with method combinators (`focus`, `mapMsg`,
  `contramap`, `showIf`), full channel types, `makeSDOM` factory
- `constructors.ts` — `text`, `element`, `array`, `optional`, `component`,
  `fragment`, `wrapChannel`
  - `element` uses `HTMLElementTagNameMap` for tag-to-props type safety
  - `element` uses `HTMLElementEventMap` for event-to-event-type safety
  - `array` does keyed reconciliation with DOM node reuse
  - `optional` creates/destroys subtrees via Prism
- `program.ts` — `program` and `programWithEffects` (Elm-style Cmd support)
- `index.ts` — clean public API surface

### What's needed to complete Layer 1

- [ ] **Tests** — headless (jsdom or happy-dom) unit tests for each constructor
  - `text`: verifies `textContent` is updated, not replaced
  - `element`: verifies attributes are set/updated, events fire correctly
  - `array`: verifies DOM reuse by key (node identity preserved across updates)
  - `optional`: verifies mount/unmount cycle
  - `focus`: verifies that updates to unrelated model slices don't fire subscriptions
- [ ] **Benchmark** — vs. React/Preact/Solid for:
  - 10k row table initial render
  - 1k row table, one row changes per tick
  - Attribute-only updates (should show the biggest SDOM win)
- [ ] **`array` stability** — current implementation does O(n) key lookup on every
  update; replace with a `Map<key, index>` cache
- [ ] **Error boundaries** — wrap `attach` calls in try/catch, surface errors
  to a configurable handler rather than crashing the whole tree
- [ ] **Dev mode** — in non-production builds, validate SDOM invariants:
  - Warn if an `element` child list changes length between calls
  - Warn if model types seem to have changed shape

---

## Layer 2: React/Preact adapter — `@sdom/react`

**Goal:** Drop SDOM subtrees into existing React apps as a performance optimisation,
with zero changes to the React component tree above them.

### Design

```tsx
import { SDOMBoundary } from "@sdom/react"

// Inside any React component:
<SDOMBoundary
  sdom={myExpensiveTable}    // SDOM<TableModel, TableMsg>
  model={tableModel}          // TableModel — passed as React prop
  onMsg={handleTableMsg}      // (msg: TableMsg) => void
/>
```

`SDOMBoundary` is a React class component that:
1. `componentDidMount`: calls `sdom.attach(this.containerRef, props.model, ...)`
2. `componentDidUpdate`: fires the update stream with `{ prev, next }` pairs
   derived from `props.model` changing
3. `shouldComponentUpdate`: always returns `false` for the subtree — React
   never diffs inside the boundary
4. `componentWillUnmount`: calls `teardown()`

This gives you React DevTools integration and composability at the boundary level
while SDOM handles everything inside.

### Key type challenge

React passes `model` as a prop on re-renders. We need to convert the "prop changed"
React lifecycle into the `UpdateStream<Model>` that SDOM expects. A simple `Subject`
inside the component bridges this.

---

## Layer 3: Elm architecture adapter — `@sdom/elm`

**Goal:** A full Elm-style `Program` type on top of SDOM, making it a complete
application framework with the same `init / update / view / subscriptions` structure.

```typescript
import { ElmProgram } from "@sdom/elm"

ElmProgram.element({
  init: (flags) => [initialModel, Cmd.none],
  update: (msg, model) => [newModel, cmd],
  view: (model) => sdomView,  // SDOM<Model, Msg> — not Html.Html
  subscriptions: (model) => Sub.batch([
    Time.every(1000, tick => ({ type: "tick", time: tick })),
  ]),
})
```

This is straightforward given that `programWithEffects` in Layer 1 already handles
the `[Model, Cmd]` return from update. What Layer 3 adds:

- **`Sub<Msg>`** — a subscription type (interval timers, websockets, keyboard, etc.)
  that integrates with the update loop
- **`Cmd<Msg>`** — a richer command type with built-in HTTP, random, ports
- **Navigation** — URL-based routing that feeds into the update loop
- **Ports** — typed JS interop matching Elm's port system

The value of this layer: existing Elm codebases can be progressively migrated
by swapping `elm/html` views for SDOM views while keeping the Elm architecture
entirely intact.

---

## Layer 4: Incremental / differentiable rendering — `@sdom/incremental`

Phil Freeman mentions this in the blog post addendum:

> I'm also working on another approach based on the *incremental lambda calculus*.

The incremental lambda calculus gives you:
- A `Δ Model` type for each model — the type of changes to the model
- Functions that are "differentiable" — given `Δ Model` they compute `Δ Output`
  without recomputing from scratch

For SDOM, this would mean:
- `array` with O(1) insertions/removals anywhere in the list (not just the end)
- Form validation that only recomputes affected fields
- Derived views that memoize intermediate results

This is the hardest layer and requires a well-thought-out `Patch<T>` type for
all model types. Libraries like `immer` and `automerge` provide inspiration.

---

## Layer 5: Compiler / syntax sugar — `@sdom/jsx`

A Babel/TypeScript transform that compiles JSX to SDOM constructor calls:

```tsx
// Input (JSX):
const view = <div class={m => m.error ? "error" : ""}>
  <span>{m => m.label}</span>
</div>

// Output (SDOM constructors):
const view = element("div", {
  rawAttrs: { class: m => m.error ? "error" : "" }
}, [
  element("span", {}, [text(m => m.label)])
])
```

This makes the authoring experience as close to React/Solid as possible while
preserving all the type safety guarantees. The compiler can also:
- Statically verify that JSX children lists are truly static (no conditional children
  that aren't wrapped in `optional` or `showIf`)
- Auto-insert `optional` around nullable expressions
- Warn when a lambda captures state that defeats the static-DOM guarantee

---

## Summary

```
Layer 5  @sdom/jsx         — JSX transform & static analysis
Layer 4  @sdom/incremental — Δ-model, arbitrary array insertions
Layer 3  @sdom/elm         — Full Elm architecture on top of SDOM
Layer 2  @sdom/react       — React boundary component for migration
Layer 1  @sdom/core        — Core library (current)   ← YOU ARE HERE
```

Each layer is independently useful and can be adopted without the others.
The most important invariant across all layers: **the DOM structure is fixed
at mount time; only leaf values change thereafter**.
