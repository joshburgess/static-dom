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
- Tests: 200 tests across 20 test files
- Benchmarks: 3 scenarios (single-row, attr-update, initial-render) vs React,
  Preact, Inferno, and Solid.js, in both happy-dom and real Chromium

---

## Layer 2: React adapter — `@sdom/react`

**Status: complete**

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

**Status: substantially complete**

`programWithEffects` in Layer 1 already handles the `[Model, Cmd]` return
from update. Layer 3 adds the subscription system.

### What's done

- `Sub<Msg>` — subscription type with key-based diffing
- Built-in subscriptions: `interval`, `animationFrame`, `onWindow`, `onDocument`
- `noneSub` / `batchSub` — combinators for composing subscriptions
- `programWithSub` — pure update loop + Elm-style subscriptions
- `elmProgram` — full Elm runtime (Cmd + Sub)
- Subscription diffing: starts new subs, stops removed subs by key after each update
- Tests: 11 tests covering sub constructors, diffing, programWithSub, elmProgram

### What could still be added

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

- [x] Incremental `optional` (delta-aware mount/unmount)
- [x] Incremental `focus` (skip unchanged subtrees via delta inspection) — already done via `lens.getDelta`
- [ ] Automatic delta inference from model diffing

---

## Layer 5: JSX runtime & build tooling — `@sdom/jsx`

**Status: in progress**

### What's done

- `jsx-runtime.ts` — automatic JSX runtime (`jsx`, `jsxs`, `Fragment`)
  - Prop classification: events → `on`, class/className → `rawAttrs.class`,
    style → kebab-cased style map, data-*/aria-* → `rawAttrs`, IDL props → `attrs`
  - Children normalization: functions → `text()`, strings → `staticText()`,
    numbers → `staticText(String(n))`, SDOM nodes → passthrough
  - Full JSX type namespace with `IntrinsicElements` mapped over `HTMLElementTagNameMap`
- `jsx-dev-runtime.ts` — dev runtime delegating to production (future: source locations)
- `vite-plugin.ts` — minimal Vite plugin configuring esbuild's `jsx: "automatic"` mode
- Tests: 26 tests covering all prop types, children, fragments, and integration
- Compiled template optimization: auto-detects compilable subtrees and generates
  `compiled()` nodes with fused single-observer updates instead of per-attr subscriptions
- Tests: 17 additional tests for compiled templates

### What could still be added

- [x] Compile-time optimization (converting `jsx()` calls into direct `compiled()` templates)
- [ ] Model/Msg type parameter flow through JSX
- [ ] Custom JSX components for `array`, `optional`, etc.
- [ ] SWC/esbuild standalone plugins (non-Vite bundlers)
- [ ] Static analysis to verify children lists are truly static

---

## Summary

```
Layer 5  @sdom/jsx         — JSX runtime & build tooling            [substantially complete]
Layer 4  @sdom/incremental — Delta-based updates                    [substantially complete]
Layer 3  @sdom/elm         — Full Elm architecture on top of SDOM   [substantially complete]
Layer 2  @sdom/react       — React boundary component               [complete]
Layer 1  @sdom/core        — Core library                           [complete]
```

Each layer is independently useful and can be adopted without the others.
The most important invariant across all layers: **the DOM structure is fixed
at mount time; only leaf values change thereafter**.
