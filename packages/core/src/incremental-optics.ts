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
import { mapCell } from "./incremental-graph"
import type { Fold, Getter, Lens } from "./optics"

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
