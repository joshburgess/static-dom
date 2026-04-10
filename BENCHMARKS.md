# SDOM Benchmarks

Benchmark results comparing SDOM against React, Preact, Inferno, and Solid.js
across three scenarios: single row update, bulk attribute updates, and initial
render.

All benchmarks use the same data shape (keyed rows with `id`, `label`,
`selected`) and equivalent DOM structure across frameworks.

## Environments

Results are collected in two environments to show how real DOM cost changes
the picture:

- **Happy-dom** — fast JS-only DOM mock. Measures pure JS overhead with
  near-zero DOM cost. Useful for isolating framework overhead.
- **Chromium** — real browser via Playwright. Measures end-to-end including
  layout, style recalc, and actual DOM mutations.

## Running

```bash
# Happy-dom (default)
npm run bench

# Real Chromium
npx vitest bench --config vitest.browser.config.ts
```

---

## Single row update (1,000 rows)

One row's label changes per iteration. This is SDOM's sweet spot: SDOM patches
one text node directly, while vdom libraries must diff the entire tree (or at
least the row list) to find the one changed row.

### SDOM variants explained

| Variant | What it does |
|---|---|
| `sdom` | Standard `array` — full keyed reconciliation on every update |
| `sdom (incremental)` | `incrementalArray` with keyed deltas — O(1) per patch, no reconciliation |
| `sdom (compiled)` | `programWithDelta` fast-path + element template |
| `sdom (direct-patch)` | `patchItem` API — bypasses dispatch, update, and subscription chain entirely |
| `sdom (zero-copy)` | `extractDelta` + `compiled` template + disabled guards/dev mode |
| `sdom (indexed)` | `indexedArray` — non-keyed positional patching, no Map overhead |

### Happy-dom results

| Framework | ops/s | vs Solid | vs React |
|---|---:|---:|---:|
| solid | 11,828,595 | 1.00x | 63,173x |
| sdom (incremental) | 241,116 | 0.02x | 1,288x |
| sdom (compiled) | 235,448 | 0.02x | 1,258x |
| sdom (direct-patch) | 198,614 | 0.02x | 1,061x |
| sdom (zero-copy) | 176,970 | 0.01x | 945x |
| sdom (indexed) | 95,404 | 0.008x | 510x |
| sdom | 2,655 | 0.0002x | 14x |
| inferno | 2,378 | 0.0002x | 13x |
| inferno (optimized) | 1,326 | 0.0001x | 7x |
| preact | 452 | — | 2.4x |
| react | 187 | — | 1.0x |

### Chromium results

| Framework | ops/s | vs Solid | vs React |
|---|---:|---:|---:|
| solid | 223,216 | 1.00x | 486x |
| sdom (zero-copy) | 179,136 | 0.80x | 390x |
| sdom (direct-patch) | 178,982 | 0.80x | 389x |
| sdom (compiled) | 51,516 | 0.23x | 112x |
| sdom (incremental) | 50,432 | 0.23x | 110x |
| sdom (indexed) | 45,184 | 0.20x | 98x |
| sdom | 4,425 | 0.02x | 9.6x |
| inferno | 4,049 | 0.02x | 8.8x |
| inferno (optimized) | 2,260 | 0.01x | 4.9x |
| preact | 1,224 | 0.005x | 2.7x |
| react | 460 | 0.002x | 1.0x |

### Key observations

**The Solid gap compresses dramatically in a real browser.** In happy-dom,
Solid is ~50x faster than SDOM's best. In Chromium, SDOM's `direct-patch`
and `zero-copy` variants are within **1.25x of Solid**. Both frameworks do
exactly one `textContent` write per update — in a real browser that DOM
mutation dominates everything else, erasing the JS overhead difference.

**SDOM's optimized variants flip order between environments.** In happy-dom,
`incremental` (241K) beats `direct-patch` (199K) because V8 optimizes the
element template's prototype-based updaters better than compiled closures. In
Chromium, `direct-patch` (179K) leads because skipping the subscription chain
matters when DOM writes are expensive enough to create a measurable baseline.

**Inferno lands next to SDOM's full-reconciliation path.** Both `sdom` (4,425)
and `inferno` (4,049) do O(n) keyed diffing. SDOM's incremental layer is what
creates the 10-40x separation — not structural tricks, but skipping the diff
entirely by consuming structured deltas.

**Inferno's "optimized" `createVNode` with flags is slower than `createElement`.**
Inferno's keyed diffing path (`HasKeyedChildren`) has more bookkeeping than its
unkeyed path. In happy-dom where DOM ops are cheap, the bookkeeping dominates.

---

## Attribute-only update (1,000 items)

Every item's `class` and `data-count` attributes change on each tick. Tests
bulk update throughput — the kind of update that happens during animations,
filtering, or selection state changes.

### Happy-dom results

| Framework | ops/s | vs Solid |
|---|---:|---:|
| solid | 138,824 | 1.00x |
| react | 319 | 0.002x |
| sdom (incremental) | 120 | 0.0009x |
| preact | 115 | 0.0008x |
| sdom | 115 | 0.0008x |

### Chromium results

| Framework | ops/s | vs Solid |
|---|---:|---:|
| solid | 2,546 | 1.00x |
| sdom (incremental) | 2,535 | **1.00x** |
| sdom | 1,920 | 0.75x |
| preact | 1,754 | 0.69x |
| react | 1,052 | 0.41x |

### Key observations

**SDOM ties Solid for bulk attribute updates in Chromium.** Both produce the
same 2,000 DOM mutations (1,000 className + 1,000 setAttribute). When all
items change, there's no diff to skip — performance is purely DOM throughput.
SDOM incremental (2,535) and Solid (2,546) are statistically identical.

**Happy-dom exaggerates Solid's advantage.** Solid's batched signal updates
avoid intermediate DOM flushes, which matters less when DOM writes are free
(happy-dom) but is neutral when all frameworks produce the same final DOM
mutations (real browser).

---

## Initial render (10,000 rows)

Time from empty container to all rows in the DOM. SDOM's advantage here is
modest since all frameworks must create the full DOM tree.

### Happy-dom results

| Framework | ops/s | vs fastest |
|---|---:|---:|
| react | 17.8 | 1.00x |
| solid | 3.7 | 0.21x |
| preact | 2.8 | 0.16x |
| sdom | 1.9 | 0.11x |

### Chromium results

| Framework | ops/s | vs fastest |
|---|---:|---:|
| solid | 100.1 | 1.00x |
| preact | 52.0 | 0.52x |
| react | 48.1 | 0.48x |
| sdom | 24.7 | 0.25x |

### Key observations

**SDOM is slowest at initial render.** This is expected — SDOM's per-element
bookkeeping (creating subscriptions, updater instances, signal wiring) is more
work than a vdom library creating plain objects. The tradeoff pays off on every
subsequent update, where SDOM avoids the diff entirely.

**React's happy-dom dominance is artificial.** React at 17.8 ops/s in happy-dom
vs 48.1 in Chromium means happy-dom's `createElement` is actually slower than
the real browser's. This is a happy-dom artifact, not a React advantage.

---

## Interpreting the results

### Why two environments matter

Happy-dom and Chromium measure fundamentally different things:

- **Happy-dom** measures **framework JS overhead** — the cost of diffing,
  subscription dispatch, delta extraction, and object creation. DOM writes are
  essentially free (~20ns).
- **Chromium** measures **end-to-end cost** — JS overhead + real DOM mutations
  (~1-5us per property write), layout, and style recalculation.

When a benchmark updates a single DOM property, the Chromium cost is dominated
by that one DOM write. Framework overhead becomes noise. This is why the 50x
happy-dom gap between SDOM and Solid compresses to 1.25x in Chromium — both
do exactly one `textContent` write.

When a benchmark updates 1,000 properties, DOM cost dominates in both
environments, and all frameworks that produce the same mutations converge.

### What this means for real applications

- **For targeted updates** (single item change, toggle, input): SDOM's
  incremental variants are competitive with Solid in real browsers. The
  optimization layers (`compiled`, `direct-patch`, `zero-copy`) provide
  measurable gains.

- **For bulk updates** (filtering, sorting, select-all): Performance is
  dominated by DOM mutation count. SDOM and Solid produce identical DOM
  operations and perform identically.

- **For initial render**: SDOM pays a setup cost for its subscription
  infrastructure. Consider lazy rendering or virtualization for very large
  initial renders.

### SDOM optimization tiers

From simplest to fastest, the optimization layers stack:

```
Tier 0: array + element               ~2,500 ops/s (happy-dom)    ~4,400 ops/s (Chromium)
         Full keyed reconciliation on every update.

Tier 1: incrementalArray + element    ~241,000 ops/s (happy-dom)  ~50,000 ops/s (Chromium)
         Keyed deltas skip reconciliation. O(1) per patch.

Tier 2: programWithDelta fast-path    ~235,000 ops/s (happy-dom)  ~52,000 ops/s (Chromium)
         Single-patch deltas bypass subscription chain via _tryFastPatch.

Tier 3: patchItem + compiled          ~199,000 ops/s (happy-dom) ~179,000 ops/s (Chromium)
         Bypass dispatch/update/delta entirely. Fused row template.
         Disabled guards and dev mode.

Ceiling: Solid.js (signal-per-leaf) ~11,800,000 ops/s (happy-dom) ~223,000 ops/s (Chromium)
```

Tier 3 reaches **80% of Solid's Chromium throughput** without adopting
signal-per-leaf reactivity. The remaining gap is SDOM's Map lookup, model
object creation, and multi-field comparison overhead — inherent to the
whole-model-pass-through architecture.
