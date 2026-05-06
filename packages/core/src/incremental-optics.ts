/**
 * incremental-optics.ts — Lift optics over the incremental computation graph.
 *
 * The architectural payoff of FUTURE_DIRECTIONS Direction 2: an optic's
 * domain notion of equality becomes the cutoff on the derived cell. Fields
 * that the optic does not read never propagate; fields whose lens-equality
 * says "unchanged" never fire observers. This is `if (v !== lasts[i])`
 * lifted off the binding loop and into the graph.
 *
 * Read-side lifts (Getter, Lens, Fold) are thin wrappers around `mapCell`.
 * `focusVar` is the bidirectional case: a `Var<S>` plus a `Lens<S, A>`
 * behaves as a `Var<A>` — reads project, writes go back through `lens.set`.
 *
 * `liftPrism` is intentionally absent. It is `bind` (dynamic graph
 * reshaping), which the graph does not support yet; it lands once the
 * `bindCell` primitive does.
 */

import type { Cell, Var } from "./incremental-graph"
import { bindCell, mapCell } from "./incremental-graph"
import type { Affine, Fold, Getter, Lens, Prism } from "./optics"

function defaultArrayEq<A>(a: ReadonlyArray<A>, b: ReadonlyArray<A>): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Project a Cell through a Getter. Recomputes when the parent settles;
 * cutoff defaults to reference equality on `A`.
 */
export function liftGetter<S, A>(
  getter: Getter<S, A>,
  cell: Cell<S>,
  eq?: (a: A, b: A) => boolean,
): Cell<A> {
  return mapCell(cell, (s) => getter.get(s), eq)
}

/**
 * Project a Cell through a Lens (read side). Identical to `liftGetter` for
 * reads — exposed under its own name so calling code documents intent.
 */
export function liftLens<S, A>(
  lens: Lens<S, A>,
  cell: Cell<S>,
  eq?: (a: A, b: A) => boolean,
): Cell<A> {
  return mapCell(cell, (s) => lens.get(s), eq)
}

/**
 * Project a Cell through a Fold. Default cutoff is structural array
 * equality (length plus per-element reference equality), so a fold that
 * yields the same elements in the same order does not propagate.
 */
export function liftFold<S, A>(
  fold: Fold<S, A>,
  cell: Cell<S>,
  eq?: (a: ReadonlyArray<A>, b: ReadonlyArray<A>) => boolean,
): Cell<ReadonlyArray<A>> {
  return mapCell(cell, (s) => fold.getAll(s), eq ?? defaultArrayEq)
}

/**
 * Project a Cell through a Prism's preview. Result is `Cell<A | null>`
 * where `null` means the prism did not match. Cutoff defaults to
 * reference equality, so present-with-same-value or absent-staying-absent
 * transitions do not propagate.
 *
 * This is the flat read-side lift. For dynamic graph reshaping (swap one
 * subgraph for another when the prism's match status flips), see
 * `bindPrism`.
 */
export function liftPrism<S, A>(
  prism: Prism<S, A>,
  cell: Cell<S>,
  eq?: (a: A | null, b: A | null) => boolean,
): Cell<A | null> {
  return mapCell(cell, (s) => prism.preview(s), eq)
}

/**
 * Bind-shaped lift of a Prism: choose a `Cell<B>` based on whether the
 * prism matches. `f` receives `A` when the prism matches and `null` when
 * it does not, and returns the cell to track from there. Switching
 * branches rewires the graph and bumps heights as needed; the previous
 * branch stops driving the result.
 *
 * Useful for "mount this view when the case applies, that view otherwise"
 * shapes — e.g. a `Loaded | Loading | Error` union where each constructor
 * gets its own derived cell.
 */
export function bindPrism<S, A, B>(
  prism: Prism<S, A>,
  cell: Cell<S>,
  f: (a: A | null) => Cell<B>,
  eq?: (a: B, b: B) => boolean,
): Cell<B> {
  return bindCell(liftPrism(prism, cell), f, eq)
}

/**
 * Project a Cell through an Affine's preview. Same shape as `liftPrism`:
 * `Cell<A | null>` with reference-equality cutoff by default.
 */
export function liftAffine<S, A>(
  affine: Affine<S, A>,
  cell: Cell<S>,
  eq?: (a: A | null, b: A | null) => boolean,
): Cell<A | null> {
  return mapCell(cell, (s) => affine.preview(s), eq)
}

/**
 * Focus a Var through a Lens. The result behaves as a `Var<A>`: `.value`
 * tracks `lens.get(source.value)`, `.set(a)` writes back through
 * `lens.set` on the source, and `.observe` fires only when the focused
 * field changes.
 *
 * Cutoff is the lens's domain equality on `A`. Source-level changes that
 * leave the focused field intact never cross into the focused observer.
 */
export function focusVar<S, A>(
  lens: Lens<S, A>,
  source: Var<S>,
  eq?: (a: A, b: A) => boolean,
): Var<A> {
  const cell = mapCell(source, (s) => lens.get(s), eq)
  return {
    get value() {
      return cell.value
    },
    observe(observer) {
      return cell.observe(observer)
    },
    set(a: A) {
      source.set(lens.set(a, source.value))
    },
    _internal: cell._internal,
  }
}
