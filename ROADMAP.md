# SDOM — Project Roadmap

## What this is

A TypeScript implementation of Phil Freeman's `purescript-sdom` concept:
a UI library that eliminates virtual DOM diffing by encoding the guarantee
that DOM structure is fixed after initial render. Only leaf values (text
nodes, attributes) update in place, directly, with no intermediate representation.

## Layer 1: Core library — `static-dom-core`

**Status: complete**

### What's done

- `observable.ts` — typed `Signal<T>`, `UpdateStream<T>`, `Dispatcher<Msg>`,
  `mapUpdate` (the fine-grained subscription primitive)
- `optics.ts` — unified `Optic` base type with structural subtyping:
  - `Iso<S,A>`, `Lens<S,A>`, `Prism<S,A>`, `Affine<S,A>` as subtype aliases
  - Composition via method overloads: Lens+Prism=Affine, Iso+Lens=Lens, etc.
  - `modify()` on all optic types
  - `at<S>()("field1", "field2", ...)` path selectors (up to 6 levels)
  - `prop()`, `composeLenses`, `unionMember`, `nullablePrism` (now returns Affine), `indexLens`
  - Delta propagation via `getDelta` on all optics
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
- Tests: 387 tests across 32 test files
- Benchmarks: 6 scenarios (single-row, attr-update, initial-render, focus-chain,
  compiled-templates, array-reorder) vs React, Preact, Inferno, and Solid.js

---

## Layer 2: React adapter — `static-dom-react`

**Status: complete**

### Goal

Drop SDOM subtrees into existing React apps as a performance optimisation,
with zero changes to the React component tree above them.

### Design

```tsx
import { SDOMBoundary } from "static-dom-core/react"

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

## Layer 3: Elm architecture adapter — `static-dom-elm`

**Status: complete**

`programWithEffects` in Layer 1 already handles the `[Model, Cmd]` return
from update. Layer 3 adds the subscription system, rich commands,
navigation, and ports.

### What's done

- `Sub<Msg>` — subscription type with key-based diffing
- Built-in subscriptions: `interval`, `animationFrame`, `onWindow`, `onDocument`
- `noneSub` / `batchSub` — combinators for composing subscriptions
- `programWithSub` — pure update loop + Elm-style subscriptions
- `elmProgram` — full Elm runtime (Cmd + Sub)
- Subscription diffing: starts new subs, stops removed subs by key after each update
- `cmd.ts` — rich command constructors:
  - `httpRequest`, `httpGetJson`, `httpPostJson` — Fetch-based HTTP commands
  - `randomInt`, `randomFloat` — random value generation
  - `delay`, `nextTick` — time-based message dispatch
  - `mapCmd` — transform command message types
- `navigation.ts` — URL-based routing:
  - `pushUrl`, `replaceUrl`, `back`, `forward` — navigation commands
  - `onUrlChange`, `onHashChange` — navigation subscriptions
  - `currentUrl` — URL snapshot helper
- `ports.ts` — typed JS interop (Elm-style ports):
  - `createInPort` — external JS sends data into SDOM runtime (subscription)
  - `createOutPort` — SDOM runtime sends data to external JS (command)
  - `portSub` / `portCmd` — adapt ports to Sub/Cmd interfaces
- Tests: 11 subscription tests, 12 cmd tests, 13 navigation tests, 13 port tests

### What could still be added

- [x] **`Cmd<Msg>`** — rich command type with built-in HTTP, random, delay, map
- [x] **Navigation** — URL-based routing feeding into the update loop
- [x] **Ports** — typed JS interop matching Elm's port system

---

## Layer 4: Incremental / differentiable rendering — `static-dom-incremental`

**Status: complete**

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
- `diffRecord` — automatic shallow delta inference by field reference equality
- `autoDelta` — wraps plain update functions for automatic delta generation

### What could still be added

- [x] Incremental `optional` (delta-aware mount/unmount)
- [x] Incremental `focus` (skip unchanged subtrees via delta inspection) — already done via `lens.getDelta`
- [x] Automatic delta inference from model diffing — `diffRecord` + `autoDelta`

---

## Layer 5: JSX runtime & build tooling — `static-dom-jsx`

**Status: complete**

### What's done

- `jsx-runtime.ts` — automatic JSX runtime (`jsx`, `jsxs`, `Fragment`)
  - Prop classification: events → `on`, class/className → `rawAttrs.class`,
    style → kebab-cased style map, data-*/aria-* → `rawAttrs`, IDL props → `attrs`
  - Children normalization: functions → `text()`, strings → `staticText()`,
    numbers → `staticText(String(n))`, SDOM nodes → passthrough
  - Full JSX type namespace with `IntrinsicElements` mapped over `HTMLElementTagNameMap`
- `jsx-dev-runtime.ts` — dev runtime delegating to production (future: source locations)
- `vite-plugin.ts` — minimal Vite plugin configuring esbuild's `jsx: "automatic"` mode
- `esbuild-plugin.ts` — esbuild plugin, build options helper, and SWC config helper
- `eslint-plugin.ts` — ESLint rule `no-dynamic-children` for static children verification
- Tests: 26 tests covering all prop types, children, fragments, and integration
- Compiled template optimization: auto-detects compilable subtrees and generates
  `compiled()` nodes with fused single-observer updates instead of per-attr subscriptions
- Tests: 17 additional tests for compiled templates
- Function component support: `jsx()` handles `typeof type === "function"`
- Built-in JSX components: `Show` (showIf), `For` (array), `Optional` (optional/prism)
  - Generic type parameters: `Show<M>`, `For<M, Item>`, `Optional<S, A>`
- `typed<M, Msg>()` — asserts Model/Msg types on JSX-produced SDOM nodes
- Tests: 12 function component tests, 6 typed/generic tests, 7 esbuild tests, 11 ESLint tests

### What could still be added

- [x] Compile-time optimization (converting `jsx()` calls into direct `compiled()` templates)
- [x] Model/Msg type parameter flow through JSX — generic built-in components + `typed()` helper
- [x] Custom JSX components for `array`, `optional`, etc.
- [x] SWC/esbuild standalone plugins (non-Vite bundlers)
- [x] Static analysis to verify children lists are truly static — ESLint `no-dynamic-children` rule

---

## Summary

```
Layer 5  static-dom-jsx         — JSX runtime & build tooling            [complete]
Layer 4  static-dom-incremental — Delta-based updates                    [complete]
Layer 3  static-dom-elm         — Full Elm architecture on top of SDOM   [complete]
Layer 2  static-dom-react       — React boundary component               [complete]
Layer 1  static-dom-core        — Core library                           [complete]
```

Each layer is independently useful and can be adopted without the others.
The most important invariant across all layers: **the DOM structure is fixed
at mount time; only leaf values change thereafter**.
