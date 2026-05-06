# Performance Recommendations

Practical guidance for getting the best performance out of static-dom, based on
Chromium benchmarks against React, Preact, Solid, and Inferno. See
[BENCHMARKS.md](./BENCHMARKS.md) for full data.

---

## Authoring API

`jsx()`, `h()`, `html()`, and `htm()` all feed into the same `compileSpec()`
path. They produce identical runtime code. Pick whichever you prefer to write.

**Template cloning is now the default.** All `jsx()`, `h()`, `html()`, and
`htm()` calls automatically use `compileSpecCloned`, which builds a `<template>`
via `innerHTML` with static attributes baked in, then clones it per instance.
This is ~38% faster than `createElement` chains for static-heavy templates (15
elements, 3 dynamic) and ~12% faster for typical templates. Static attributes
(`class`, `data-*`, etc.) are free on every clone.

---

## Production Settings

Always disable guards and dev mode in production:

```typescript
import { setGuardEnabled, setDevMode } from "@static-dom/core"

setGuardEnabled(false)
setDevMode(false)
```

This removes try/catch wrappers, model shape validation, unique key checks,
and dev warnings. Measured impact: ~23% faster initial render, and the
`validateUniqueKeys` call no longer allocates an n-element array on every
reconciliation.

---

## List Constructors

This is where the biggest performance decisions are. Choose based on your
update pattern.

### `arrayBy()`: the best default

```typescript
import { arrayBy } from "@static-dom/core"

arrayBy("tbody",
  (m) => m.rows,
  (r) => r.id,
  rowView,
)
```

Zero-allocation keyed list: takes a key extractor function instead of
requiring `.map(r => ({ key, model }))`. Avoids n wrapper object allocations
per reconciliation. Also includes an array-identity fast path: when `getItems`
returns the same reference, reconciliation is skipped entirely (O(1)).

The reconciler has five fast paths:

| Fast path | When it fires | What it skips |
|---|---|---|
| Array identity | Same array reference | Everything (O(1)) |
| Same-structure | Keys match in order | Map building, LIS, removal checks, reorder |
| Append-only | Existing keys are a prefix | Full reconciliation, just mounts the tail |
| Full replacement | Zero key overlap | Marker insertion, bulk clears + fast mount |
| Clear-all | New list is empty | Marker insertion, bulk teardown |

Performance vs `array()` (Chromium):

| Operation | `array()` | `arrayBy()` | Improvement |
|---|---:|---:|---|
| Single row update (1k) | 27,784 | 28,982 | 4% faster |
| Single row update (10k) | 1,509 | 1,801 | **19% faster** |
| Bulk update (1k) | 4,800 | 5,405 | 13% faster |

The savings scale with list size. At 10k rows, avoiding 10k wrapper object
allocations + GC pressure gives a 19% improvement.

**Use for:** Most lists. Prefer over `array()` for new code.

### `array()`: legacy keyed list

```typescript
import { array } from "@static-dom/core"

array("tbody",
  (m) => m.rows.map(r => ({ key: r.id, model: r })),
  rowView,
)
```

Same reconciliation engine as `arrayBy()` (including the array-identity fast
path) but requires `.map()` to create `{ key, model }` wrappers. Still good
performance: 60x faster than React, 22x faster than Preact on single-row
updates. Beats Solid by 17% on bulk attribute updates.

**Use for:** Existing code. For new code, prefer `arrayBy()`.

### `incrementalArray()`: for large, frequently-updated lists

```typescript
import { incrementalArray } from "@static-dom/core"
import { pooledKeyedPatch, keyedOps } from "@static-dom/core"

incrementalArray("tbody",
  (m) => m.rows.map(r => ({ key: r.id, model: r })),
  (m) => m._delta,
  rowView,
)
```

Skips reconciliation entirely via keyed deltas. **O(1) per single-item
update** regardless of list size: ~50,000 ops/sec.

The tradeoff: you must produce deltas yourself:

```typescript
// Single item update
signal.setValue({
  rows: newRows,
  _delta: pooledKeyedPatch(row.id, updatedRow),
})

// Multiple items
signal.setValue({
  rows: newRows,
  _delta: keyedOps(
    keyedPatch("row-1", updated1),
    keyedPatch("row-5", updated5),
  ),
})
```

**Use for:** Tables with 1k+ rows, real-time feeds, dashboards with frequent
targeted updates.

### `indexedArray()`: for append-only / positional lists

```typescript
import { indexedArray } from "@static-dom/core"

indexedArray("tbody",
  (m) => m.rows,
  rowView,
)
```

No keys, no Map, pure positional patching. ~44,000 ops/sec for single-item
updates. Items never reorder; additions and removals happen at the end only.

**Use for:** Logs, chat messages, append-only feeds, fixed grids.

---

## Row Templates

**JSX and `h()` already use template cloning by default.** Both go through
`compileSpecCloned`, which builds a `<template>` element once and clones it
via `cloneNode(true)` for each instance. This means JSX/`h()` rows already
get fast initial rendering, so you don't need to do anything special.

The only remaining advantage of hand-written `compiled()` is **hand-optimized
update logic**: direct field comparisons instead of generic updater closures.
This matters when you have thousands of rows being updated frequently and
want to squeeze out the last bit of per-update overhead.

```typescript
import { compiled } from "@static-dom/core"

const rowView = compiled<Row, never>((parent, model, _dispatch) => {
  const tr = document.createElement("tr")
  const td1 = document.createElement("td")
  const td2 = document.createElement("td")

  let lastCls = model.selected ? "selected" : ""
  td1.className = lastCls
  td1.textContent = model.id
  let lastLabel = model.label
  td2.textContent = lastLabel

  tr.appendChild(td1)
  tr.appendChild(td2)
  parent.appendChild(tr)

  return {
    update(_prev, next) {
      const cls = next.selected ? "selected" : ""
      if (cls !== lastCls) { lastCls = cls; td1.className = cls }
      if (next.label !== lastLabel) { lastLabel = next.label; td2.textContent = next.label }
    },
    teardown() { tr.remove() },
  }
})
```

Paired with `incrementalArray`, hand-written `compiled()` reaches 177k
ops/sec, within 14% of Solid.

**Use for:** Extreme cases like 10k+ row tables with frequent targeted updates
where you've profiled and the generic update path is the bottleneck.

**Don't bother for:** Most apps. JSX/`h()` with template cloning is already
fast and much more maintainable.

---

## Program Runners

| Runner | When to use |
|---|---|
| `program` | Simple apps, no side effects |
| `programWithEffects` | Apps with commands (HTTP, timers) |
| `programWithDelta` | Performance-critical apps with `incrementalArray` |
| `elmProgram` | Full Elm architecture (commands + subscriptions + ports) |

`programWithDelta` supports two performance features:

- **`extractDelta`**: Called before `update()`. If it returns a delta, the
  fast-path applies the delta directly, skipping `update()`, the subscription
  chain, and full reconciliation. This is the zero-copy path.

- **`patchItem`**: Direct item-level patching that bypasses the entire dispatch
  chain. The fastest possible update path in static-dom.

```typescript
programWithDelta<Model, Msg>({
  container,
  init: initialModel,
  extractDelta: (msg, model) => {
    if (msg.type === "updateRow") {
      const row = model.rows[msg.idx]!
      const updated = { ...row, label: msg.label }
      model.rows[msg.idx] = updated
      return pooledKeyedPatch(row.id, updated)
    }
    return null // fall through to update()
  },
  update: (msg, model) => { /* handle other messages */ },
  view,
})
```

---

## Recommended Configurations

### Typical app

```
jsx() or h()  +  array()  +  program()  +  guards off in prod
```

Good performance across the board with zero complexity overhead. Beats React
and Preact in every benchmark. Use this unless you have a specific bottleneck.

### Large list app (1k+ items, frequent targeted updates)

```
compiled() rows  +  incrementalArray()  +  programWithDelta  +  guards off
```

50k ops/sec for targeted updates. O(1) per patch regardless of list size.

### Maximum throughput

```
compiled() rows  +  incrementalArray()  +  extractDelta  +  pooledKeyedPatch  +  guards off
```

177k ops/sec, 88% of Solid's throughput. Use for real-time dashboards or
benchmarking.

---

## Conditional & Dynamic Structure

static-dom provides a spectrum of constructors for handling structural
variation, from fully static to fully dynamic. Choose the simplest one that
fits your use case.

### Decision tree

```
Is the structure fixed after mount?
 ├─ Yes → element(), text(), fragment()
 └─ No → Does it toggle between present/absent?
          ├─ Yes → optional(prism, view)
          └─ No → Is the set of variants known at compile time?
                   ├─ Yes → match(discriminant, branches)
                   └─ No → Is the structure changing every frame?
                            ├─ No → dynamic(key, factory)
                            └─ Yes → vdom(renderFn) or component(setup)
```

### Comparison

| Constructor | Structural change | Same-branch update cost | Switch cost | When to use |
|---|---|---|---|---|
| `optional` | Binary (present/absent) | O(leaf changes) | O(branch size) | Show/hide a single subtree |
| `match` | N-way (tagged variants) | O(leaf changes) | O(branch size) | Loading/error/loaded, routes, wizards |
| `dynamic` | Unbounded | O(leaf changes) | O(teardown + mount) | User-configured layouts, plugin systems |
| `dynamic` + cache | Unbounded | O(leaf changes) | O(detach + reinsert) | Tab panels, back-and-forth switching |
| `vdom` | Per-update | O(tree size) vdom diff | N/A (always diffs) | Drag-and-drop, WYSIWYG, animation |
| `component` | Imperative | Manual | Manual | Third-party integration (charts, maps) |

### Performance notes

**`match` vs React conditional rendering:**
Same-branch updates are ~2x faster than React (leaf-only patching vs full
tree diffing). Branch switches are ~2x slower (teardown + mount vs vdom
diff). Since same-branch updates are far more frequent than switches in
typical apps (e.g. updating data on the "loaded" page happens constantly,
switching to "error" happens rarely), `match` wins in aggregate.

**`dynamic` caching:**
Cached switches are ~3x faster than uncached (12.9K vs 4.3K ops/sec)
because they skip DOM creation entirely. Use `{ cache: true }` when users
flip back and forth between a small set of views (tabs, settings panels).
The trade-off is memory: cached branches keep their DOM alive in detached
state.

**`vdom` boundary:**
Everything inside the boundary pays O(tree size) per update: standard
vdom diffing cost. Keep the boundary small. If only part of your subtree
needs structural changes, wrap just that part in `vdom()` and keep the rest
as static-dom.

---

## What to Avoid

| Approach | Why |
|---|---|
| `element()` chains for hot-path list rows | 4-6x slower than `compiled()` due to per-element observers |
| Guards and dev mode in production | 23% overhead from try/catch + validation allocations |
| `array()` with 10k+ items and single-item updates | O(n) key scan; use `incrementalArray` instead |
