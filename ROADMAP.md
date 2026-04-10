# SDOM — Project Roadmap

## What this is

A TypeScript implementation of Phil Freeman's `purescript-sdom` concept:
a UI library that eliminates virtual DOM diffing by encoding the guarantee
that DOM structure is fixed after initial render. Only leaf values (text
nodes, attributes) update in place, directly, with no intermediate representation.

## Layer 1: Core library — `@sdom/core`

**Status: complete**

### What's done

- `observable.ts` — typed `Signal<T>`, `UpdateStream<T>`, `Dispatcher<Msg>`,
  `mapUpdate` (the fine-grained subscription primitive)
- `optics.ts` — `Lens<S,A>`, `Prism<S,A>`, `Iso<S,A>`, `prop()`, `composeLenses`,
  `unionMember`, `indexLens`
- `types.ts` — `SDOM<Model, Msg>` type with method combinators (`focus`, `mapMsg`,
  `contramap`, `showIf`), focus fusion (`_FOCUS_TARGET`/`_FOCUS_LENS`), `makeSDOM`
- `constructors.ts` — `text`, `staticText`, `element`, `array`, `indexedArray`,
  `optional`, `component`, `compiled`, `fragment`, `wrapChannel`, `lis`
  - `element` uses `HTMLElementTagNameMap` for tag-to-props type safety
  - `element` uses `HTMLElementEventMap` for event-to-event-type safety
  - `array` does keyed reconciliation with LIS-based minimum DOM moves
  - `indexedArray` does non-keyed positional patching
  - `compiled` for fused single-observer templates
  - Prototype-based updaters (`PropUpdater`, `StringAttrUpdater`, etc.)
  - Direct property assignment via `ATTR_TO_PROP` map
  - Bitwise element flags (`HAS_ATTRS`, `HAS_CHILDREN`)
- `incremental.ts` — `incrementalArray` with keyed deltas, fast-patch handler
- `patch.ts` — `KeyedArrayDelta`, `RecordDelta`, `produce`, `fieldDelta`,
  pooled delta constructors (`pooledKeyedPatch`, etc.), `diffKeyed`
- `program.ts` — `program`, `programWithEffects` (Elm-style Cmd), `programWithDelta`
  (delta-aware with `extractDelta` and `patchItem`)
- `errors.ts` — error boundaries with `setErrorHandler`, `setGuardEnabled`
- `dev.ts` — dev mode with `setDevMode`, shape validation
- `delegation.ts` — event delegation with `createDelegator`
- Tests: 127 tests across 15 test files
- Benchmarks: 3 scenarios (single-row, attr-update, initial-render) vs React,
  Preact, Inferno, and Solid.js, in both happy-dom and real Chromium

---

## Layer 2: React adapter — `@sdom/react`

**Status: in progress**

### Goal

Drop SDOM subtrees into existing React apps as a performance optimisation,
with zero changes to the React component tree above them.

### Design

```tsx
import { SDOMBoundary } from "@sdom/core/react"

// Inside any React component:
<SDOMBoundary
  sdom={myExpensiveTable}    // SDOM<TableModel, TableMsg>
  model={tableModel}          // TableModel — passed as React prop
  onMsg={handleTableMsg}      // (msg: TableMsg) => void
/>
```

`SDOMBoundary` is a React component that:
1. On mount: calls `sdom.attach(containerRef, model, updates, dispatch)`
2. On model prop change: pushes `{ prev, next }` through the UpdateStream
3. Prevents React from diffing inside the boundary (memo)
4. On unmount: calls `teardown()`

A lower-level `useSDOMBoundary` hook is also provided for custom container
elements.

### Key design decision

React passes `model` as a prop on re-renders. A bridge converts the "prop
changed" React lifecycle into the `UpdateStream<Model>` that SDOM expects.

---

## Layer 3: Elm architecture adapter — `@sdom/elm`

**Status: partially done**

`programWithEffects` in Layer 1 already handles the `[Model, Cmd]` return
from update. What Layer 3 would add:

- [ ] **`Sub<Msg>`** — a subscription type (interval timers, websockets, keyboard, etc.)
  that integrates with the update loop
- [ ] **`Cmd<Msg>`** — a richer command type with built-in HTTP, random, ports
- [ ] **Navigation** — URL-based routing that feeds into the update loop
- [ ] **Ports** — typed JS interop matching Elm's port system

---

## Layer 4: Incremental / differentiable rendering — `@sdom/incremental`

**Status: substantially complete**

### What's done

- `incrementalArray` — keyed array with O(1) per-patch updates
- `KeyedArrayDelta` — structured deltas for insert, remove, move, patch
- `RecordDelta` — field-level deltas for records
- `produce` — immer-style proxy for automatic delta generation
- `fieldDelta` — extract sub-deltas through record fields
- Delta propagation through `focus` via `lens.getDelta`
- `programWithDelta` — delta-aware program runner
- `extractDelta` — pre-update delta hook for skipping model computation
- `patchItem` — direct-patch API bypassing entire dispatch chain
- Fast-patch handler — short-circuits subscription chain for single patches
- Pooled delta constructors — zero-alloc reusable delta objects

### What could still be added

- [ ] Incremental `optional` (delta-aware mount/unmount)
- [ ] Incremental `focus` (skip unchanged subtrees via delta inspection)
- [ ] Automatic delta inference from model diffing

---

## Layer 5: Compiler / syntax sugar — `@sdom/jsx`

**Status: not started**

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

The compiler could also:
- Statically verify that JSX children lists are truly static
- Auto-insert `optional` around nullable expressions
- Generate `compiled()` templates for leaf components (fused single-observer)

---

## Summary

```
Layer 5  @sdom/jsx         — JSX transform & static analysis        [not started]
Layer 4  @sdom/incremental — Delta-based updates                    [substantially complete]
Layer 3  @sdom/elm         — Full Elm architecture on top of SDOM   [partially done]
Layer 2  @sdom/react       — React boundary component               [in progress]  ← YOU ARE HERE
Layer 1  @sdom/core        — Core library                           [complete]
```

Each layer is independently useful and can be adopted without the others.
The most important invariant across all layers: **the DOM structure is fixed
at mount time; only leaf values change thereafter**.
