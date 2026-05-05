# Future directions

Captured ideas for performance and architecture work that are out of scope
right now, but worth keeping on the record so we don't lose the reasoning.

## Context

Measured against the officially-tracked VDOM peers (script-time medians
from the `webdriver-ts` headless harness on this machine, in ms):

```
bench           static-dom   solid   inferno
01_run1k             6.0       3.7      4.5
03_update            2.2       1.8      1.9
07_create10k        65.9      44.5     51.4
```

The relevant gap is roughly **1.3x to 1.6x slower than Solid / Inferno on
creates**, not the "2-4x off" framing earlier drafts of this document used,
and not "match vanilla" (vanilla is the floor, not the bar). Per-row delta
vs Solid on `07_create10k` is about 2.3 us / row. That number is the budget
remaining for the per-row mount path: it has to absorb the binding switch,
the walker call, and the per-row update closure that the framework peers
in this tier have already inlined or eliminated via build-time codegen.

Two methodology notes that matter:

1. **Use script time, not wall-clock.** Wall-clock measurements via
   Puppeteer that bundle paint cost compress this gap to under 5%, which
   is misleading. The official harness isolates script time via Chrome
   trace events, and that is the metric the public ranking uses.
2. **Compare to VDOM peers, not to vanilla.** Vanilla is a useful floor
   for "is the gap shrinking" but the goal is to land in the same tier
   as Solid, Inferno, Svelte, blockdom, alien-signals.

## Why we are slow (root cause)

Per-row instantiation cost on `07_create10k` is ~6.6 us / row vs Solid's
~4.5 us / row. The 2.3 us delta lives in three places, each hot per row:

1. **Megamorphic walker dispatch.** Every template compiles its own
   `NodeWalker` function. The call site `binding.walk(clone)` sees many
   distinct function objects across templates and goes megamorphic in
   V8's inline cache. Each call costs roughly 500 ns to 1 us that an
   inlined property access would not.
2. **Generic binding loop.** `instantiateTemplate` iterates an array of
   binding records, switches on `kind`, and calls a closure for each.
   None of this can be inlined because the binding shapes vary across
   templates compiled into the same call site.
3. **Per-row update closure.** Every row allocates a fresh `update`
   function whose environment captures the row's bindings, nodes, lasts,
   and dispatch reference. 10000 such allocations on `07_create10k`
   account for the bulk of the create-path GC pressure.

Items 1 and 2 are the main create-path cost. Item 3 contributes
allocation pressure on creates and indirect overhead on updates.

Solid does not pay any of these costs because its compiler emits
per-template code with the binding switch and walker chain already
inlined. There is no binding array, no walker, no per-row update
closure. Just literal JS that clones, points at the right slots, and
writes them. The 2.3 us / row gap is exactly the cost of being
interpreted vs compiled at the per-template boundary.

## Direction 1: build-time codegen via Vite plugin

This is the recommended primary path. It mirrors what Solid does, is
CSP-clean (no `eval` / `new Function`), tree-shakable, and is the only
structural change with a real chance of closing the 1.3-1.6x gap end
to end. An earlier runtime-codegen prototype failed for reasons that
do not apply at build time (see "Lessons" below).

### Output shape, per-template

For each unique JSX template the compiler emits a module-scope record
with a static `<template>` and two module-scope functions: a `mount`
and an `update`. Sketch for a row template with three dynamic holes
and one click handler:

```ts
// codegen output for the krausest row template:
const TPL_3 = (() => {
  const t = document.createElement('template')
  t.innerHTML =
    '<tr><td class="col-md-1"></td>' +
    '<td class="col-md-4"><a></a></td>' +
    '<td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>' +
    '<td class="col-md-6"></td></tr>'
  return t.content.firstChild
})()

function mount_3(model, dispatch) {
  const root = TPL_3.cloneNode(true)
  // walker chain unrolled into literal firstChild / nextSibling reads:
  const td0    = root.firstChild
  const idText = td0.appendChild(document.createTextNode(''))
  const td1    = td0.nextSibling
  const a      = td1.firstChild
  const label  = a.appendChild(document.createTextNode(''))

  // initial paint, inlined from the binding records:
  root.className = optic_selectedClass(model)
  idText.nodeValue = optic_id(model)
  label.nodeValue = optic_label(model)

  // event delegation registers via the existing delegator (unchanged):
  registerEvent(currentDelegator, td1.nextSibling.firstChild, 'click', dispatch_remove)

  const lasts = [root.className, idText.nodeValue, label.nodeValue]
  return { root, idText, label, lasts }
}

function update_3(inst, next) {
  const v0 = optic_selectedClass(next)
  if (v0 !== inst.lasts[0]) { inst.root.className = v0; inst.lasts[0] = v0 }
  const v1 = optic_id(next)
  if (v1 !== inst.lasts[1]) { inst.idText.nodeValue = v1; inst.lasts[1] = v1 }
  const v2 = optic_label(next)
  if (v2 !== inst.lasts[2]) { inst.label.nodeValue = v2; inst.lasts[2] = v2 }
}
```

Key properties of this shape:

- No binding array, no `for ... switch` dispatch, no walker function,
  and no per-row update closure. `update_3` is one module-level
  function shared across every row of template 3.
- The walker chain is unrolled into literal `firstChild` /
  `nextSibling` reads. V8 inlines these against the cloned
  `<template>`'s known hidden class.
- `lasts` only allocates slots for genuinely dynamic bindings.
  Constant attributes are baked into `innerHTML`.
- Event delegation registers exactly as today via `registerEvent` /
  `withDelegator`. The plugin emits the same call inline that the
  runtime path emits dynamically.

### Vite plugin architecture

The plugin is a Vite source transformer that runs after the standard
JSX transform but before bundling. Conceptually:

```
input file (.tsx)
  -> standard JSX transform
        emits @static-dom/core/jsx-runtime calls (already what we
        have today)
  -> @static-dom/vite-plugin
        for each top-level JsxSpec literal it can statically resolve:
          - hoist its static DOM shape to a module-scope `const TPL_N`
          - emit module-scope `mount_N` and `update_N`
          - replace the original construction site with a thin
            descriptor: { kind: 'compiled', mount: mount_N,
                          update: update_N, teardown?: ... }
        for any JsxSpec it cannot resolve (built dynamically in
        user code), leave it as-is for the runtime path to handle
  -> bundler emits final JS
```

Plugin entry point:

```ts
// packages/vite-plugin/src/index.ts
import type { Plugin } from 'vite'
import { compileFile } from './compiler'

export function staticDomCodegen(): Plugin {
  return {
    name: 'static-dom-codegen',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.tsx') && !id.endsWith('.jsx')) return null
      return compileFile(code, id) // returns { code, map } or null
    },
  }
}
```

The compiler is a small AST pass (Babel parser + traverser, the same
plumbing the standard JSX transform already uses):

1. Find every `JsxSpec` construction site. After the standard JSX
   transform these are recognizable as factory calls from
   `@static-dom/core/jsx-runtime`.
2. Walk the spec tree statically. For each subtree whose shape is
   determinable at build time (every element, attribute, and child
   resolves to a literal or to one of the existing `JsxBinding`
   shapes: text hole, attr hole, key, ref, dynamic, match, vdom),
   record the shape.
3. Emit a `<template>` source for the static shape. Emit `mount_N`
   and `update_N` whose bodies inline the firstChild / nextSibling
   walks and the per-binding handling.
4. Bindings that are projections (today the `JsxBinding` records)
   become inline reads of the corresponding optic / function. Their
   call sites land directly inside `mount_N` / `update_N`.
5. Non-resolvable subtrees (a `JsxSpec` held in a variable, a
   fragment built up imperatively) fall through to the runtime
   `compileSpecCloned` path. Build-time and runtime paths coexist
   in the same bundle.

### Integration with the existing runtime

The plugin produces `CompiledSpec` records, a new variant alongside
the existing `JsxSpec`. The runtime adds one branch in `instantiate`:

```ts
if (spec.kind === 'compiled') {
  const inst = spec.mount(model, dispatch)
  return makeSDOM({
    nodes: () => [inst.root],
    update: next => spec.update(inst, next),
    teardown: () => spec.teardown?.(inst),
  })
}
// existing JsxSpec path unchanged
```

That is the only runtime change. `compiled()`, `instantiateTemplate`,
`reconcile.ts`, `dynamic` / `match` / `vdom` constructors, and the
optics module are all untouched. The plugin is purely additive: code
with the plugin enabled gets the codegen path; code without it gets
today's runtime path. That property matters for adoption.

### Code-size budget

Per-template inlining produces N copies of "read optic, compare to
last, write node" per binding. For typical templates (a handful of
holes) this is roughly a wash with today's interpreted dispatch. For
wide templates (say >20 bindings) it inflates code size. Two
mitigations, both deferred until we measure real templates:

- **Hybrid threshold.** The plugin can fall back to a small loop
  form for templates above a binding-count threshold. Same shape of
  mount fn, just emits a `for` over a per-template static descriptor
  array instead of unrolled reads.
- **Shared subroutines.** Identical binding patterns across templates
  can share helpers emitted once at module scope. Probably
  overengineering; defer.

Expected bundle-size delta for the krausest row template (~3 holes,
1 attribute hole, 1 click handler): roughly +500 bytes per
template, partially recovered by deleting the JsxSpec literal it
replaces.

### Expected impact

- `07_create10k`: 65.9 ms -> 40-45 ms (matches Inferno, approaches
  Solid).
- `01_run1k`, `02_replace1k`, `08_create1k-after1k_x2`: similar
  proportional win on the same per-row cost.
- `03_update`: minor improvement. The update-path bottleneck is the
  diff-on-re-eval model, not dispatch. Direction 2 addresses that.
- Bundle size: small per-template overhead, bounded by the hybrid
  threshold above.

### Open questions

- **Where in the JSX pipeline to hook.** A Babel plugin route
  (intercept JSX before the standard transform) sees more shape per
  node but ties us to Babel. A Vite source transform route (after
  the JSX transform) is simpler and works against any JSX runtime.
  Default to the Vite route; revisit if we hit cases the
  Vite-level pass cannot resolve.
- **Dev-mode UX.** Plugin output is generated code; debugging it
  inside user files is hostile. Source maps are required. Likely
  also a dev-mode flag that disables codegen entirely so users
  can debug against the runtime path.
- **TypeScript story.** The `CompiledSpec` type wants to live in
  `@static-dom/core`; the plugin imports it. Whether the plugin
  ships in core or in a sibling `@static-dom/vite-plugin` package
  is a packaging call, not a technical one.

### Why this works where the runtime-codegen prototype didn't

The runtime prototype failed for two reasons (see "Lessons" below):

1. **Per-row closure environment was huge** (one closure per row,
   capturing 14+ vars). Build-time codegen emits **module-scope**
   functions: zero closure environments at the per-row level.
   `update_N` is one shared optimized body.
2. **`new Function` source-string compilation cost.** Build-time
   codegen has zero parse cost at runtime. The functions are
   static module code, optimized by V8 the same way any other
   module code is, and CSP-clean.

Neither failure mode applies at build time.

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
  problem, addressed by Direction 1.
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

### Implementation status

Direction 2 has landed. The branch carries:

1. **Graph primitives.** `Cell`, `Var`, `mapCell` / `mapCell2` /
   `mapCell3`, `bindCell`, `bindPrism`, `batch`, `stabilize`, with
   topo-height scheduling, per-cell cutoff, and observer-driven GC.
   Public surface is `Cell` / `Var` / `mapCell` (see the README
   reactive-primitives section).
2. **Optic lifting.** Lenses, getters, prisms, and affine traversals
   lift over `Cell<S>` to `Cell<A>` (or `Cell<A | null>` for prisms /
   affines via `preview`). The optics module proper is untouched; the
   lifting layer sits next to it.
3. **Program runners regrounded on the graph.** `program`,
   `programWithEffects`, `programWithSubscriptions`,
   `programWithDelta`, and `elmProgram` all now drive their views off
   a `Var<Model>`. New `attachToCell` / `programFromVar` runners
   expose the graph entry point directly for code that already has a
   `Cell`.
4. **Native Cell consumption through every SDOM constructor.** Every
   `makeSDOM` call site in `packages/core/src/constructors.ts`
   provides an `attachCell` implementation: `text`, `staticText`,
   `element`, `array`, `arrayBy`, `indexedArray`, `match`, `dynamic`,
   `optional`, `fragment`, `component`, `compiled`, `compiledState`,
   and `wrapChannel`. None of these fall back to the
   `cellToUpdateStream` bridge anymore.
5. **Per-branch / per-row Var pattern.** Sub-trees that need to see
   only a focused slice of the model (a `match` branch, an `optional`
   sub-model, an `indexedArray` slot, an `array` row) get their own
   `Var`. The parent observer writes into that `Var`; the child's
   `attachCell` observes it. This preserves the filtering invariant
   the legacy UpdateStream path relied on without re-introducing a
   second bridge.

What is intentionally still UpdateStream-based:

- **`SDOMWithChannel.attach`.** The channel-flavored sibling of
  `SDOM.attach` used internally by the keyed array reconciler and
  by `wrapChannel`'s inner. It still consumes an `UpdateStream`
  because the merged-stream semantics it requires (outer model
  updates merged with locally-applied channel-event transforms)
  do not have a clean Cell-native counterpart yet. `wrapChannel`
  itself observes the outer cell directly; it just bridges to an
  internal `UpdateStream` to feed the inner.

What's deferred:

- **`SDOMWithChannel.attachCell`.** Adding a Cell-native variant to
  the channel-flavored interface would let `wrapChannel` and the
  array reconciler stop allocating the inner merged-stream observer
  set. Tractable but mechanically large; revisit if a profile points
  here.
- **Re-running krausest.** The per-row mount path is the same shape
  as before, so the create benchmarks should be unchanged. Point
  updates (`03_update`, `05_swap1k`) are the ones to re-measure
  once the dust settles.

## Layering

The two directions are orthogonal and can be done independently:

| Layer        | What it changes                | What it improves                                |
| ------------ | ------------------------------ | ----------------------------------------------- |
| Codegen      | instantiate / update path      | creates, replaces (`01`, `02`, `07`, `08`)      |
| Incremental  | update model                   | point updates (`03`, `04`, `05`), code clarity  |

Maximalist version: codegen for instantiate plus Incremental for
updates. Both layers stay fully compatible with the sdom model.

## Recommendation

Direction 2 has landed. The remaining ROI for benchmark numbers is
Direction 1: build-time codegen via the Vite plugin. It targets the
per-row template instantiation cost, which is the dominant remaining
gap to the VDOM peers on the create benchmarks and which the graph
rewrite, by design, does not move.

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

## Lessons from prior prototypes

### Runtime codegen via `new Function`

A runtime-codegen prototype was built and measured against the
interpreted path on `01_run1k` and `07_create10k`. Within the noise of
5-iteration runs the two paths were indistinguishable: codegen ran a
hair faster on `01_run1k` and a hair slower on `07_create10k`, with
medians within a few percent. No clear win.

Why the predicted gain did not materialize:

1. **Update-closure size dominates.** The codegen path emitted one
   `update` closure per row that captured every walker target
   (`_root`, `_w_*`), every last-value (`_l*`), every text-node ref
   (`_n*`), and every binding fn (`_fn*`): roughly 14 vars on the row
   template. The interpreted path's update closure captures 6 vars
   (`bindings`, `n`, `nodes`, `lasts`, `rowRef`, `dispatch`). For
   `07_create10k`, that is 10000 larger Contexts allocated up front.
   The allocation pressure cancelled the dispatch win.
2. **The dispatch cost was overestimated for this codebase.** Templates
   here are small (3-5 bindings on the row template). The `switch` in
   `instantiateTemplate` is well-predicted by V8 and `binding.walk`
   has a small enough callee set per call site that megamorphism is
   less punishing than the original analysis assumed.

Cost of the prototype as written: +140 LOC, +5 kB to the bench bundle
(+10%), +CSP fragility from `new Function`. Reverted because the
benchmark numbers did not justify the cost.

The lesson is not "codegen does not work." It is that runtime codegen
hits the wrong end of the tradeoff: it pays the per-row closure cost
to skip dispatch, and at this codebase's template sizes the trade is
flat. Build-time codegen (Direction 1) avoids both costs simultaneously
because it emits module-scope functions, not per-row closures.

### Template-v2 (shared update fn + per-row state object)

Implemented and measured in a follow-up session. The change replaced
the per-row `update` closure returned by `instantiateTemplate` with a
flat `TemplateInstance` state object and a module-level
`updateTemplate(inst, next)` function shared across every row of every
template. `compileSpecCloned` was rewritten to bypass the generic
`compiled()` wrapper and call `updateTemplate` directly, removing four
wrapper allocations per attach (the `compiled()` instance object,
subscribe callback, returned `{teardown}`, and inner teardown closure).

Hypothesis: smaller per-row closure environment plus V8 sharing one
optimized `updateTemplate` body across all instances would shave the
hot-path JS work on `01_run1k` and `07_create10k`.

Results from interleaved A/B with 6+ iters per run (4x CPU throttle,
headless Chrome):

|                | baseline   | template-v2          |
|----------------|------------|----------------------|
| `01_run1k`     | 168.3 ms   | 168.0 ms             |
| `07_create10k` | 1633.7 ms  | 1663.9 ms (+1.8%)    |

Perf-neutral on 1k, slight regression on 10k. The hypothesis did not
hold. Likely reasons:

1. **Closure-scope reads beat property reads in the hot loop.** The
   baseline `update` closure reads `bindings[i]`, `nodes[i]`,
   `lasts[i]` from closure scope (compiled to fast Context-slot
   accesses). Template-v2 reads them as `inst.bindings[i]`,
   `inst.nodes[i]`, `inst.lasts[i]`, each going through a hidden-class
   property lookup. With ~5 bindings per row times 10000 rows, this
   overhead added up.
2. **V8 was already sharing optimized code across closures of the same
   FunctionLiteral.** The "shared module-level fn" advantage was
   imaginary; V8 had already shared the optimized code body.
3. **Closure environment size was not the bottleneck.** The 5-capture
   closure (`bindings`, `nodes`, `lasts`, `n`, `ref`) and the
   1-capture closure (`inst`) had indistinguishable allocation cost
   in practice.

Combined lesson from both prototypes: micro-optimizing the JS shape of
the per-row mount within the runtime does not move the needle. The
remaining gap to VDOM peers lives inside the per-row binding-switch
plus walker-call dispatch, which an interpreter pays per row but a
build-time compiler emits away. The next worthwhile experiment is
Direction 1: emit the per-template code at build time, not at runtime.
