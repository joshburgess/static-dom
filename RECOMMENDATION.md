# Performance Recommendations

Practical guidance for getting the best performance out of SDOM, based on
Chromium benchmarks against React, Preact, Solid, and Inferno. See
[BENCHMARKS.md](./BENCHMARKS.md) for full data.

---

## Authoring API

`jsx()`, `h()`, `html()`, and `htm()` all feed into the same `compileSpec()`
path. They produce identical runtime code. Pick whichever you prefer to write.

**Skip template cloning** (`compileSpecCloned`). It is slower than direct
`createElement` in every scenario tested, including a static-heavy case with
15 elements and only 3 dynamic bindings. The path resolution overhead outweighs
the `cloneNode` savings.

---

## Production Settings

Always disable guards and dev mode in production:

```typescript
import { setGuardEnabled } from "@sdom/core/errors"
import { setDevMode } from "@sdom/core/dev"

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

### `array()` — the best default

```typescript
import { array } from "@sdom/core"

array("tbody",
  (m) => m.rows.map(r => ({ key: r.id, model: r })),
  rowView,
)
```

Good all-around performance with no extra complexity. The reconciler has four
fast paths that handle common operations without full reconciliation:

| Fast path | When it fires | What it skips |
|---|---|---|
| Same-structure | Keys match in order | Map building, LIS, removal checks, reorder |
| Append-only | Existing keys are a prefix | Full reconciliation — just mounts the tail |
| Full replacement | Zero key overlap | Marker insertion — bulk clears + fast mount |
| Clear-all | New list is empty | Marker insertion — bulk teardown |

Performance vs other frameworks (Chromium):

| Operation | sdom `array()` | React | Preact | Solid |
|---|---|---|---|---|
| Single row update (1k) | 27,122 ops/sec | 448 | 1,215 | 201,158 |
| Bulk attribute update (1k) | **2,976** | 969 | 1,674 | 2,539 |
| Append 1k to 10k | **196** | 26 | 39 | — |

SDOM's basic `array()` beats Solid by 17% on bulk attribute updates, and is
60x faster than React and 22x faster than Preact on single-row updates.

The weakness is **O(n) at large scale**: at 10k rows, updating 1 item costs
~0.5ms (1,858 ops/sec) because the key comparison loop must verify all 10k
keys. Solid's O(1) signals avoid this entirely.

**Use for:** Most lists. Good enough unless you have 1k+ items with frequent
single-item updates.

### `incrementalArray()` — for large, frequently-updated lists

```typescript
import { incrementalArray } from "@sdom/core"
import { pooledKeyedPatch, keyedOps } from "@sdom/core/patch"

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

### `indexedArray()` — for append-only / positional lists

```typescript
import { indexedArray } from "@sdom/core"

indexedArray("tbody",
  (m) => m.rows,
  rowView,
)
```

No keys, no Map, pure positional patching. ~44,000 ops/sec for single-item
updates. Items never reorder — additions and removals happen at the end only.

**Use for:** Logs, chat messages, append-only feeds, fixed grids.

---

## Row Templates

For most cases, `element()` chains or JSX are fine. For performance-critical
list rows, a hand-written `compiled()` template eliminates per-field observer
subscriptions:

```typescript
import { compiled } from "@sdom/core"

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

This is 4-6x faster than `element()` chains because it has a single observer
instead of one per leaf. Paired with `incrementalArray`, it reaches 177k
ops/sec — within 14% of Solid.

**Use for:** Hot-path list rows in large tables.

**Don't bother for:** Non-list components, infrequently-updated views, small
lists. The `element()`/JSX path is cleaner and the difference doesn't matter.

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
  fast-path applies the delta directly — skipping `update()`, the subscription
  chain, and full reconciliation. This is the zero-copy path.

- **`patchItem`**: Direct item-level patching that bypasses the entire dispatch
  chain. The fastest possible update path in SDOM.

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

177k ops/sec — 88% of Solid's throughput. Use for real-time dashboards or
benchmarking.

---

## What to Avoid

| Approach | Why |
|---|---|
| Template cloning (`compileSpecCloned`) | Slower than `createElement` in all tested scenarios |
| `element()` chains for hot-path list rows | 4-6x slower than `compiled()` due to per-element observers |
| Guards and dev mode in production | 23% overhead from try/catch + validation allocations |
| `array()` with 10k+ items and single-item updates | O(n) key scan; use `incrementalArray` instead |
