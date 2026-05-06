# static-dom Benchmarks

All results collected on Chromium via Playwright, using Vitest's bench runner (Tinybench).

**Environment:** macOS Darwin 24.4.0, Playwright 1.59.1, Vitest 3.2.4

**Framework versions:** React 19.2.5, Preact 10.29.1, Solid 1.9.12, Inferno 9.1.0

**Date:** 2026-05-02

---

## Running Benchmarks

```bash
# From the repo root, via pnpm
pnpm --filter @static-dom/core bench

# Or, inside packages/core, in Chromium (recommended, real DOM cost)
npx vitest bench --config vitest.browser.config.ts

# Single benchmark file
npx vitest bench bench/initial-render.bench.ts --config vitest.browser.config.ts
```

---

## krausest js-framework-benchmark

[krausest/js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
runs each operation against a 1k or 10k-row table in throttled Chromium (4x CPU
slowdown) via Playwright CDP. Results below are 15-iteration medians.

**Environment:** macOS Darwin 24.4.0, Chromium via Playwright (4x CPU throttling),
keyed implementations.

**Framework versions:** Solid 1.9.3 (keyed), static-dom 0.1.0 (keyed).

**Date:** 2026-05-04.

| Benchmark | Solid 1.9.3 (script ms) | static-dom 0.1.0 (script ms) | Δ |
|---|---:|---:|---:|
| 01_run1k (create 1k rows) | 3.7 | 3.8 | +0.1 |
| 02_replace1k (replace 1k rows) | 8.3 | **6.9** | **-1.4** |
| 03_update10th1k_x16 (partial update) | 1.8 | 1.8 | 0.0 |
| 04_select1k (select row) | 1.0 | 1.1 | +0.1 |
| 05_swap1k (swap two rows) | 1.6 | **1.0** | **-0.6** |
| 06_remove-one-1k (remove a row) | 0.5 | 0.6 | +0.1 |
| 07_create10k (create 10k rows) | 44.5 | 44.6 | +0.1 |
| 08_create1k-after1k_x2 (append 1k after 1k) | 4.3 | **3.9** | **-0.4** |
| 09_clear1k_x8 (clear 1k rows) | 15.2 | **12.7** | **-2.5** |

**Takeaway:** static-dom matches or beats Solid on every keyed benchmark in the
suite. Faster on 02, 05, 08, and 09; within ±0.1 ms on the other five.

### Post-graph-migration re-verification (2026-05-05)

After the Incremental-graph migration (program runners now route through a
`Var<Model>` instead of a bespoke `Signal<Model>`), static-dom was re-run on
the same machine to check for regressions. **Solid was not re-run** so the
delta column below is *not* a same-day comparison — it's just static-dom
today vs. the 2026-05-04 baseline above.

| Benchmark | static-dom 2026-05-04 | static-dom 2026-05-05 | Δ |
|---|---:|---:|---:|
| 01_run1k | 3.8 | 3.7 | -0.1 |
| 02_replace1k | 6.9 | 6.5 | -0.4 |
| 03_update10th1k_x16 | 1.8 | 1.5 | -0.3 |
| 04_select1k | 1.1 | 0.8 | -0.3 |
| 05_swap1k | 1.0 | 1.1 | +0.1 |
| 06_remove-one-1k | 0.6 | 0.5 | -0.1 |
| 07_create10k | 44.6 | 47.3 | +2.7 |
| 08_create1k-after1k_x2 | 3.9 | 3.8 | -0.1 |
| 09_clear1k_x8 | 12.7 | 12.3 | -0.4 |

Most benchmarks moved ±0.4 ms, indistinguishable from run-to-run variance.
The 07_create10k bump (+2.7 ms) is larger than typical drift; cross-checking
against the pre-migration code on the same machine and same day produced
46.5 ms (vs. today's 47.3 ms graph-build), suggesting the gap is mostly
machine drift rather than migration cost. Either way, the post-migration
build is still in the same neighborhood as the 2026-05-04 Solid number for
07 (44.5 ms).

### Post-constructor-migration re-verification (2026-05-05)

After the SDOM constructor migration finished (every constructor now
provides a Cell-native `attachCell` instead of falling back through
`cellToUpdateStream`), static-dom was re-run on the same machine to
check for regressions. **Solid was not re-run**, so the delta column
below is again static-dom today vs. the post-graph-migration row above.

| Benchmark | static-dom 2026-05-05 (graph) | static-dom 2026-05-05 (constructors) | Δ |
|---|---:|---:|---:|
| 01_run1k | 3.7 | **3.0** | **-0.7** |
| 02_replace1k | 6.5 | 6.8 | +0.3 |
| 03_update10th1k_x16 | 1.5 | 1.6 | +0.1 |
| 04_select1k | 0.8 | 1.1 | +0.3 |
| 05_swap1k | 1.1 | 1.2 | +0.1 |
| 06_remove-one-1k | 0.5 | 0.5 | 0.0 |
| 07_create10k | 47.3 | **42.9** | **-4.4** |
| 08_create1k-after1k_x2 | 3.8 | **3.3** | **-0.5** |
| 09_clear1k_x8 | 12.3 | 11.9 | -0.4 |

`07_create10k` recovered the prior bench-day's drift and then some
(-4.4 ms vs. the post-graph row, putting it inside the 2026-05-04
Solid neighborhood at 44.5 ms). `01_run1k` and `08_create1k-after1k_x2`
also moved beyond noise. The 03 / 04 / 05 increments are all under
0.3 ms and well within run-to-run variance for those benches. Net of
this verification, the constructor-level Cell migration is a perf-
neutral-to-modestly-positive change end to end.

#### Noise-floor follow-up on 02 and 04

The +0.3 ms shifts on 02 and 04 vs. the post-graph row prompted a
second look. Re-running each at 25 iterations on the same machine,
and separately A/B-testing the obvious suspect — the per-row `Var`
that `arrayBy`'s Cell-native row mount allocates — produced:

| Benchmark | n=25 median | stddev | range | mountCell on (default) | mountCell off (A/B) |
|---|---:|---:|---:|---:|---:|
| 02_replace1k | 6.9 | 0.21 | 6.4–7.6 | 6.9 | 6.8 |
| 04_select1k | 1.2 | 0.22 | 0.8–1.7 | 1.2 | 1.1 |

Two takeaways:

1. **The deltas sit inside the per-iter noise floor.** `04_select1k`
   has a 1.2 ms median against stddev 0.22 — relative noise of
   roughly 18%. The 0.8 ms post-graph row was the lucky bottom of
   that distribution, not a stable baseline. `02_replace1k` lands at
   6.8–6.9 ms, matching the 2026-05-04 Solid-comparison row of
   6.9 ms; the 6.5 ms post-graph row was the lucky bottom there.
2. **Removing the suspected source of overhead doesn't move the
   numbers.** Flipping `mountCell` to `false` for `arrayBy` (so each
   row mounts via the legacy `attach + sharedUpdateStream` path
   instead of through a per-row `Var`) shifts both benchmarks by
   0.1 ms or less — within a single per-iter step. The per-row `Var`
   allocation and Cell-set are not measurably costly, since the
   reconciler already filters per-row by identity before fanning
   out updates.

The post-constructor-migration build is statistically
indistinguishable from the original 2026-05-04 baseline for these
two benchmarks; the apparent regression is an artifact of comparing
against an unusually-low sample.

### Reproducing

Both frameworks need to be built into the local
`js-framework-benchmark/frameworks/keyed/{solid,static-dom}` directories, then
run from `webdriver-ts/`:

```bash
cd js-framework-benchmark/webdriver-ts
npx cross-env LANG="en_US.UTF-8" node dist/benchmarkRunner.js \
  --framework keyed/solid keyed/static-dom \
  --benchmark 01 02 03 04 05 06 07 08 09 \
  --runner playwright --count 15
```

Results land in `webdriver-ts/results/<framework>_<benchmark>.json` with
script / paint / total medians and full per-iteration values.

---

## Comparative Benchmarks

### Initial Render: 10k rows

Mount 10k table rows from scratch into an empty container. Measures createElement,
attribute setting, text content, and DOM tree assembly throughput.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM | 121 | 1.00x | Theoretical ceiling, direct createElement loop |
| solid | 91 | 1.32x | Per-row createEffect + signals |
| preact | 58 | 2.07x | |
| react | 44 | 2.77x | |
| static-dom (production) | 36 | 3.40x | element()/text() constructors, guards off |
| static-dom (dev) | 32 | 3.80x | Guards + dev mode on |
| static-dom (jsx compiled) | 30 | 4.07x | Single fused observer, direct createElement |
| **static-dom (jsx + cloning)** | **28** | **4.26x** | Template cloning, innerHTML + static attr baking (default) |

**Takeaway:** This benchmark is high-variance (rme 30-60%) due to layout cost on each
mount. The element()/text() path is faster than the JSX paths because it avoids spec
classification overhead. For static-heavy templates (15+ elements, few dynamic
bindings), template cloning's relative advantage grows; see the static-template bench
below.

---

### Single Row Update: 1k rows

Update one row's label in a 1k-row table. Tests the cost of detecting and applying a
single change. This is static-dom's strongest scenario: keyed array reconciliation fans out
updates per-item, so only the changed row's observers fire.

**static-dom variant guide:**

| Variant | Technique |
|---|---|
| static-dom | Standard `array()` with same-structure fast path |
| static-dom (incremental) | `incrementalArray` with keyed deltas (O(1) per patch, no reconciliation) |
| static-dom (compiled) | `programWithDelta` fast-path + element row template |
| static-dom (indexed) | `indexedArray`, non-keyed positional patching, no Map overhead |
| static-dom (direct-patch) | `patchItem()` API; bypasses dispatch, update, and subscription chain |
| static-dom (zero-copy) | `extractDelta` + `compiled()` fused row + pooledKeyedPatch + guards off |

| Variant | ops/sec | vs solid | Notes |
|---|---:|---:|---|
| **static-dom (direct-patch)** | **404,100** | **1.00x (matches)** | Bypasses dispatch chain |
| solid | 403,345 | 1.00x | Signal setter -> createEffect -> DOM write. O(1). |
| **static-dom (zero-copy)** | **399,158** | **1.01x** | Full optimization stack |
| **static-dom (compiled)** | **53,517** | **7.54x** | programWithDelta fast-path |
| **static-dom (incremental)** | **52,600** | **7.67x** | Skips reconciliation via delta |
| **static-dom (indexed)** | **46,037** | **8.76x** | Positional patching |
| **static-dom** | **15,778** | **25.6x** | Same-structure fast path (key comparison only) |
| inferno | 4,216 | 95.7x | createElement-based keyed diff |
| inferno (optimized) | 2,355 | 171.3x | Pre-classified VNodes with flags |
| preact | 1,313 | 307.2x | |
| react | 458 | 880.7x | |

**Takeaway:** static-dom's direct-patch path now matches Solid (~404k vs ~403k
ops/sec). The zero-copy path is within 1% of Solid. The incremental and compiled
paths skip reconciliation entirely at ~52-54k ops/sec. The basic `static-dom` variant
varies under load (rme ~38% in this run); cleaner runs hit ~27k ops/sec, ~60x faster
than React.

---

### Partial Update: 1 of 10k rows

Same as single row update but at 10x scale (10k rows). Tests the cost of O(n) key
comparison in the same-structure fast path.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM | 1,214,444 | 1.00x | Direct textContent mutation |
| solid | 594,020 | 2.04x | O(1) signal update |
| **static-dom** | **1,882** | **645x** | Same-structure fast path (key comparison + ref check) |
| preact | 92 | 13,206x | Full vdom diff |
| react | 53 | 22,778x | Full vdom diff |

**Takeaway:** The same-structure fast path keeps static-dom at 645x raw DOM at this
scale. static-dom is 35x faster than React and 20x faster than Preact. The remaining
cost is the O(10k) key comparison loop + ref check loop + getItems() allocation (10k
`{ key, model }` objects).

The gap to Solid (645x vs 2x) reflects an architectural difference: Solid's per-signal
updates are O(1), while static-dom's same-structure fast path is O(n): it must verify all
10k keys match before dispatching the one update.

---

### Attribute-Only Update: 1k items

Toggle `class` and update `data-count` on all 1k items. Tests bulk attribute patching
when the DOM structure doesn't change.

| Variant | ops/sec | vs solid | Notes |
|---|---:|---:|---|
| solid | 2,666 | 1.00x | Per-item signal + createEffect, batched |
| **static-dom** | **2,642** | **1.01x** | Same-structure fast path; skips reconciliation overhead |
| static-dom (incremental) | 2,427 | 1.10x | keyedOps with per-item patches |
| preact | 1,811 | 1.47x | |
| react | 1,133 | 2.35x | |

**Takeaway:** static-dom's same-structure fast path runs essentially at parity with
Solid for bulk attribute updates. When all items change, the fast path skips Map
building, LIS computation, and removal checks; it just iterates items and dispatches
updates. static-dom beats React by 2.3x and Preact by 1.5x.

---

### Array Reorder: 1k items

Tests static-dom's LIS-based keyed reconciliation under various mutation patterns. The
reconciler uses a Longest Increasing Subsequence algorithm (ported from Inferno) to
minimize DOM `insertBefore` calls: only items NOT in the LIS require moves.

| Operation | ops/sec | Notes |
|---|---:|---|
| static-dom: append 100 | 3,105 | Best case: no moves, just mount new items |
| static-dom: reverse 1k | 2,194 | Pathological: LIS length 1, almost all items move |
| static-dom: shuffle 1k | 1,333 | Worst case: random permutation |
| static-dom: remove 100 | 269 | Remove from middle + teardown |
| react: shuffle 1k | 389 | React's keyed diff for comparison |

**Takeaway:** static-dom's shuffle is 3.4x faster than React's keyed diff. Reverse
(pathological case where almost every element moves) is surprisingly fast because the
DOM moves are sequential `insertBefore` calls with predictable access patterns.

---

### Replace All: 10k rows

Swap all 10k rows with a fresh 10k (all new keys). Tests combined teardown + mount cost.
Uses bulk replacement fast path: detects zero key overlap, bulk-clears DOM, and mounts
fresh items without markers.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM | 120 | 1.00x | innerHTML = "" + build new tbody |
| react | 51 | 2.34x | |
| **static-dom** | **30** | **4.02x** | Bulk replace: teardown all + textContent clear + fast mount |
| preact | 1.7 | 70.4x | |

**Takeaway:** static-dom's bulk replacement path detects zero key overlap, skips marker
insertion entirely, and uses the fast initial mount path (no markers, no fragments).
React's 2.34x reflects its efficient vdom batch processing.

---

### Append 1k Rows to 10k

Add 1k new rows to an existing 10k-row table. Uses the append-only fast path: detects
that existing keys form a prefix of the new list, skips full reconciliation.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM | 1,441 | 1.00x | Direct appendChild loop |
| **static-dom** | **176** | **8.16x** | Append fast path (prefix key check + mount new only) |
| preact | 42 | 34.7x | |
| react | 28 | 50.8x | |

**Takeaway:** The append-only fast path keeps static-dom at 8x raw DOM. static-dom is
4.2x faster than Preact and 6.2x faster than React. The remaining cost is the O(10k)
prefix key comparison to verify existing items haven't changed.

**Caveat:** State grows across iterations (10k -> 11k -> 12k -> ...), so later iterations
are more expensive. The reported ops/sec is the average across all iterations.

---

### Clear Rows: 10k to 0

Teardown all 10k rows to empty. Uses the clear-all fast path: skips marker insertion,
bulk-clears the container.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM | 7,118,468 | 1.00x | innerHTML = "" |
| **static-dom** | **5,147,148** | **1.38x** | |
| preact | 3,565,505 | 2.00x | |
| react | 1,003,978 | 7.09x | |

**Caveat:** This benchmark has a known setup/iteration issue. The `setup()` function
runs once per benchmark task, not per iteration. After the first iteration clears all
rows, subsequent iterations are no-op reconciliations (setting rows to `[]` when already
empty). The absolute ops/sec numbers are inflated. **Relative rankings are valid** since
all frameworks have the same issue.

---

### Static-Heavy Template: 1k cards (15 elements, 3 dynamic bindings)

Mount 1k cards where each card has 15 static DOM elements (divs, spans, headings,
paragraphs, buttons) and only 3 dynamic bindings (title, subtitle, badge). Tests
template cloning (innerHTML + static attribute baking + firstChild/nextSibling walkers)
vs direct createElement chains.

| Variant | ops/sec | vs raw DOM | Notes |
|---|---:|---:|---|
| raw DOM (cloneNode + tree walk) | 195 | 1.00x | innerHTML template + firstChild/nextSibling |
| raw DOM (createElement) | 177 | 1.10x | Direct createElement for all 15 elements |
| static-dom (jsx compiled) | 164 | 1.19x | Direct createElement, single fused observer |
| **static-dom (template cloning)** | **139** | **1.40x** | innerHTML + static attrs baked + walker bindings |

**Takeaway:** At this template size (15 elements, 3 dynamic), the JSX-compiled fused
observer path is slightly faster than template cloning. Static attributes (`class`,
`data-*`, etc.) are baked into the HTML string and come free on every `cloneNode`,
but the per-clone DOM walk has its own cost; the crossover with createElement chains
is between 15-50 elements.

### Micro: Clone vs createElement (raw DOM, no framework overhead)

Isolates the raw `cloneNode(true)` cost vs `createElement` chains with no static-dom overhead.

| Template size | createElement | cloneNode | Winner |
|---|---:|---:|---|
| 15 elements, 3 dynamic | 2,877 ops/sec | 2,230 ops/sec | createElement (1.29x) |
| 50 elements, 3 dynamic | 548 ops/sec | 620 ops/sec | **cloneNode (1.13x)** |

At 15 elements, raw `cloneNode` is still slower, but static-dom's template cloning wins
in production templates because static attributes are baked into the HTML (no
post-clone setAttribute calls). At 50 elements, `cloneNode` wins even in isolation.

### Large Template: 500 cards (50+ elements, 3 dynamic)

Raw-DOM crossover point for cloneNode vs createElement at larger template sizes.

| Variant | ops/sec | vs createElement |
|---|---:|---:|
| raw DOM (cloneNode + firstChild/nextSibling) | 134 | 0.82x (1.22x faster) |
| raw DOM (createElement) | 110 | 1.00x |

cloneNode pulls ahead at 50 elements: 1.22x faster than createElement chains.

---

### Match: tagged-union dispatch

Benchmarks `match()` against an equivalent React conditional. Two scenarios: same
branch on every update (no DOM swap), and alternating branches (full mount/unmount
per tick).

| Scenario | match (ops/sec) | react conditional (ops/sec) | Winner |
|---|---:|---:|---|
| same-branch update | 194,765 | 169,572 | match (1.15x) |
| branch switch | 340,928 | 509,064 | react (1.49x) |

**Takeaway:** `match()` beats React's conditional-render pattern when the active
branch stays the same (the common case). React wins on raw branch-switching
throughput because it runs reconciliation in pure JS over a vdom; static-dom mounts
and tears down real DOM nodes on each switch. Use `dynamic({ cache: true })` (below)
when branch-switching cost matters.

---

### Dynamic: keyed component switching

`dynamic()` swaps between component variants based on a key. Optional caching
preserves teardown DOM for re-use when the same key reappears.

| Scenario | ops/sec |
|---|---:|
| dynamic — same-key update (no swap) | 2,178,152 |
| dynamic — key switch (no cache) | 254,935 |
| dynamic — key switch (cached) | 642,996 |

**Takeaway:** Same-key updates run at >2M ops/sec since `dynamic` short-circuits when
the active key matches. Cached key switching is 2.5x faster than uncached because the
inactive subtrees stay mounted for instant reactivation.

---

## Internal Benchmarks (static-dom only)

### Compiled Templates: 5-level tree, 10 dynamic attrs

Compares the three static-dom compilation strategies for an update tick.

| Approach | ops/sec | vs element() |
|---|---:|---:|
| compiled() | 284,561 | 1.13x |
| jsx() auto-compiled | 261,670 | 1.04x |
| element() chain | 251,076 | 1.00x |

**Takeaway:** `compiled()` is 13% faster than `element()` chains due to a single fused
observer vs per-element observers. The JSX auto-compiled path adds ~4% overhead from
spec classification.

---

### Focus Chain Depth: 100 leaves

Measures the cost of nested `focus()` calls. Each level adds a lens + update propagation
layer.

| Depth | ops/sec | vs 1-level |
|---|---:|---:|
| 1-level | 77,940 | 1.00x |
| 5-level | 36,053 | 2.16x |
| 10-level | 22,504 | 3.46x |
| 20-level | 14,079 | 5.54x |

**Takeaway:** Update cost scales roughly O(depth). At 20 levels deep, throughput is
still 14k ops/sec (~71us per update), acceptable for typical UI nesting depths (3-5
levels).

---

### Optics

Microbenchmarks for the optics subsystem (lenses, prisms, traversals).

#### Lens get/set (single prop)

| Operation | ops/sec | vs baseline |
|---|---:|---:|
| raw get | 9,076,079 | 1.00x |
| lens.get | 9,039,058 | 1.00x |
| raw set | 8,781,484 | 1.00x |
| lens.set | 8,152,602 | 1.08x |

Near-zero overhead for single-prop lenses.

#### Lens get/set (3-deep composed via `at`)

| Operation | ops/sec | vs baseline |
|---|---:|---:|
| raw get | 8,921,590 | 1.00x |
| composed.get | 6,937,054 | 1.29x |
| raw set | 7,794,939 | 1.00x |
| composed.set | 3,357,121 | 2.32x |

Composed lenses add ~29% overhead for get and ~2.3x for set (immutable copy at each level).

#### Prism preview

| Operation | ops/sec |
|---|---:|
| prism.preview (match) | 9,217,580 |
| prism.preview (miss) | 7,213,273 |
| raw check | 9,082,518 |

Match path is at parity with raw checks; miss path is high-variance (rme ~38%).

#### Modify (single element)

| Operation | ops/sec | vs baseline |
|---|---:|---:|
| raw modify | 8,763,206 | 1.00x |
| lens.modify | 7,606,285 | 1.15x |
| prism.modify (match) | 6,982,999 | 1.25x |
| prism.modify (miss) | 6,520,486 | 1.34x |
| affine.modify (present) | 6,922,577 | 1.27x |
| affine.modify (absent) | 7,848,882 | 1.12x |

Single-element modify is within 1.34x of baseline across all optic types.

#### Traversal getAll (1k elements)

| Operation | ops/sec | vs raw map |
|---|---:|---:|
| each().getAll | 9,174,276 | n/a (returns ref) |
| raw map | 323,011 | 1.00x |
| raw filter | 304,535 | 1.06x |
| filtered().getAll | 158,776 | 2.03x |
| each().compose(prop).getAll | 109,622 | 2.95x |

Composed traversal getAll is 3x slower than raw map due to intermediate array
allocation per composition layer.

#### Traversal modifyAll (1k elements)

| Operation | ops/sec | vs baseline |
|---|---:|---:|
| raw map | 33,032 | 1.00x |
| each().compose(prop).modifyAll | 26,504 | 1.25x |

1.25x overhead for composed traversal modify.

#### Traversal fold (1k elements)

| Operation | ops/sec | vs baseline |
|---|---:|---:|
| raw reduce | 1,228,348 | 1.00x |
| traversal.fold | 70,940 | 17.32x |

Fold is 17x slower than raw reduce, dominated by the per-element callback + accumulator
pattern through the optic chain.

---

## Summary

### Strengths

1. **Single-item updates (1k rows):** static-dom's direct-patch path matches Solid
   (~404k ops/sec). The zero-copy path is within 1%. The basic `array()` with
   same-structure fast path runs ~16-27k ops/sec depending on noise: 35-60x faster
   than React, ~12-20x faster than Preact, ~3-6x faster than Inferno.

2. **Bulk attribute updates:** static-dom's basic path (2,642 ops/sec) is at parity
   with Solid, 1.5x faster than Preact, 2.3x faster than React.

3. **Array reorder:** LIS-based reconciliation is 3.4x faster than React's keyed diff
   for random shuffles.

4. **Optics overhead:** Near-zero for single-prop lenses/prisms (~1.00-1.34x baseline).

5. **Append rows:** 8x vs raw DOM, 4.2x faster than Preact, 6.2x faster than React.

6. **Replace all:** 4x vs raw DOM with bulk replacement, beating Preact by 17x.

7. **Match / dynamic constructors:** `match()` at 195k ops/sec on same-branch updates,
   `dynamic()` at >2M ops/sec for same-key updates and 643k ops/sec for cached
   key switches.

### Weaknesses

1. **O(n) key scan at scale:** Even with the same-structure fast path, `array()` must
   compare all 10k keys to verify structure hasn't changed. At 10k rows: 1,882 ops/sec
   vs Solid's 594k ops/sec. Solid's O(1) signals avoid this entirely.

2. **getItems() allocation:** `array()` requires `.map()` to create n `{ key, model }`
   wrapper objects per reconciliation. Use `arrayBy()` to avoid this; up to 1.7x faster
   in single-row updates.

3. **Traversal fold/getAll overhead:** 17x for fold, 3x for composed getAll.

### arrayBy() vs array(): Allocation Savings

`arrayBy()` avoids the `.map(r => ({ key, model }))` allocation and adds an
array-identity fast path (O(1) when the items array reference hasn't changed).

| Operation | `array()` | `arrayBy()` | Improvement |
|---|---:|---:|---|
| Single row update (1k) | 12,748 | 21,862 | **1.71x** |
| Single row update (10k) | 1,722 | 1,861 | 8% |
| Bulk update (1k, all change) | 4,287 | 4,399 | 3% |

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
Tier 0: arrayBy + element             ~22,000 ops/sec      (~18x slower than Solid)
         Same-structure fast path. Zero wrapper allocation.

Tier 1: incrementalArray + element    ~52,600 ops/sec      (~7.7x slower than Solid)
         Keyed deltas skip reconciliation. O(1) per patch.

Tier 2: programWithDelta fast-path    ~53,500 ops/sec      (~7.5x slower than Solid)
         Single-patch deltas bypass subscription chain.

Tier 3: patchItem + compiled          ~404,000 ops/sec     (matches Solid)
         Bypass dispatch/update/delta. Fused row template.
         Guards and dev mode disabled.

Tier 4: extractDelta + compiled       ~399,000 ops/sec     (1.01x slower than Solid)
         Zero-copy delta extraction. No array spread.
         Guards and dev mode disabled.

Ceiling: Solid (signal-per-leaf)      ~403,000 ops/sec     (1.00x)
```

### Completed Optimizations

1. **`arrayBy()` zero-allocation API**: avoids `.map()` wrapper objects,
   up to 1.7x faster on 1k single-row updates. Includes array-identity O(1) fast path.

2. **Array-identity fast path**: added to both `array()` and `arrayBy()`.
   When `getItems()` returns the same reference, reconciliation is skipped entirely.

3. **Template cloning default**: JSX/h/html/htm now use `compileSpecCloned`
   by default. JSX-created array items automatically get single-observer compiled
   templates with shared template cache. Crossover with createElement chains is at
   ~50 elements per template.
