# static-dom Performance Architecture

This document describes the optimization techniques used in static-dom, their
origins, and how they compose into the tiered performance model.

## Core principle

static-dom's foundational insight (from Phil Freeman's purescript-sdom) is that most
UI updates don't change DOM structure; they change text, attributes, and
classes. By fixing the DOM tree at mount time and only patching leaf values,
static-dom eliminates the virtual DOM diff entirely.

This means update cost is proportional to **what changed**, not **tree size**.
A single row update in a 1,000-row table patches one text node: O(1), not
O(n).

## Optimization layers

### Direct property assignment (from browser APIs)

HTML attributes like `class`, `for`, `tabindex` have corresponding DOM
properties (`className`, `htmlFor`, `tabIndex`) that are faster to set.
`el.className = "active"` avoids the `setAttribute` → attribute parsing →
reflection pipeline.

**File:** `packages/core/src/constructors.ts` (`ATTR_TO_PROP` map, `PropUpdater` class).

### Prototype-based updaters (from V8 optimization guides)

Each attribute updater (`PropUpdater`, `StringAttrUpdater`, `BoolAttrUpdater`,
`StyleUpdater`, `ClassMapUpdater`) is a class instance with a stable V8 hidden
class. This gives monomorphic `.run()` calls instead of polymorphic closure
invocations.

Closures created inline (`{ update() { ... } }`) get different hidden classes
at each call site. Class instances share one hidden class across all instances,
enabling V8's inline caches.

**File:** `packages/core/src/constructors.ts` (updater class hierarchy).

### Bitwise element flags (from Inferno.js)

At element construction time, two flags are computed: `HAS_ATTRS` and
`HAS_CHILDREN`. The update loop checks these flags to skip empty paths
entirely, avoiding function calls and array allocations for elements without
attributes or children.

Inferno uses more granular flags (`VNodeFlags`, `ChildFlags`) to classify
vnodes for optimized diffing. static-dom's approach is simpler because there's no
diff; the flags just gate whether to run updaters.

**File:** `packages/core/src/constructors.ts` (`element()` function, flag computation).

### Focus fusion (from lens composition)

Consecutive `.focus()` calls (`view.focus(lensA).focus(lensB)`) are detected
and composed into a single lens (`lensA.compose(lensB)`) at construction time.
This eliminates intermediate subscription layers. Instead of
model → lensA → subscription → lensB → subscription → updater, you get
model → composedLens → subscription → updater.

**File:** `packages/core/src/types.ts` (`_FOCUS_TARGET` / `_FOCUS_LENS` symbols).

### Single-observer fast path (from reactive library patterns)

Subscription containers store the first observer directly in a field (`observer`)
instead of allocating a `Set`. Only when a second subscriber arrives does the
Set get created. Since most static-dom nodes have exactly one subscriber, this avoids
Set allocation and iteration overhead for the common case.

**File:** `packages/core/src/incremental.ts` (`ItemEntry` type), `packages/core/src/program.ts` (`deltaUpdates`).

### Incremental arrays with keyed deltas (from incremental lambda calculus)

Phil Freeman mentions the incremental lambda calculus as a future direction.
`incrementalArray` implements this: instead of diffing old vs new arrays, the
update function provides a structured delta (`keyedPatch`, `keyedInsert`,
`keyedRemove`, `keyedMove`) describing what changed.

For a single-item patch, this is O(1): one Map lookup, one observer
notification, one DOM write. No reconciliation, no key scanning.

**File:** `packages/core/src/incremental.ts` (`incrementalArray()`).

### Fast-patch handler (from Most.js stream fusion)

Most.js achieves performance by fusing stream operators, eliminating
intermediate allocations and function calls by composing operations at
subscription time rather than at event time.

static-dom applies this principle via `_fastPatchHandler`: when `programWithDelta`
sees a single-item keyed patch delta, it short-circuits the entire subscription
chain and calls the handler directly:

```
Normal path:  dispatch → update() → delta → observer → incrementalArray → applyOp → pushItemUpdate → item observer → updaters
Fast path:    dispatch → extract delta → _fastPatchHandler(key, value) → item observer → updaters
```

**File:** `packages/core/src/incremental.ts` (`_registerFastPatch`, `_tryFastPatch`).
**File:** `packages/core/src/program.ts` (`tryDeltaFastPath()` in `programWithDelta`).

### Pooled delta constructors (from object pooling)

`pooledKeyedPatch`, `pooledKeyedRemove`, `pooledKeyedInsert` reuse mutable
shared objects instead of allocating new ones per update. Safe because deltas
are consumed synchronously within the same microtask.

**File:** `packages/core/src/patch.ts` (`pooledKeyedPatch()` and related functions).

### `extractDelta` pre-update hook (from Most.js)

`programWithDelta` accepts an optional `extractDelta` function called BEFORE
`update()`. If the extracted delta is handled by the fast-patch path,
`update()` is never called, skipping the entire model computation (e.g., a
1,000-element array spread).

This is stream fusion applied to the update loop: the delta "fuses" with the
dispatch, bypassing the model transformation entirely.

**File:** `packages/core/src/program.ts` (`extractDelta` in `DeltaProgramConfig`).

### `compiled()` fused templates (from Inferno.js)

Inferno's compiler generates optimized `createVNode` calls with pre-classified
flags. static-dom's `compiled()` constructor takes a similar approach: the user
provides a single function that creates DOM nodes and returns an `update`
callback. This fuses all per-element overhead into one observer:

- 1 observer instead of N (one per attribute/text node)
- No guard/dev overhead (the user's function handles everything)
- Direct DOM property writes (no updater dispatch)

**File:** `packages/core/src/constructors.ts` (`compiled()`).

### `patchItem` direct-patch API

The absolute minimum overhead path. `patchItem(key, value)` on a
`ProgramHandle` calls `_tryFastPatch` directly, bypassing dispatch, update,
delta extraction, and the subscription chain entirely:

```
patchItem(key, value) → _tryFastPatch → registered handler → item observer → DOM write
```

The model is NOT updated through this path. Use for maximum throughput when
you know exactly which keyed item changed.

**File:** `packages/core/src/program.ts` (`patchItem` on `ProgramHandle`).

### LIS-based reordering (from Inferno.js)

When `incrementalArray` falls back to full reconciliation (no delta provided),
it uses the Longest Increasing Subsequence algorithm to compute the minimum
number of DOM moves needed to reorder elements. This is O(n log n) vs the
naive O(n) approach that may perform unnecessary moves.

Inferno pioneered this approach in the vdom world; static-dom applies it to its
keyed array reconciliation.

**File:** `packages/core/src/constructors.ts` (`lis()`).

### Event delegation (from Inferno.js)

A single event listener per event type is registered on a root element.
Events are routed to handlers via a `WeakMap` keyed by target element. This
reduces the number of active listeners from O(n) to O(event types) and avoids
listener teardown/re-registration when items are added or removed.

**File:** `packages/core/src/delegation.ts` (`createDelegator()`).

### Non-keyed indexed array (from Inferno.js)

`indexedArray` does positional patching without keys or a Map. Each slot gets
one observer. When the array length doesn't change (the common case for fixed
lists), this is pure positional update with zero reconciliation overhead.

**File:** `packages/core/src/constructors.ts` (`indexedArray()`).

### Guard and dev mode flags

`setGuardEnabled(false)` disables try/catch wrappers around user-provided
functions (attribute derivers, event handlers). `setDevMode(false)` disables
Object.keys shape validation. Both are safe for production builds and
eliminate per-update overhead.

**File:** `packages/core/src/errors.ts`, `packages/core/src/dev.ts`.

## How the layers compose

The optimization tiers stack additively. Each tier includes all
optimizations from the tiers below it:

```
Tier 0: Standard array + element constructors
  Uses: direct property assignment, prototype-based updaters, bitwise flags,
        focus fusion, single-observer fast path, LIS reordering

Tier 1: incrementalArray
  Adds: keyed delta consumption (skip reconciliation entirely)

Tier 2: programWithDelta
  Adds: fast-patch handler (skip subscription chain for single-patch deltas),
        pooled delta constructors, delta-carrying UpdateStream

Tier 3: patchItem + compiled + disabled guards
  Adds: direct-patch API (skip dispatch/update/delta), fused templates
        (1 observer per item), disabled runtime checks
```

## Architectural boundary: static-dom vs Solid

static-dom's architecture passes whole model objects through a subscription chain:

```
model change → signal → observer → lens.get → subscription → updaters → DOM
```

Solid.js wires each leaf value to its DOM node at creation time:

```
signal change → effect → DOM
```

The fundamental difference: static-dom does a Map lookup + model object comparison
per update. Solid does a direct function call. In happy-dom (where DOM writes
are ~20ns), this difference is ~50x. In a real browser (where DOM writes are
~1-5us), both frameworks are bottlenecked by the same single DOM write, and
the gap compresses to ~1.25x.

static-dom's architecture trades per-update overhead for simplicity: the whole-model
approach means components are plain functions from model to leaf values, with
no signal wiring, no dependency tracking, and no reactive graph. This makes
the programming model simpler and components more testable, at the cost of a
Map lookup and object comparison on each update.
