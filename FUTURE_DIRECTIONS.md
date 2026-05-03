# Future directions

Captured ideas for performance and architecture work that are out of scope
right now, but worth keeping on the record so we don't lose the reasoning.

## Context

After the text-placeholder mount-path optimization (commit `4d79cdd`), the
js-framework-benchmark numbers for static-dom (script time, ms, 30 iterations)
look like:

```
bench                   static-dom  vanilla-3   solid  svelte v5  inferno  blockdom  alien-sig
01_run1k                      4.70       1.50    2.60       2.90     3.30      2.50       1.90
02_replace1k                  8.40       3.30    5.20       6.00     5.00      4.80       3.60
03_update10th1k_x16           1.95       0.30    0.90       1.10     1.00      0.50       0.60
04_select1k                   1.00       0.00    0.80       2.40     0.90      0.90       0.20
05_swap1k                     1.10       0.10    1.20       1.50     0.90      0.70       0.10
06_remove-one-1k              0.60       0.10    0.40       0.60     0.30      0.30       0.10
07_create10k                 59.95      16.00   30.50      33.70    37.40     29.30      28.00
08_create1k-after1k_x2        6.30       1.50    2.90       3.20     3.70      2.20       2.10
09_clear1k_x8                12.45       6.80   10.10       8.00     7.00      7.00       6.90
```

Tier read: solidly competitive with sinuous and ahead of preact-classes /
svelte-classic, but roughly 2x off solid / svelte / inferno on creates and
2-3x off the leaders on point updates. Two architectural changes would close
most of the gap. Both stay compatible with the sdom + optics model.

## Why we are slow (root cause analysis)

Per-row instantiation cost on `07_create10k` is roughly 6 us / row vs
vanilla's 2.2 us / row. The overhead lives in three places:

1. **Megamorphic walker dispatch.** Every template compiles its own
   `NodeWalker` function. The call site `binding.walk(clone)` sees many
   distinct function objects across templates and goes megamorphic in V8's
   inline cache. Each call costs roughly 500 ns to 1 us that an inlined
   property access would not.
2. **Generic binding loop.** `instantiateTemplate` iterates an array of
   binding records, switches on `kind`, and calls a closure for each. None
   of this can be inlined because the binding shapes vary.
3. **Diff-on-re-eval update model.** On every render we re-run every
   binding for the affected subtree, compare to `lasts[i]`, and patch on
   diff. Fine-grained reactivity libraries skip this entirely: when a cell
   moves, only the bindings that subscribed to that cell run.

Items 1 and 2 are the create-path bottleneck. Item 3 is the update-path
bottleneck.

## Direction 1: template codegen

Compile each template to a literal JS function so V8 can inline the whole
instantiate / update path.

### Shape

Today, conceptually:

```ts
for (const b of bindings) {
  const node = b.walk(clone)
  const v = b.fn(model)
  if (v !== lasts[i]) node.nodeValue = v
}
```

After codegen, per-template:

```ts
function inst_3(model) {
  const root = TPL_3.cloneNode(true)
  const a = root.firstChild.firstChild
  a.nodeValue = optic0(model)
  const b = a.nextSibling
  b.nodeValue = optic1(model)
  return root
}

function update_3(root, model, lasts) {
  const a = root.firstChild.firstChild
  const v0 = optic0(model)
  if (v0 !== lasts[0]) { a.nodeValue = v0; lasts[0] = v0 }
  const b = a.nextSibling
  const v1 = optic1(model)
  if (v1 !== lasts[1]) { b.nodeValue = v1; lasts[1] = v1 }
}
```

No megamorphic call sites. No closure dispatch. No binding array. V8 inlines
the whole function.

### Two flavors

- **Build-time codegen** (Vite / Babel plugin). What solid does. Best
  perf, CSP-clean (no `eval`). Requires a plugin and changes the toolchain
  surface.
- **Runtime codegen** via `new Function`. What blockdom does (and why
  blockdom sits at 29 ms on `07_create10k`). One contained change to
  `instantiateTemplate`: on first call for a template, build a function
  source string from the bindings list, `new Function(...)` it, cache,
  call. Breaks under strict CSP without `unsafe-eval`.

### Compatibility with sdom

Full. The user-facing surface (JSX, optics, `dynamic` / `match` / `vdom`
escape hatches, keyed array reconcile) is unchanged. Bindings are still
optic projections `model -> a`. Codegen only changes how the loop runs.

### Expected impact

- `07_create10k`: 60 -> 30-35 ms (matches blockdom / approaches solid).
- `01_run1k`, `02_replace1k`, `08_create1k-after1k_x2`: similar
  proportional win.
- Update benchmarks (`03`, `04`, `05`): minor improvement, since the
  bottleneck there is the update model itself, not dispatch overhead.

### Open questions

- Whether to start with the runtime variant (smaller change, ships
  faster, but CSP cost) or go straight to build-time (bigger change but
  the right end state).
- How much we can pre-resolve walker paths at template-compile time vs
  emitting them as literal `firstChild.nextSibling` chains in the codegen
  output. The latter inlines better but inflates code size.
- Code-size budget. Inlining N bindings produces N copies of the patch
  prelude. For wide templates this matters; we may want a hybrid where
  small templates inline and large ones fall back to the loop.

## Direction 2: Incremental-style updates

Replace the diff-on-re-eval update model with a reified incremental
computation graph. This is the architecturally principled fit for an
optics-first library.

### Background: what Incremental is

Jane Street's `Incremental` (descended from Acar's self-adjusting
computation and Hammer et al.'s Adapton) is a runtime for incremental
computation built on:

1. A DAG of nodes: input cells (`Var`), derived nodes (`map`, `bind`),
   observers at the sinks.
2. Demand-driven recomputation. Only nodes reachable from an observer
   participate; unobserved subgraphs do no work.
3. Topo-order stabilization. Each node has a height; on input change, a
   min-heap drains dirty nodes by height, ensuring each node recomputes
   at most once per stabilization. Glitches (observer sees inconsistent
   intermediate state) are impossible by construction.
4. Cutoff per node. Default is physical equality. If a derived value did
   not actually move, propagation stops. This is the critical efficiency
   knob.
5. `bind` for dynamic graph reshaping. A `bind` node produces a sub-DAG
   whose structure depends on its argument's value. Old subgraphs are
   disposed; new ones wire in.
6. Explicit graph GC. Observers hold things alive; weak refs and
   bookkeeping clean up unreached nodes.

The signal graph in solid / s.js / MobX is the same idea applied to UI,
with two simplifications: push-based scheduling instead of pull, and the
graph is implicit in closures rather than reified as data. Functionally
equivalent for typical UI workloads.

### Mapping to optics

The key elegance: optics + Incremental compose naturally.

| sdom concept                    | Incremental shape                              |
| ------------------------------- | ---------------------------------------------- |
| `Var<Model>` (root signal)      | `Var.t`                                        |
| `Lens<S, A>` projection         | `map` node, lens `A`-equality as cutoff        |
| `Getter` / `Fold`               | `map` nodes                                    |
| `Prism<S, A>` (optional)        | `bind` node: matches -> mount; not -> dispose  |
| `dynamic` / `match`             | `bind` nodes that swap sub-DAGs                |
| Static template + dynamic slot  | `Observer` at a leaf doing `nodeValue = v`     |
| Array reconcile                 | dedicated `array` combinator                   |

The lens equality giving you the cutoff is the elegant part. Today we
do `if (v !== lasts[i]) ...` manually inside `instantiateTemplate` /
`updateTemplate`. With an Incremental runtime that is just the cutoff
function on the derived node. A `Prism` matching or not matching is
`bind` swapping between "mount this subgraph" and "mount nothing." This
is the formalization of "observable lenses": a lens lifts
`Incr<S> -> Incr<A>` with cutoff at the lens's `A`-equality.

Prior art for lens-over-atom in JS: Vesa Karvonen's Calmm.js stack
(`partial.lenses` + `kefir.atom`), and `focal-atom`. Reflex-FRP in
Haskell composes `Lens'` with `Dynamic` by hand. None of these are as
integrated as a dedicated Incremental runtime would be.

### What it gives over solid's signals

- **Compositional with optics, not bolted on.** Each optic kind has a
  natural Incremental counterpart. The library is the optic system
  applied to a reactive substrate, not a separate reactivity API.
- **Reified, debuggable graph.** You can introspect, visualize, dispose,
  and attach observers programmatically. Solid's graph lives inside
  closures and is invisible at runtime.
- **Glitch-free by construction.** Topo-height scheduling means an
  observer never sees inconsistent intermediate state. Solid is mostly
  glitch-free in practice, but the semantics are subtler and there is a
  `batch` API to paper over the cases where it isn't.
- **Cleaner story for `bind`.** Our `dynamic` / `match` / `vdom`
  constructs are exactly `bind` nodes. Today they are handled by ad hoc
  paths in reconcile; under Incremental they collapse into one primitive.

### What it does not give

- **Faster creates.** The `07_create10k` bottleneck is per-row template
  instantiation cost, not update propagation cost. That is a codegen
  problem.
- **Faster point updates than solid.** Solid is already at the pragmatic
  floor for "single signal change -> single DOM mutation." Incremental's
  heap-by-height scheduling has marginally more overhead per update than
  solid's eager push protocol. It is cleaner, not faster.

### Concrete shape of the rewrite

1. **Small Incremental runtime.** `Var`, `Map`, `Bind`, `Observer`,
   `Array`, with topo-height scheduling, cutoff, and observer-driven GC.
   Roughly 500-1000 LOC. Prior art to crib from: `s.js` (~200 LOC, gets
   the protocol right) and Incremental.js (heap scheduling worked out).
2. **Optic lifting layer.**
   `Getter.lift : Getter<S, A> -> Incr<S> -> Incr<A>` (a `map` with the
   getter's equality). `Lens.lift` same plus a setter that produces a
   write-back. `Prism.lift` is `bind`. `Fold.lift` is `map` to a list
   with structural cutoff. The optics module itself does not change; we
   add a lifting module next to it.
3. **Bindings become observers.** In `instantiateTemplate`, each dynamic
   slot registers an `Observer` that mutates the corresponding DOM node
   when its node fires. The template is still a static cloned subtree;
   what changes is the update mechanism for the holes.
4. **`dynamic` / `match` / `vdom` collapse to `bind`.** Their special-case
   logic in `reconcile.ts` is replaced by a single `Bind` primitive that
   owns and disposes subgraphs.
5. **Array reconcile** either becomes a specialized `array` combinator
   (Incremental has one) or stays as a custom node with its own keyed
   diff plumbed into the graph. Probably the latter for benchmark perf.

The library would likely be smaller after this, not bigger, because
`dynamic` / `match` / `reconcile` paths consolidate.

### Compatibility with sdom

Full. The JSX surface, the optics module, and the `instantiateTemplate`
skeleton all stay. The diff-on-re-eval reconcile gets replaced with
graph stabilization. The "render is a pure function of model" property
is preserved; we are just computing that function incrementally.

## Layering

The two directions are orthogonal and can be done independently:

| Layer        | What it changes                | What it improves                |
| ------------ | ------------------------------ | ------------------------------- |
| Codegen      | instantiate / update path      | creates, replaces (`01`, `02`, `07`, `08`) |
| Incremental  | update model                   | point updates (`03`, `04`, `05`), code clarity |

Maximalist version: codegen for instantiate + Incremental for updates.
Both layers stay fully compatible with the sdom model.

## Recommendation

If the goal is benchmark numbers, do template codegen first and skip the
graph rewrite. Highest ROI path.

If the goal is the right architecture for an optics-first sdom library,
the Incremental approach is the principled answer and worth doing for
that reason alone. It happens to also let us delete some code. It will
not move benchmarks much without codegen on top.

## What we explicitly will not do

- **Solid-style signals as the primary update model.** Breaks the
  "render is a pure function of model" property central to sdom.
  Incremental gives the same efficiency win while preserving the
  semantics.
- **Walker specialization (n=1, 2, 3 short-path inlining).** Tested in
  this session. Hand-specialized walkers regressed `07_create10k` from
  57.5 ms to 63.6 ms median because more distinct `Function` objects at
  the `binding.walk(clone)` call site overflowed V8's inline cache.
  Reverted. The right fix is to eliminate the dispatch entirely via
  codegen, not to specialize the dispatched functions.
