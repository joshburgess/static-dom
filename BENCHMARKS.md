# SDOM Benchmarks

All results collected on Chromium via Playwright, using Vitest's bench runner (Tinybench).

**Environment:** macOS Darwin 24.4.0, Playwright 1.59.1, Vitest 3.2.4

**Framework versions:** React 19.2.5, Preact 10.29.1, Solid 1.9.12, Inferno 9.1.0

**Date:** 2026-04-10

---

## Running Benchmarks

```bash
# All benchmarks in Chromium (recommended — real DOM cost)
npx vitest bench --config vitest.browser.config.ts

# Single benchmark file
npx vitest bench bench/initial-render.bench.ts --config vitest.browser.config.ts

# All benchmarks in happy-dom (faster, isolates JS overhead)
npx vitest bench
```

---

## Comparative Benchmarks

### Initial Render — 10k rows

Mount 10k table rows from scratch into an empty container. Measures createElement,
attribute setting, text content, and DOM tree assembly throughput.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM | 103 | 1.00x | Theoretical ceiling — direct createElement loop |
| solid | 99 | 1.04x | Per-row createEffect + signals |
| preact | 48 | 2.14x | |
| react | 46 | 2.26x | |
| sdom (production) | 37 | 2.78x | element()/text() constructors, guards off |
| sdom (dev) | 37 | 2.78x | Guards + dev mode on |
| **sdom (jsx + cloning)** | **31** | **3.28x** | Template cloning — innerHTML + static attr baking (default) |
| sdom (jsx createElement) | 28 | 3.70x | Legacy direct createElement path |

**Takeaway:** Template cloning (now the default for JSX/h/html/htm) is 12.5% faster
than the legacy createElement path for initial render with simple row templates. The
standard element()/text() path is faster than both because it avoids spec classification
overhead. For static-heavy templates (15+ elements, few dynamic bindings), template
cloning's advantage grows to ~38%.

---

### Single Row Update — 1k rows

Update one row's label in a 1k-row table. Tests the cost of detecting and applying a
single change. This is SDOM's strongest scenario — keyed array reconciliation fans out
updates per-item, so only the changed row's observers fire.

**SDOM variant guide:**

| Variant | Technique |
|---|---|
| sdom | Standard `array()` with same-structure fast path |
| sdom (incremental) | `incrementalArray` with keyed deltas — O(1) per patch, no reconciliation |
| sdom (compiled) | `programWithDelta` fast-path + element row template |
| sdom (indexed) | `indexedArray` — non-keyed positional patching, no Map overhead |
| sdom (direct-patch) | `patchItem()` API — bypasses dispatch, update, and subscription chain |
| sdom (zero-copy) | `extractDelta` + `compiled()` fused row + pooledKeyedPatch + guards off |

| Variant | ops/sec | vs solid | Notes |
|---|---:|---:|---|
| solid | 201,158 | 1.00x | Signal setter -> createEffect -> DOM write. O(1). |
| **sdom (direct-patch)** | **176,592** | **1.14x** | Bypasses dispatch chain |
| **sdom (zero-copy)** | **168,832** | **1.19x** | Full optimization stack |
| **sdom (compiled)** | **49,874** | **4.03x** | programWithDelta fast-path |
| **sdom (incremental)** | **49,710** | **4.05x** | Skips reconciliation via delta |
| **sdom (indexed)** | **43,420** | **4.63x** | Positional patching |
| **sdom** | **27,122** | **7.42x** | Same-structure fast path (key comparison only) |
| inferno | 4,005 | 50.2x | createElement-based keyed diff |
| inferno (optimized) | 2,202 | 91.4x | Pre-classified VNodes with flags |
| preact | 1,215 | 165.6x | |
| react | 448 | 449.2x | |

**Takeaway:** SDOM's direct-patch path reaches within 14% of Solid's speed (~177k vs
201k ops/sec). The basic `sdom` variant with same-structure fast path is 27k ops/sec —
60x faster than React, 22x faster than Preact, and 6.8x faster than Inferno. The
incremental/compiled paths skip reconciliation entirely at ~50k ops/sec.

---

### Partial Update — 1 of 10k rows

Same as single row update but at 10x scale (10k rows). Tests the cost of O(n) key
comparison in the same-structure fast path.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM | 730,942 | 1.00x | Direct textContent mutation |
| solid | 369,958 | 1.98x | O(1) signal update |
| **sdom** | **1,858** | **393x** | Same-structure fast path — key comparison + ref check |
| preact | 96 | 7,628x | Full vdom diff |
| react | 45 | 16,154x | Full vdom diff |

**Takeaway:** The same-structure fast path reduced SDOM's overhead from 2,507x to 393x
vs raw DOM (6.4x improvement). SDOM is now 41x faster than React and 19x faster than
Preact at this scale. The remaining cost is the O(10k) key comparison loop + ref check
loop + getItems() allocation (10k `{ key, model }` objects).

The gap to Solid (393x vs 2x) reflects an architectural difference: Solid's per-signal
updates are O(1), while SDOM's same-structure fast path is O(n) — it must verify all
10k keys match before dispatching the one update.

---

### Attribute-Only Update — 1k items

Toggle `class` and update `data-count` on all 1k items. Tests bulk attribute patching
when the DOM structure doesn't change.

| Variant | ops/sec | vs solid | Notes |
|---|---:|---:|---|
| **sdom** | **2,976** | **0.85x (17% faster)** | Same-structure fast path — skips reconciliation overhead |
| sdom (incremental) | 2,574 | 1.01x | keyedOps with per-item patches |
| solid | 2,539 | 1.00x | Per-item signal + createEffect, batched |
| preact | 1,674 | 1.52x | |
| react | 969 | 2.62x | |

**Takeaway:** SDOM's same-structure fast path makes the basic `array()` path **17%
faster than Solid** for bulk attribute updates. When all items change, the fast path
skips Map building, LIS computation, and removal checks — it just iterates items and
dispatches updates. SDOM beats React by 3.1x and Preact by 1.8x.

---

### Array Reorder — 1k items

Tests SDOM's LIS-based keyed reconciliation under various mutation patterns. The
reconciler uses a Longest Increasing Subsequence algorithm (ported from Inferno) to
minimize DOM `insertBefore` calls — only items NOT in the LIS require moves.

| Operation | ops/sec | Notes |
|---|---:|---|
| sdom — append 100 | 2,676 | Best case: no moves, just mount new items |
| sdom — reverse 1k | 2,023 | Pathological: LIS length 1, almost all items move |
| sdom — shuffle 1k | 846 | Worst case: random permutation |
| sdom — remove 100 | 440 | Remove from middle + teardown |
| react — shuffle 1k | 443 | React's keyed diff for comparison |

**Takeaway:** SDOM's shuffle is 1.9x faster than React's keyed diff. Reverse
(pathological case where almost every element moves) is surprisingly fast because the
DOM moves are sequential `insertBefore` calls with predictable access patterns.

---

### Replace All — 10k rows

Swap all 10k rows with a fresh 10k (all new keys). Tests combined teardown + mount cost.
Uses bulk replacement fast path: detects zero key overlap, bulk-clears DOM, and mounts
fresh items without markers.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM | 105 | 1.00x | innerHTML = "" + build new tbody |
| react | 46 | 2.31x | |
| **sdom** | **29** | **3.65x** | Bulk replace: teardown all + textContent clear + fast mount |
| preact | 1.6 | 65x | |

**Takeaway:** The bulk replacement fast path improved SDOM from 4.3x to 3.65x vs raw
DOM. SDOM detects that no old keys survive, skips marker insertion entirely, and uses
the fast initial mount path (no markers, no fragments). React's 2.31x reflects its
efficient vdom batch processing.

---

### Append 1k Rows to 10k

Add 1k new rows to an existing 10k-row table. Uses the append-only fast path: detects
that existing keys form a prefix of the new list, skips full reconciliation.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM | 1,183 | 1.00x | Direct appendChild loop |
| **sdom** | **196** | **6.05x** | Append fast path — prefix key check + mount new only |
| preact | 39 | 30.5x | |
| react | 26 | 46.3x | |

**Takeaway:** The append-only fast path reduced SDOM's overhead from 19.9x to 6.05x vs
raw DOM (3.3x improvement). SDOM is 5x faster than Preact and 7.6x faster than React.
The remaining cost is the O(10k) prefix key comparison to verify existing items haven't
changed.

**Caveat:** State grows across iterations (10k -> 11k -> 12k -> ...), so later iterations
are more expensive. The reported ops/sec is the average across all iterations.

---

### Clear Rows — 10k to 0

Teardown all 10k rows to empty. Uses the clear-all fast path: skips marker insertion,
bulk-clears the container.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM | 6,635,586 | 1.00x | innerHTML = "" |
| **sdom** | **4,853,678** | **1.37x** | |
| preact | 3,385,799 | 1.96x | |
| react | 973,555 | 6.82x | |

**Caveat:** This benchmark has a known setup/iteration issue. The `setup()` function
runs once per benchmark task, not per iteration. After the first iteration clears all
rows, subsequent iterations are no-op reconciliations (setting rows to `[]` when already
empty). The absolute ops/sec numbers are inflated. **Relative rankings are valid** since
all frameworks have the same issue.

---

### Static-Heavy Template — 1k cards (15 elements, 3 dynamic bindings)

Mount 1k cards where each card has 15 static DOM elements (divs, spans, headings,
paragraphs, buttons) and only 3 dynamic bindings (title, subtitle, badge). Tests
template cloning (innerHTML + static attribute baking + firstChild/nextSibling walkers)
vs direct createElement chains.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM (cloneNode + tree walk) | 192 | 1.00x | innerHTML template + firstChild/nextSibling |
| raw DOM (createElement) | 167 | 1.15x | Direct createElement for all 15 elements |
| **sdom (template cloning)** | **142** | **1.35x** | innerHTML + static attrs baked + walker bindings |
| sdom (jsx compiled) | 103 | 1.87x | Direct createElement, single fused observer |

**Takeaway:** Template cloning (the rewritten engine) is **37.7% faster** than the
createElement path for static-heavy templates. The key insight: static attributes
(`class`, `data-*`, etc.) are baked into the HTML string and come free on every
`cloneNode`. The firstChild/nextSibling walker pattern (borrowed from Solid.js) resolves
bindings efficiently.

Raw DOM template cloning with tree walking is 15% faster than raw DOM createElement at
this template size. The crossover point is between 15-50 elements.

### Micro: Clone vs createElement (raw DOM, no framework overhead)

Isolates the raw `cloneNode(true)` cost vs `createElement` chains with no SDOM overhead.

| Template size | createElement | cloneNode | Winner |
|---|---:|---:|---|
| 15 elements, 3 dynamic | 2,825 ops/sec | 2,134 ops/sec | createElement (1.32x) |
| 50 elements, 3 dynamic | 518 ops/sec | 594 ops/sec | **cloneNode (1.15x)** |

At 15 elements, raw `cloneNode` is still slower — but SDOM's template cloning wins
because static attributes are baked into the HTML (no post-clone setAttribute calls).
At 50 elements, `cloneNode` wins even in isolation.

---

## Internal Benchmarks (SDOM-only)

### Compiled Templates — 5-level tree, 10 dynamic attrs

Compares the three SDOM compilation strategies for an update tick.

| Approach | ops/sec | vs element() |
|---|---:|---:|
| compiled() | 230,720 | 1.16x |
| jsx() auto-compiled | 214,586 | 1.08x |
| element() chain | 199,616 | 1.00x |

**Takeaway:** `compiled()` is 16% faster than `element()` chains due to a single fused
observer vs per-element observers. The JSX auto-compiled path adds ~7% overhead from
spec classification.

---

### Focus Chain Depth — 100 leaves

Measures the cost of nested `focus()` calls. Each level adds a lens + update propagation
layer.

| Depth | ops/sec | vs 1-level |
|---|---:|---:|
| 1-level | 64,965 | 1.00x |
| 5-level | 29,384 | 2.21x |
| 10-level | 19,056 | 3.41x |
| 20-level | 11,818 | 5.50x |

**Takeaway:** Update cost scales roughly O(depth). At 20 levels deep, throughput is
still 11.8k ops/sec (~85us per update), acceptable for typical UI nesting depths (3-5
levels).

---

### Optics

Microbenchmarks for the optics subsystem (lenses, prisms, traversals).

#### Lens get/set (single prop)

| Operation | ops/sec | vs baseline |
|---|---:|---:|
| raw get | 8,633,657 | 1.00x |
| lens.get | 8,539,042 | 1.01x |
| raw set | 8,471,266 | 1.00x |
| lens.set | 7,766,468 | 1.09x |

Near-zero overhead for single-prop lenses.

#### Lens get/set (3-deep composed via `at`)

| Operation | ops/sec | vs baseline |
|---|---:|---:|
| raw get | 8,655,683 | 1.00x |
| composed.get | 6,925,504 | 1.25x |
| raw set | 7,458,510 | 1.00x |
| composed.set | 4,752,520 | 1.57x |

Composed lenses add ~25% overhead for get and ~57% for set (immutable copy at each level).

#### Prism preview

| Operation | ops/sec |
|---|---:|
| prism.preview (match) | 8,626,196 |
| prism.preview (miss) | 8,665,968 |
| raw check | 8,599,674 |

Zero overhead — prism preview is just a function call.

#### Modify (single element)

| Operation | ops/sec | vs baseline |
|---|---:|---:|
| raw modify | 8,460,348 | 1.00x |
| lens.modify | 7,237,764 | 1.17x |
| prism.modify (match) | 6,877,113 | 1.23x |
| prism.modify (miss) | 7,668,660 | 1.10x |
| affine.modify (present) | 6,836,133 | 1.24x |
| affine.modify (absent) | 7,717,191 | 1.10x |

Single-element modify is within 1.24x of baseline across all optic types.

#### Traversal getAll (1k elements)

| Operation | ops/sec | vs raw map |
|---|---:|---:|
| each().getAll | 8,713,226 | — (returns ref) |
| raw map | 323,973 | 1.00x |
| raw filter | 303,484 | 1.07x |
| filtered().getAll | 155,963 | 2.08x |
| each().compose(prop).getAll | 67,100 | 4.83x |

Traversal composition adds significant overhead for bulk operations due to intermediate
array allocation at each composition level.

#### Traversal modifyAll (1k elements)

| Operation | ops/sec | vs baseline |
|---|---:|---:|
| raw map | 32,690 | 1.00x |
| each().compose(prop).modifyAll | 19,196 | 1.70x |

1.7x overhead for composed traversal modify.

#### Traversal fold (1k elements)

| Operation | ops/sec | vs baseline |
|---|---:|---:|
| raw reduce | 1,175,478 | 1.00x |
| traversal.fold | 68,646 | 17.12x |

Fold is 17x slower than raw reduce, dominated by the per-element callback + accumulator
pattern through the optic chain.

---

## Summary

### Strengths

1. **Single-item updates (1k rows):** Basic `array()` with fast path achieves 27k
   ops/sec — 60x faster than React, 22x faster than Preact. The zero-copy path reaches
   88% of Solid (~177k vs 201k ops/sec).

2. **Bulk attribute updates:** SDOM's basic path (2,976 ops/sec) is **17% faster than
   Solid**, 3.1x faster than React.

3. **Array reorder:** LIS-based reconciliation is 1.9x faster than React's keyed diff
   for random shuffles.

4. **Optics overhead:** Near-zero for single-prop lenses/prisms (~1.01-1.24x baseline).

5. **Append rows:** 6x vs raw DOM, 5x faster than Preact, 7.6x faster than React.

6. **Replace all:** 3.65x vs raw DOM with bulk replacement, beating Preact by 18x.

### Weaknesses

1. **O(n) key scan at scale:** Even with the same-structure fast path, `array()` must
   compare all 10k keys to verify structure hasn't changed. At 10k rows: 1,858 ops/sec
   vs Solid's 370k ops/sec. Solid's O(1) signals avoid this entirely.

2. **getItems() allocation:** `array()` requires `.map()` to create n `{ key, model }`
   wrapper objects per reconciliation. Use `arrayBy()` to avoid this — 19% faster at 10k.

3. **Traversal fold/getAll overhead:** 17x for fold, 5x for composed getAll.

### arrayBy() vs array() — Allocation Savings

`arrayBy()` avoids the `.map(r => ({ key, model }))` allocation and adds an
array-identity fast path (O(1) when the items array reference hasn't changed).

| Operation | `array()` | `arrayBy()` | Improvement |
|---|---:|---:|---|
| Single row update (1k) | 27,784 | 28,982 | 4% |
| Single row update (10k) | 1,509 | 1,801 | **19%** |
| Bulk update (1k, all change) | 4,800 | 5,405 | 13% |

### Reconciliation Fast Paths

The `arrayBy()` reconciler has five fast paths, tried in order:

```
0. Array identity: same reference → skip entirely, O(1)
1. Same-structure: keys match in order → update-only, O(n) key comparison
2. Append-only:    prefix keys match + new items at end → update + mount tail
3. Full replace:   zero key overlap → bulk clear + fresh mount (no markers)
4. Full reconcile: arbitrary changes → Map building + LIS-based DOM reorder
```

### Optimization Tiers

From simplest API to fastest throughput (single row update, 1k rows, Chromium):

```
Tier 0: arrayBy + element             ~29,000 ops/sec      (6.9x slower than Solid)
         Same-structure fast path. Zero wrapper allocation.

Tier 1: incrementalArray + element    ~50,000 ops/sec      (4.0x slower than Solid)
         Keyed deltas skip reconciliation. O(1) per patch.

Tier 2: programWithDelta fast-path    ~50,000 ops/sec      (4.0x slower than Solid)
         Single-patch deltas bypass subscription chain.

Tier 3: patchItem + compiled          ~177,000 ops/sec     (1.14x slower than Solid)
         Bypass dispatch/update/delta. Fused row template.
         Guards and dev mode disabled.

Tier 4: extractDelta + compiled       ~169,000 ops/sec     (1.19x slower than Solid)
         Zero-copy delta extraction. No array spread.
         Guards and dev mode disabled.

Ceiling: Solid (signal-per-leaf)      ~201,000 ops/sec     (1.00x)
```

### Completed Optimizations

1. **`arrayBy()` zero-allocation API** — avoids `.map()` wrapper objects,
   19% faster at 10k rows. Includes array-identity O(1) fast path.

2. **Array-identity fast path** — added to both `array()` and `arrayBy()`.
   When `getItems()` returns the same reference, reconciliation is skipped entirely.

3. **Template cloning default** — JSX/h/html/htm now use `compileSpecCloned`
   by default, giving 38% faster initial render for static-heavy templates.
   JSX-created array items automatically get single-observer compiled templates
   with shared template cache.
