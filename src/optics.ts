/**
 * optics.ts
 *
 * Unified optics using Effect-style HKT simulation with type lambdas.
 *
 * Each optic kind is a TypeLambda interface whose `Target` field computes
 * the concrete type when "applied" via `Kind<F, S, A>`. Composition uses
 * `ComposeOptics<F, G>` to compute the result type lambda at the type level.
 *
 * Subtyping lattice:
 *
 *          Iso
 *        /     \
 *     Lens     Prism
 *        \     /
 *        Affine
 *
 * Composition table:
 *
 *   Iso   + Iso   = Iso
 *   Lens  + Lens  = Lens
 *   Prism + Prism = Prism
 *   Lens  + Prism = Affine
 *   Prism + Lens  = Affine
 *   Iso   + X     = X
 *   X     + Iso   = X
 */

// ---------------------------------------------------------------------------
// Either — minimal internal type (not exported)
// ---------------------------------------------------------------------------

type Either<A, E> =
  | { readonly _tag: "Right"; readonly right: A }
  | { readonly _tag: "Left"; readonly left: E }

function right<A>(a: A): Either<A, never> {
  return { _tag: "Right", right: a }
}

function isRight<A, E>(e: Either<A, E>): e is { readonly _tag: "Right"; readonly right: A } {
  return e._tag === "Right"
}

/** Shared sentinel for "not present" — avoids allocating Error objects on every prism miss. */
const LEFT_ABSENT: Either<never, Error> = { _tag: "Left", left: new Error("absent") }

// ---------------------------------------------------------------------------
// HKT Foundation — Effect-style type lambda encoding
// ---------------------------------------------------------------------------

/**
 * Base interface for optic type lambdas.
 *
 * Each optic kind defines an interface extending this with a `Target` field
 * that references `this["S"]` and `this["A"]` to compute the concrete type.
 * `Kind<F, S, A>` "applies" the lambda by intersecting with `{S: S, A: A}`
 * and reading `Target`.
 */
export interface OpticTypeLambda {
  readonly S: unknown
  readonly A: unknown
  readonly Target: unknown
}

/**
 * Apply an optic type lambda to concrete type arguments.
 *
 * @example
 * ```typescript
 * type Result = Kind<LensTypeLambda, User, string>
 * //   ^? Lens<User, string>
 * ```
 */
export type Kind<F extends OpticTypeLambda, S, A> =
  (F & { readonly S: S; readonly A: A })["Target"]

// ---------------------------------------------------------------------------
// Concrete type lambdas — one per optic kind
// ---------------------------------------------------------------------------

/** Type lambda for Iso: `Kind<IsoTypeLambda, S, A>` = `Iso<S, A>` */
export interface IsoTypeLambda extends OpticTypeLambda {
  readonly Target: Iso<this["S"], this["A"]>
}

/** Type lambda for Lens: `Kind<LensTypeLambda, S, A>` = `Lens<S, A>` */
export interface LensTypeLambda extends OpticTypeLambda {
  readonly Target: Lens<this["S"], this["A"]>
}

/** Type lambda for Prism: `Kind<PrismTypeLambda, S, A>` = `Prism<S, A>` */
export interface PrismTypeLambda extends OpticTypeLambda {
  readonly Target: Prism<this["S"], this["A"]>
}

/** Type lambda for Affine: `Kind<AffineTypeLambda, S, A>` = `Affine<S, A>` */
export interface AffineTypeLambda extends OpticTypeLambda {
  readonly Target: Affine<this["S"], this["A"]>
}

// ---------------------------------------------------------------------------
// Composition table — maps pairs of type lambdas to the result type lambda
// ---------------------------------------------------------------------------

/**
 * Type-level composition of optic type lambdas.
 *
 * Mirrors the subtyping lattice: composing with Iso preserves kind,
 * same-kind composition preserves kind, cross-kind yields Affine.
 */
export type ComposeOptics<F extends OpticTypeLambda, G extends OpticTypeLambda> =
  F extends IsoTypeLambda ? G :
  G extends IsoTypeLambda ? F :
  F extends LensTypeLambda ? (G extends LensTypeLambda ? LensTypeLambda : AffineTypeLambda) :
  F extends PrismTypeLambda ? (G extends PrismTypeLambda ? PrismTypeLambda : AffineTypeLambda) :
  AffineTypeLambda

/**
 * Result of composing an OpticBase<F> with a Getter.
 * Iso/Lens + Getter = Getter. Prism/Affine + Getter = Fold.
 */
export type ComposeWithGetter<F extends OpticTypeLambda, S, B> =
  F extends IsoTypeLambda ? Getter<S, B> :
  F extends LensTypeLambda ? Getter<S, B> :
  Fold<S, B>

// ---------------------------------------------------------------------------
// OpticBase — shared methods, parameterized by type lambda
// ---------------------------------------------------------------------------

/**
 * Base interface for all single-target optics, parameterized by a type lambda F.
 *
 * The compose method uses ComposeOptics to compute the result type at the
 * type level — one signature handles all kind combinations.
 */
export interface OpticBase<F extends OpticTypeLambda, S, A> {
  /** Phantom discriminant — provides structural distinction between optic kinds. */
  readonly _F?: F

  /** The raw get function (Either-based). Part of the optic contract. */
  readonly getOptic: (s: S) => Either<A, Error>
  /** The raw set function (Either-based). Part of the optic contract. */
  readonly setOptic: (a: A) => (s: S) => Either<S, Error>

  /** Compose this optic with a Traversal, yielding a Traversal. */
  compose<B>(that: Traversal<A, B>): Traversal<S, B>

  /** Compose with a Getter. Yields Getter if this is Iso/Lens, Fold otherwise. */
  compose<B>(that: Getter<A, B>): ComposeWithGetter<F, S, B>

  /** Compose with a Fold, yielding a Fold. */
  compose<B>(that: Fold<A, B>): Fold<S, B>

  /** Compose with a Setter, yielding a Setter. */
  compose<B>(that: Setter<A, B>): Setter<S, B>

  /**
   * Compose this optic with another single-target optic.
   * Result kind is computed at the type level via ComposeOptics.
   */
  compose<G extends OpticTypeLambda, B>(
    that: OpticBase<G, A, B>
  ): Kind<ComposeOptics<F, G>, S, B>

  /** Transform the focus value in place. Works on all optic types. */
  modify(f: (a: A) => A): (s: S) => S

  /**
   * Extract the sub-delta for this optic's focus from a parent delta.
   * Returns `undefined` if the delta doesn't apply.
   * SDOM-specific: enables O(1) delta propagation through `focus`.
   */
  getDelta?: (parentDelta: unknown) => unknown | undefined
}

// ---------------------------------------------------------------------------
// Concrete optic interfaces — each extends OpticBase with its type lambda
// ---------------------------------------------------------------------------

/** Isomorphism: total bidirectional conversion. */
export interface Iso<S, A> extends OpticBase<IsoTypeLambda, S, A> {
  readonly from: (s: S) => A
  readonly to: (a: A) => S
  readonly get: (s: S) => A
  readonly set: (a: A, s: S) => S
  readonly preview: (s: S) => A | null
  readonly review: (a: A) => S
  readonly toUpdate: () => (s: S) => A
}

/** Lens: total get, whole-dependent set. */
export interface Lens<S, A> extends OpticBase<LensTypeLambda, S, A> {
  /** Read the focused value. Always succeeds. */
  readonly get: (s: S) => A
  /** Write the focused value, returning a new whole. */
  readonly set: (a: A, s: S) => S
  /** Alias of `get` — convenience for mapUpdate usage. */
  readonly toUpdate: () => (s: S) => A
}

/** Prism: partial get, whole-independent set (has review). */
export interface Prism<S, A> extends OpticBase<PrismTypeLambda, S, A> {
  /** Try to extract A. Returns null if not present. */
  readonly preview: (s: S) => A | null
  /** Embed A into S. */
  readonly review: (a: A) => S
  /** Compose with a Lens. Backward compat alias for compose(). */
  readonly composeLens: <B>(l: Lens<A, B>) => Affine<S, B>
}

/** Affine/Optional: partial get, whole-dependent set. */
export interface Affine<S, A> extends OpticBase<AffineTypeLambda, S, A> {
  /** Try to extract A. Returns null if not present. */
  readonly preview: (s: S) => A | null
  /** Write A back if the target exists. Returns S unchanged if target absent. */
  readonly set: (a: A, s: S) => S
}

// ---------------------------------------------------------------------------
// Backward-compatible type aliases
// ---------------------------------------------------------------------------

/** String-literal optic kind tags — backward compat. */
export type OpticKind = "iso" | "lens" | "prism" | "affine"

/** Map a string kind tag to its type lambda. */
export type KindToLambda<K extends OpticKind> =
  K extends "iso" ? IsoTypeLambda :
  K extends "lens" ? LensTypeLambda :
  K extends "prism" ? PrismTypeLambda :
  K extends "affine" ? AffineTypeLambda :
  never

/** Compose string-based kind tags. Backward compat wrapper over ComposeOptics. */
export type ComposeKinds<K1 extends OpticKind, K2 extends OpticKind> =
  ComposeOptics<KindToLambda<K1>, KindToLambda<K2>> extends IsoTypeLambda ? "iso" :
  ComposeOptics<KindToLambda<K1>, KindToLambda<K2>> extends LensTypeLambda ? "lens" :
  ComposeOptics<KindToLambda<K1>, KindToLambda<K2>> extends PrismTypeLambda ? "prism" :
  ComposeOptics<KindToLambda<K1>, KindToLambda<K2>> extends AffineTypeLambda ? "affine" :
  "affine"

/** Resolve a string kind tag to a concrete optic type. Backward compat. */
export type ResolveOptic<K extends OpticKind, S, A> = Kind<KindToLambda<K>, S, A>

/** Convenience alias: `Optic<"lens", S, A>` = `Lens<S, A>`. */
export type Optic<K extends OpticKind, S, A> = ResolveOptic<K, S, A>

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/**
 * Traversal: focuses on zero or more targets within a whole.
 *
 * Unlike Iso/Lens/Prism/Affine, a Traversal is not modeled as getOptic/setOptic
 * since it targets multiple values. It has its own interface with:
 *   - getAll: extract all focused values
 *   - modifyAll: transform all focused values in place
 *   - fold: fold all focused values with a combining function and initial value
 *   - compose: compose with another Traversal or any single-target optic
 */
export interface Traversal<S, A> {
  /** Extract all focused values. */
  readonly getAll: (s: S) => ReadonlyArray<A>
  /** Transform all focused values, returning a new whole. */
  readonly modifyAll: (f: (a: A) => A) => (s: S) => S
  /** Fold all focused values using a combining function and initial value. */
  readonly fold: <R>(f: (acc: R, a: A) => R, initial: R) => (s: S) => R
  /** Compose with another Traversal. */
  compose<B>(that: Traversal<A, B>): Traversal<S, B>
  /** Compose with a Lens to traverse then focus. */
  compose<B>(that: Lens<A, B>): Traversal<S, B>
  /** Compose with a Prism to traverse then filter. */
  compose<B>(that: Prism<A, B>): Traversal<S, B>
  /** Compose with an Affine. */
  compose<B>(that: Affine<A, B>): Traversal<S, B>
  /** Compose with a Getter, yielding a Fold. */
  compose<B>(that: Getter<A, B>): Fold<S, B>
  /** Compose with a Fold. */
  compose<B>(that: Fold<A, B>): Fold<S, B>
  /** Compose with a Setter. */
  compose<B>(that: Setter<A, B>): Setter<S, B>
}

// ---------------------------------------------------------------------------
// Getter — read-only single-target optic
// ---------------------------------------------------------------------------

/** Getter: read-only total access. Like a Lens without set. */
export interface Getter<S, A> {
  /** Read the focused value. Always succeeds. */
  readonly get: (s: S) => A
  /** Compose with another Getter. */
  compose<B>(that: Getter<A, B>): Getter<S, B>
  /** Compose with a Lens (read part only). */
  compose<B>(that: Lens<A, B>): Getter<S, B>
  /** Compose with an Iso. */
  compose<B>(that: Iso<A, B>): Getter<S, B>
  /** Compose with a Prism → Fold (may fail). */
  compose<B>(that: Prism<A, B>): Fold<S, B>
  /** Compose with an Affine → Fold (may fail). */
  compose<B>(that: Affine<A, B>): Fold<S, B>
  /** Compose with a Fold. */
  compose<B>(that: Fold<A, B>): Fold<S, B>
  /** Compose with a Traversal → Fold. */
  compose<B>(that: Traversal<A, B>): Fold<S, B>
}

// ---------------------------------------------------------------------------
// Fold — read-only multi-target optic
// ---------------------------------------------------------------------------

/** Fold: read-only access to zero or more targets. Like a Traversal without modify. */
export interface Fold<S, A> {
  /** Extract all focused values. */
  readonly getAll: (s: S) => ReadonlyArray<A>
  /** Fold all focused values using a combining function and initial value. */
  readonly fold: <R>(f: (acc: R, a: A) => R, initial: R) => (s: S) => R
  /** Compose with any read-capable optic → Fold. */
  compose<B>(that: Fold<A, B>): Fold<S, B>
  compose<B>(that: Getter<A, B>): Fold<S, B>
  compose<B>(that: Lens<A, B>): Fold<S, B>
  compose<B>(that: Prism<A, B>): Fold<S, B>
  compose<B>(that: Affine<A, B>): Fold<S, B>
  compose<B>(that: Traversal<A, B>): Fold<S, B>
}

// ---------------------------------------------------------------------------
// Setter — write-only optic
// ---------------------------------------------------------------------------

/** Setter: write-only modification. Like a Traversal without getAll. */
export interface Setter<S, A> {
  /** Transform the focused value(s). */
  readonly modify: (f: (a: A) => A) => (s: S) => S
  /** Replace the focused value(s). */
  readonly set: (a: A) => (s: S) => S
  /** Compose with any write-capable optic → Setter. */
  compose<B>(that: Setter<A, B>): Setter<S, B>
  compose<B>(that: Lens<A, B>): Setter<S, B>
  compose<B>(that: Iso<A, B>): Setter<S, B>
  compose<B>(that: Prism<A, B>): Setter<S, B>
  compose<B>(that: Affine<A, B>): Setter<S, B>
  compose<B>(that: Traversal<A, B>): Setter<S, B>
}

// ---------------------------------------------------------------------------
// Review — write-only construction (reverse of Getter)
// ---------------------------------------------------------------------------

/** Review: construct S from A. The write-only counterpart of Getter. */
export interface Review<S, A> {
  /** Construct an S from an A. */
  readonly review: (a: A) => S
  /** Compose with another Review. */
  compose<B>(that: Review<A, B>): Review<S, B>
  /** Compose with a Prism (review part only). */
  compose<B>(that: Prism<A, B>): Review<S, B>
  /** Compose with an Iso. */
  compose<B>(that: Iso<A, B>): Review<S, B>
}

// ---------------------------------------------------------------------------
// Runtime implementation — single class for all optic types
// ---------------------------------------------------------------------------

const enum OpticTag { Lens, Prism }

class OpticImpl<F extends OpticTypeLambda, S, A> {
  /** Phantom — structural discrimination via the type lambda. */
  declare readonly _F?: F

  readonly getDelta?: (parentDelta: unknown) => unknown | undefined

  constructor(
    readonly tag: OpticTag,
    readonly getOptic: (s: S) => Either<A, Error>,
    readonly setOptic: (a: A) => (s: S) => Either<S, Error>,
    getDelta?: (parentDelta: unknown) => unknown | undefined,
  ) {
    if (getDelta) this.getDelta = getDelta
  }

  // -- Lens/Iso convenience methods --

  get(s: S): A {
    const r = this.getOptic(s)
    if (!isRight(r)) throw new Error("get called on a Prism/Affine that failed — use preview instead")
    return r.right
  }

  set(a: A, s: S): S {
    const r = this.setOptic(a)(s)
    if (!isRight(r)) return s
    return r.right
  }

  from(s: S): A { return this.get(s) }

  to(a: A): S {
    const r = this.setOptic(a)(undefined as S)
    if (!isRight(r)) throw new Error("to/review failed")
    return r.right
  }

  toUpdate(): (s: S) => A { return (s) => this.get(s) }

  // -- Prism/Affine convenience methods --

  preview(s: S): A | null {
    const r = this.getOptic(s)
    return isRight(r) ? r.right : null
  }

  review(a: A): S { return this.to(a) }

  composeLens<B>(l: Lens<A, B>) {
    return this.compose(l)
  }

  // -- Core operations --

  modify(f: (a: A) => A): (s: S) => S {
    return (s: S): S => {
      const got = this.getOptic(s)
      if (!isRight(got)) return s
      const r = this.setOptic(f(got.right))(s)
      if (!isRight(r)) return s
      return r.right
    }
  }

  // -- Composition --

  compose<B>(that: Traversal<A, B>): Traversal<S, B>
  compose<B>(that: Getter<A, B>): ComposeWithGetter<F, S, B>
  compose<B>(that: Fold<A, B>): Fold<S, B>
  compose<B>(that: Setter<A, B>): Setter<S, B>
  compose<G extends OpticTypeLambda, B>(that: OpticBase<G, A, B>): Kind<ComposeOptics<F, G>, S, B>
  compose(
    that: Traversal<A, unknown> | Getter<A, unknown> | Fold<A, unknown> | Setter<A, unknown> | OpticBase<OpticTypeLambda, A, unknown>
  ): unknown {
    // Detect Getter: has _tag === "Getter"
    if (_isGetter(that)) {
      const thatGet = that.get
      const selfGet = this.getOptic
      // If this optic has total get (Iso/Lens → tag Prism for Iso, Lens for Lens),
      // the result is a Getter. Otherwise Fold.
      // We return a GetterImpl which satisfies both Getter and Fold.
      const composedGet = (s: S) => {
        const got = selfGet(s)
        if (!isRight(got)) return null
        return thatGet(got.right)
      }
      // Check if this optic always succeeds on get (Iso or Lens)
      // Iso: tag=Prism, but has total get. Lens: tag=Lens, total get.
      // Prism: tag=Prism, partial get. Affine: tag=Lens, partial get.
      // We can't distinguish Iso from Prism by tag alone, so we always
      // return a GetterImpl (satisfies both Getter and Fold) — the type
      // overloads handle the distinction.
      return _buildGetter<S, unknown>((s: S) => {
        const got = selfGet(s)
        if (!isRight(got)) throw new Error("Getter.get failed — composed with partial optic")
        return thatGet(got.right)
      }, (s: S) => {
        const got = selfGet(s)
        if (!isRight(got)) return []
        return [thatGet(got.right)]
      })
    }

    // Detect Fold: has _tag === "Fold"
    if (_isFold(that)) {
      const thatGetAll = that.getAll
      const selfGet = this.getOptic
      return _buildFold<S, unknown>((s: S) => {
        const got = selfGet(s)
        if (!isRight(got)) return []
        return thatGetAll(got.right)
      })
    }

    // Detect Setter: has _tag === "Setter"
    if (_isSetter(that)) {
      const thatModify = that.modify
      const selfGet = this.getOptic
      const selfSet = this.setOptic
      return _buildSetter<S, unknown>((f: (b: unknown) => unknown) => (s: S) => {
        const got = selfGet(s)
        if (!isRight(got)) return s
        const modified = thatModify(f)(got.right)
        const r = selfSet(modified as A)(s)
        return isRight(r) ? r.right : s
      })
    }

    // Detect Traversal: has getAll/modifyAll but NOT getOptic
    if (
      that !== null &&
      typeof that === "object" &&
      "getAll" in that &&
      "modifyAll" in that &&
      !("getOptic" in that)
    ) {
      const trav = that as Traversal<A, unknown>
      const selfGet = this.getOptic
      const selfSet = this.setOptic
      return _buildTraversal<S, unknown>(
        (s: S) => {
          const got = selfGet(s)
          if (!isRight(got)) return []
          return trav.getAll(got.right)
        },
        (f: (b: unknown) => unknown) => (s: S) => {
          const got = selfGet(s)
          if (!isRight(got)) return s
          const modified = trav.modifyAll(f as (a: unknown) => unknown)(got.right)
          const r = selfSet(modified as A)(s)
          return isRight(r) ? r.right : s
        },
      )
    }

    // Single-target optic composition
    const other = that as OpticBase<OpticTypeLambda, A, unknown>
    const otherImpl = other as OpticImpl<OpticTypeLambda, A, unknown>
    const selfGet = this.getOptic
    const selfSet = this.setOptic
    const selfGetDelta = this.getDelta
    const otherGet = other.getOptic
    const otherSet = other.setOptic
    const otherGetDelta = other.getDelta

    const composedGetDelta =
      selfGetDelta && otherGetDelta
        ? (parentDelta: unknown) => {
            const mid = selfGetDelta(parentDelta)
            return mid !== undefined ? otherGetDelta(mid) : undefined
          }
        : selfGetDelta && !otherGetDelta
          ? selfGetDelta
          : undefined

    // Lens/Affine need the whole for set (tag=Lens), Iso/Prism don't (tag=Prism)
    const resultTag = (this.tag === OpticTag.Lens || otherImpl.tag === OpticTag.Lens)
      ? OpticTag.Lens
      : OpticTag.Prism

    if (resultTag === OpticTag.Lens) {
      return new OpticImpl<OpticTypeLambda, S, unknown>(
        OpticTag.Lens,
        (s: S): Either<unknown, Error> => {
          const outer = selfGet(s)
          if (!isRight(outer)) return outer
          return otherGet(outer.right)
        },
        (b: unknown) => (s: S): Either<S, Error> => {
          const outer = selfGet(s)
          if (!isRight(outer)) return LEFT_ABSENT
          const innerSet = otherSet(b)(outer.right)
          if (!isRight(innerSet)) return innerSet
          return selfSet(innerSet.right)(s)
        },
        composedGetDelta,
      )
    } else {
      return new OpticImpl<OpticTypeLambda, S, unknown>(
        OpticTag.Prism,
        (s: S): Either<unknown, Error> => {
          const outer = selfGet(s)
          if (!isRight(outer)) return outer
          return otherGet(outer.right)
        },
        (b: unknown) => (_s: S): Either<S, Error> => {
          const innerSet = otherSet(b)(undefined as A)
          if (!isRight(innerSet)) return innerSet
          return selfSet(innerSet.right)(undefined as S)
        },
        composedGetDelta,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Constructor functions
// ---------------------------------------------------------------------------

/**
 * Construct an Iso (isomorphism).
 *
 * Laws:
 *   to(from(s)) === s
 *   from(to(a)) === a
 */
export function isoOf<S, A>(from: (s: S) => A, to: (a: A) => S): Iso<S, A> {
  return new OpticImpl<IsoTypeLambda, S, A>(
    OpticTag.Prism, // Iso uses prism composition (set doesn't need whole)
    (s: S) => right(from(s)),
    (a: A) => (_s: S) => right(to(a)),
  )
}

/**
 * Construct a Lens.
 *
 * Laws:
 *   get(set(a, s)) === a
 *   set(get(s), s) === s
 *   set(b, set(a, s)) === set(b, s)
 */
export function lensOf<S, A>(
  get: (s: S) => A,
  set: (a: A, s: S) => S,
  getDelta?: (parentDelta: unknown) => unknown | undefined,
): Lens<S, A> {
  return new OpticImpl<LensTypeLambda, S, A>(
    OpticTag.Lens,
    (s: S) => right(get(s)),
    (a: A) => (s: S) => right(set(a, s)),
    getDelta,
  )
}

/**
 * Construct a Prism.
 *
 * Laws:
 *   preview(review(a)) === a
 */
export function prismOf<S, A>(
  preview: (s: S) => A | null,
  review: (a: A) => S,
  getDelta?: (parentDelta: unknown) => unknown | undefined,
): Prism<S, A> {
  return new OpticImpl<PrismTypeLambda, S, A>(
    OpticTag.Prism,
    (s: S): Either<A, Error> => {
      const a = preview(s)
      return a !== null ? right(a) : LEFT_ABSENT
    },
    (a: A) => (_s: S) => right(review(a)),
    getDelta,
  )
}

/**
 * Construct an Affine/Optional optic.
 *
 * Partial get + whole-dependent set.
 */
export function affineOf<S, A>(
  preview: (s: S) => A | null,
  set: (a: A, s: S) => S,
  getDelta?: (parentDelta: unknown) => unknown | undefined,
): Affine<S, A> {
  return new OpticImpl<AffineTypeLambda, S, A>(
    OpticTag.Lens, // Affine uses lens composition (set needs whole)
    (s: S): Either<A, Error> => {
      const a = preview(s)
      return a !== null ? right(a) : LEFT_ABSENT
    },
    (a: A) => (s: S) => right(set(a, s)),
    getDelta,
  )
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases
// ---------------------------------------------------------------------------

/**
 * Construct a Lens. Backward-compatible alias for `lensOf`.
 */
export function lens<S, A>(
  get: (s: S) => A,
  set: (a: A, s: S) => S,
  getDelta?: (parentDelta: unknown) => unknown | undefined,
): Lens<S, A> {
  return lensOf(get, set, getDelta)
}

/**
 * Construct a Prism. Backward-compatible alias for `prismOf`.
 */
export function prism<S, A>(
  preview: (s: S) => A | null,
  review: (a: A) => S,
  getDelta?: (parentDelta: unknown) => unknown | undefined,
): Prism<S, A> {
  return prismOf(preview, review, getDelta)
}

/**
 * Construct an Iso. Backward-compatible alias for `isoOf`.
 */
export function iso<S, A>(from: (s: S) => A, to: (a: A) => S): Iso<S, A> {
  return isoOf(from, to)
}

// ---------------------------------------------------------------------------
// Getter / Fold / Setter / Review constructors
// ---------------------------------------------------------------------------

/** Construct a Getter from a total get function. */
export function getterOf<S, A>(get: (s: S) => A): Getter<S, A> {
  return _buildGetter<S, A>(get, (s: S) => [get(s)])
}

/** Construct a Fold from a getAll function. */
export function foldOf<S, A>(getAll: (s: S) => ReadonlyArray<A>): Fold<S, A> {
  return _buildFold<S, A>(getAll)
}

/** Construct a Setter from a modify function. */
export function setterOf<S, A>(modify: (f: (a: A) => A) => (s: S) => S): Setter<S, A> {
  return _buildSetter<S, A>(modify)
}

/** Construct a Review from a construction function. */
export function reviewOf<S, A>(review: (a: A) => S): Review<S, A> {
  return _buildReview<S, A>(review)
}

// ---------------------------------------------------------------------------
// Conversion functions — extract read/write components from existing optics
// ---------------------------------------------------------------------------

/** Extract the read-only Getter from a Lens or Iso. */
export function toGetter<S, A>(optic: Lens<S, A> | Iso<S, A>): Getter<S, A> {
  return _buildGetter<S, A>((s: S) => optic.get(s), (s: S) => [optic.get(s)])
}

/** Extract a read-only Fold from a Traversal, Prism, or Affine. */
export function toFold<S, A>(optic: Traversal<S, A> | Prism<S, A> | Affine<S, A>): Fold<S, A> {
  if ("getAll" in optic) {
    return _buildFold<S, A>((optic as Traversal<S, A>).getAll)
  }
  // Prism or Affine — use preview
  return _buildFold<S, A>((s: S) => {
    const a = (optic as Prism<S, A> | Affine<S, A>).preview(s)
    return a !== null ? [a] : []
  })
}

/** Extract a write-only Setter from a Lens, Traversal, or any optic with modify. */
export function toSetter<S, A>(optic: Lens<S, A> | Iso<S, A> | Prism<S, A> | Affine<S, A> | Traversal<S, A>): Setter<S, A> {
  if ("modifyAll" in optic) {
    return _buildSetter<S, A>((optic as Traversal<S, A>).modifyAll)
  }
  // Bind modify to the optic instance so it has correct `this`
  const bound = (optic as OpticBase<OpticTypeLambda, S, A>).modify.bind(optic)
  return _buildSetter<S, A>(bound)
}

/** Extract a Review from a Prism or Iso. */
export function toReview<S, A>(optic: Prism<S, A> | Iso<S, A>): Review<S, A> {
  // Both Prism and Iso have review/to on the impl, but they're prototype methods
  // that need `this`. Use preview's partner: for Prism, review builds S from A
  // via setOptic(a)(undefined). Bind to preserve `this`.
  if ("review" in optic) {
    const bound = (optic as Prism<S, A>).review.bind(optic)
    return _buildReview<S, A>(bound)
  }
  const bound = (optic as Iso<S, A>).to.bind(optic)
  return _buildReview<S, A>(bound)
}

// ---------------------------------------------------------------------------
// Record lens helpers
// ---------------------------------------------------------------------------

/**
 * Derive a lens for a specific key of a record type.
 *
 * Usage:
 *   const nameLens = prop<User>()("name")
 *   //    ^ Lens<User, string>
 */
export function prop<S>(): <K extends keyof S>(key: K) => Lens<S, S[K]> {
  return <K extends keyof S>(key: K): Lens<S, S[K]> =>
    lensOf<S, S[K]>(
      (s: S) => s[key],
      (a: S[K], s: S) => {
        const result = { ...s }
        result[key] = a
        return result
      },
      (parentDelta: unknown): unknown | undefined => {
        if (
          parentDelta != null &&
          typeof parentDelta === "object" &&
          "kind" in parentDelta
        ) {
          const d = parentDelta as { kind: string; value?: unknown; fields?: Record<string, unknown> }
          if (d.kind === "noop") return undefined
          if (d.kind === "replace" && d.value != null && typeof d.value === "object") {
            return { kind: "replace", value: (d.value as Record<string, unknown>)[key as string] }
          }
          if (d.kind === "fields" && d.fields != null) {
            return d.fields[key as string]
          }
        }
        return undefined
      }
    )
}

/**
 * Compose multiple lenses in sequence.
 *
 * Usage:
 *   const streetLens = composeLenses(
 *     prop<User>()("address"),
 *     prop<Address>()("street")
 *   )
 *   //    ^ Lens<User, string>
 */
export function composeLenses<A, B, C>(
  ab: Lens<A, B>,
  bc: Lens<B, C>
): Lens<A, C>
export function composeLenses<A, B, C, D>(
  ab: Lens<A, B>,
  bc: Lens<B, C>,
  cd: Lens<C, D>
): Lens<A, D>
export function composeLenses<A, B, C, D, E>(
  ab: Lens<A, B>,
  bc: Lens<B, C>,
  cd: Lens<C, D>,
  de: Lens<D, E>
): Lens<A, E>
export function composeLenses(...lenses: Array<Lens<unknown, unknown>>): Lens<unknown, unknown> {
  return lenses.reduce(
    (acc, l) => acc.compose(l)
  )
}

// ---------------------------------------------------------------------------
// Path selectors
// ---------------------------------------------------------------------------

/**
 * Build a composed lens from a chain of property keys.
 *
 * Usage:
 *   const nameLens = at<AppModel>()("user", "profile", "name")
 *   // Lens<AppModel, string>
 */
export function at<S>(): {
  <K1 extends keyof S>(k1: K1): Lens<S, S[K1]>
  <K1 extends keyof S, K2 extends keyof S[K1]>(
    k1: K1, k2: K2
  ): Lens<S, S[K1][K2]>
  <K1 extends keyof S, K2 extends keyof S[K1], K3 extends keyof S[K1][K2]>(
    k1: K1, k2: K2, k3: K3
  ): Lens<S, S[K1][K2][K3]>
  <K1 extends keyof S, K2 extends keyof S[K1], K3 extends keyof S[K1][K2], K4 extends keyof S[K1][K2][K3]>(
    k1: K1, k2: K2, k3: K3, k4: K4
  ): Lens<S, S[K1][K2][K3][K4]>
  <K1 extends keyof S, K2 extends keyof S[K1], K3 extends keyof S[K1][K2], K4 extends keyof S[K1][K2][K3], K5 extends keyof S[K1][K2][K3][K4]>(
    k1: K1, k2: K2, k3: K3, k4: K4, k5: K5
  ): Lens<S, S[K1][K2][K3][K4][K5]>
  <K1 extends keyof S, K2 extends keyof S[K1], K3 extends keyof S[K1][K2], K4 extends keyof S[K1][K2][K3], K5 extends keyof S[K1][K2][K3][K4], K6 extends keyof S[K1][K2][K3][K4][K5]>(
    k1: K1, k2: K2, k3: K3, k4: K4, k5: K5, k6: K6
  ): Lens<S, S[K1][K2][K3][K4][K5][K6]>
} {
  // Variance: Lens is invariant in S, so prop<Record<string, unknown>>() lenses
  // can't compose directly (source/target mismatch). We use Lens<unknown, unknown>
  // as a uniform accumulator. The overload signatures above provide full type safety.
  const anyProp = (key: string): Lens<unknown, unknown> =>
    lensOf<unknown, unknown>(
      (s) => (s as Record<string, unknown>)[key],
      (a, s) => ({ ...(s as Record<string, unknown>), [key]: a }),
      (parentDelta: unknown): unknown | undefined => {
        if (parentDelta != null && typeof parentDelta === "object" && "kind" in parentDelta) {
          const d = parentDelta as { kind: string; value?: unknown; fields?: Record<string, unknown> }
          if (d.kind === "noop") return undefined
          if (d.kind === "replace" && d.value != null && typeof d.value === "object") {
            return { kind: "replace", value: (d.value as Record<string, unknown>)[key] }
          }
          if (d.kind === "fields" && d.fields != null) {
            return d.fields[key]
          }
        }
        return undefined
      },
    )
  return ((...keys: string[]) => {
    if (keys.length === 0) throw new Error("at() requires at least one key")
    let result = anyProp(keys[0]!)
    for (let i = 1; i < keys.length; i++) {
      result = result.compose(anyProp(keys[i]!))
    }
    return result
  }) as ReturnType<typeof at<S>>
}

// ---------------------------------------------------------------------------
// Prism constructors
// ---------------------------------------------------------------------------

/**
 * Prism for a discriminated union member.
 *
 * Usage:
 *   type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number; h: number }
 *   const circlePrism = unionMember<Shape, { kind: "circle"; r: number }>(
 *     s => s.kind === "circle" ? s : null
 *   )
 */
export function unionMember<S, A extends S>(
  predicate: (s: S) => s is A
): Prism<S, A> {
  return prismOf(
    (s: S) => (predicate(s) ? s : null),
    (a: A) => a as S
  )
}

/**
 * Affine for a nullable field.
 *
 * Returns Affine (not Prism) because review would need a full S context
 * that we don't have — Affine's set takes the whole S.
 *
 *   nullablePrism<{ name: string | null }>()("name")
 */
export function nullablePrism<S>(): <K extends keyof S>(
  key: K
) => Affine<S, NonNullable<S[K]>> {
  return <K extends keyof S>(key: K) =>
    affineOf<S, NonNullable<S[K]>>(
      (s: S) => (s[key] != null ? (s[key] as NonNullable<S[K]>) : null),
      (a: NonNullable<S[K]>, s: S) => {
        const result = { ...s }
        result[key] = a as S[K]
        return result
      },
      (parentDelta: unknown): unknown | undefined => {
        if (parentDelta != null && typeof parentDelta === "object" && "kind" in parentDelta) {
          const d = parentDelta as { kind: string; value?: unknown; fields?: Record<string, unknown> }
          if (d.kind === "noop") return undefined
          if (d.kind === "replace" && d.value != null && typeof d.value === "object") {
            return { kind: "replace", value: (d.value as Record<string, unknown>)[key as string] }
          }
          if (d.kind === "fields" && d.fields != null) {
            return d.fields[key as string]
          }
        }
        return undefined
      }
    )
}

// ---------------------------------------------------------------------------
// Index lens — for array elements
// ---------------------------------------------------------------------------

/**
 * Lens that focuses on a specific index of a readonly array.
 * Throws if the index is out of bounds — use only when you know the index exists.
 */
export function indexLens<A>(index: number): Lens<ReadonlyArray<A>, A> {
  return lensOf<ReadonlyArray<A>, A>(
    (arr: ReadonlyArray<A>): A => {
      const v: A | undefined = arr[index]
      if (v === undefined) throw new RangeError(`indexLens: index ${index} out of bounds`)
      return v
    },
    (a: A, arr: ReadonlyArray<A>): ReadonlyArray<A> => {
      const copy = Array.from(arr)
      ;(copy as unknown[])[index] = a
      return copy as A[]
    }
  )
}

// ---------------------------------------------------------------------------
// Traversal constructors
// ---------------------------------------------------------------------------

/**
 * Construct a Traversal from getAll and modifyAll functions.
 */
export function traversal<S, A>(
  getAll: (s: S) => ReadonlyArray<A>,
  modifyAll: (f: (a: A) => A) => (s: S) => S,
): Traversal<S, A> {
  return _buildTraversal(getAll, modifyAll)
}

/**
 * Traversal that focuses on every element of an array.
 *
 * Usage:
 *   const allNames = prop<Model>()("users").compose(each<User>()).compose(prop<User>()("name"))
 *   allNames.getAll(model) // ["Alice", "Bob", ...]
 *   allNames.modifyAll(s => s.toUpperCase())(model) // uppercases all names
 */
export function each<A>(): Traversal<ReadonlyArray<A>, A> {
  return _buildTraversal<ReadonlyArray<A>, A>(
    (arr) => arr,
    (f) => (arr) => {
      let changed = false
      const result = arr.map(a => {
        const b = f(a)
        if (b !== a) changed = true
        return b
      })
      return changed ? result : arr
    },
  )
}

/**
 * Traversal that focuses on values of a Record/object.
 *
 * Usage:
 *   const allValues = values<number>()
 *   allValues.getAll({ a: 1, b: 2 }) // [1, 2]
 */
export function values<A>(): Traversal<Readonly<Record<string, A>>, A> {
  return _buildTraversal<Readonly<Record<string, A>>, A>(
    (obj) => Object.values(obj),
    (f) => (obj) => {
      let changed = false
      const result: Record<string, A> = {}
      for (const k of Object.keys(obj)) {
        const v = obj[k]!
        const b = f(v)
        if (b !== v) changed = true
        result[k] = b
      }
      return changed ? result : obj
    },
  )
}

/**
 * Traversal that filters elements by a predicate.
 *
 * Usage:
 *   const adults = each<User>().compose(filtered<User>(u => u.age >= 18))
 */
export function filtered<A>(predicate: (a: A) => boolean): Traversal<A, A> {
  return _buildTraversal<A, A>(
    (a) => predicate(a) ? [a] : [],
    (f) => (a) => predicate(a) ? f(a) : a,
  )
}

// ---------------------------------------------------------------------------
// Internal Traversal builder
// ---------------------------------------------------------------------------

function _buildTraversal<S, A>(
  getAll: (s: S) => ReadonlyArray<A>,
  modifyAll: (f: (a: A) => A) => (s: S) => S,
): Traversal<S, A> {
  const t = {
    getAll,
    modifyAll,
    fold<R>(f: (acc: R, a: A) => R, initial: R) {
      return (s: S) => {
        let acc = initial
        for (const a of getAll(s)) acc = f(acc, a)
        return acc
      }
    },
    compose(
      that: Traversal<A, unknown> | Getter<A, unknown> | Fold<A, unknown> | Setter<A, unknown> | OpticBase<OpticTypeLambda, A, unknown>
    ): unknown {
      // Traversal + Getter → Fold
      if (_isGetter(that)) {
        const thatGet = that.get
        return _buildFold<S, unknown>((s: S) => {
          const result: unknown[] = []
          for (const a of getAll(s)) result.push(thatGet(a))
          return result
        })
      }

      // Traversal + Fold → Fold
      if (_isFold(that)) {
        const thatGetAll = that.getAll
        return _buildFold<S, unknown>((s: S) => {
          const result: unknown[] = []
          for (const a of getAll(s)) {
            for (const b of thatGetAll(a)) result.push(b)
          }
          return result
        })
      }

      // Traversal + Setter → Setter
      if (_isSetter(that)) {
        const thatModify = that.modify
        return _buildSetter<S, unknown>((f: (b: unknown) => unknown) =>
          modifyAll((a: A): A => thatModify(f)(a) as A)
        )
      }

      // Traversal + Traversal (has getAll/modifyAll)
      if ("getAll" in that && "modifyAll" in that) {
        const thatT = that as Traversal<A, unknown>
        return _buildTraversal<S, unknown>(
          (s: S) => {
            const result: unknown[] = []
            for (const a of getAll(s)) {
              for (const b of thatT.getAll(a)) result.push(b)
            }
            return result
          },
          (f: (b: unknown) => unknown) => modifyAll((a: A): A =>
            thatT.modifyAll(f as (a: unknown) => unknown)(a) as A
          ),
        )
      }
      // Traversal + single-target optic (Lens/Prism/Affine/Iso)
      const optic = that as OpticBase<OpticTypeLambda, A, unknown>
      const otherGet = optic.getOptic
      const otherSet = optic.setOptic
      return _buildTraversal<S, unknown>(
        (s: S) => {
          const result: unknown[] = []
          for (const a of getAll(s)) {
            const got = otherGet(a)
            if (isRight(got)) result.push(got.right)
          }
          return result
        },
        (f: (b: unknown) => unknown) => modifyAll((a: A): A => {
          const got = otherGet(a)
          if (!isRight(got)) return a
          const setResult = otherSet(f(got.right))(a)
          return isRight(setResult) ? setResult.right : a
        }),
      )
    },
  }
  return t as unknown as Traversal<S, A>
}

// ---------------------------------------------------------------------------
// Type guards for new optic types
// ---------------------------------------------------------------------------

const _GETTER = Symbol.for("static-dom.optic.getter")
const _FOLD = Symbol.for("static-dom.optic.fold")
const _SETTER = Symbol.for("static-dom.optic.setter")
const _REVIEW = Symbol.for("static-dom.optic.review")

function _isGetter(x: unknown): x is Getter<unknown, unknown> {
  return x !== null && typeof x === "object" && _GETTER in (x as object)
}

function _isFold(x: unknown): x is Fold<unknown, unknown> {
  return x !== null && typeof x === "object" && (_FOLD in (x as object) || _GETTER in (x as object))
}

function _isSetter(x: unknown): x is Setter<unknown, unknown> {
  return x !== null && typeof x === "object" && _SETTER in (x as object)
}

function _isReview(x: unknown): x is Review<unknown, unknown> {
  return x !== null && typeof x === "object" && _REVIEW in (x as object)
}

// ---------------------------------------------------------------------------
// Internal builders for new optic types
// ---------------------------------------------------------------------------

function _buildGetter<S, A>(
  getFn: (s: S) => A,
  getAllFn: (s: S) => ReadonlyArray<A>,
): Getter<S, A> {
  const g = {
    [_GETTER]: true,
    get: getFn,
    getAll: getAllFn,
    fold<R>(f: (acc: R, a: A) => R, initial: R) {
      return (s: S) => f(initial, getFn(s))
    },
    compose(that: unknown): unknown {
      if (_isGetter(that)) {
        const thatGet = that.get
        return _buildGetter<S, unknown>(
          (s: S) => thatGet(getFn(s)),
          (s: S) => [thatGet(getFn(s))],
        )
      }
      if (_isFold(that)) {
        const thatGetAll = that.getAll
        return _buildFold<S, unknown>((s: S) => thatGetAll(getFn(s)))
      }
      // Getter + OpticBase or Traversal
      if ("getAll" in (that as object) && "modifyAll" in (that as object)) {
        // Getter + Traversal → Fold
        const trav = that as Traversal<A, unknown>
        return _buildFold<S, unknown>((s: S) => trav.getAll(getFn(s)))
      }
      if ("getOptic" in (that as object)) {
        // Getter + OpticBase (Lens/Prism/Affine/Iso)
        const optic = that as OpticBase<OpticTypeLambda, A, unknown>
        const otherGet = optic.getOptic
        // If it always succeeds (Lens/Iso), result is Getter. If partial, Fold.
        // At runtime, return a Getter that also satisfies Fold — type overloads narrow.
        return _buildGetter<S, unknown>(
          (s: S) => {
            const got = otherGet(getFn(s))
            if (!isRight(got)) throw new Error("Getter.get failed — composed with partial optic")
            return got.right
          },
          (s: S) => {
            const got = otherGet(getFn(s))
            return isRight(got) ? [got.right] : []
          },
        )
      }
      throw new Error("Getter.compose: unsupported operand")
    },
  }
  return g as unknown as Getter<S, A>
}

function _buildFold<S, A>(
  getAllFn: (s: S) => ReadonlyArray<A>,
): Fold<S, A> {
  const f = {
    [_FOLD]: true,
    getAll: getAllFn,
    fold<R>(fn: (acc: R, a: A) => R, initial: R) {
      return (s: S) => {
        let acc = initial
        for (const a of getAllFn(s)) acc = fn(acc, a)
        return acc
      }
    },
    compose(that: unknown): unknown {
      if (_isGetter(that)) {
        const thatGet = that.get
        return _buildFold<S, unknown>((s: S) => {
          const result: unknown[] = []
          for (const a of getAllFn(s)) result.push(thatGet(a))
          return result
        })
      }
      if (_isFold(that)) {
        const thatGetAll = that.getAll
        return _buildFold<S, unknown>((s: S) => {
          const result: unknown[] = []
          for (const a of getAllFn(s)) {
            for (const b of thatGetAll(a)) result.push(b)
          }
          return result
        })
      }
      if ("getAll" in (that as object)) {
        // Fold + Traversal → Fold
        const trav = that as Traversal<A, unknown>
        return _buildFold<S, unknown>((s: S) => {
          const result: unknown[] = []
          for (const a of getAllFn(s)) {
            for (const b of trav.getAll(a)) result.push(b)
          }
          return result
        })
      }
      if ("getOptic" in (that as object)) {
        // Fold + OpticBase → Fold
        const optic = that as OpticBase<OpticTypeLambda, A, unknown>
        const otherGet = optic.getOptic
        return _buildFold<S, unknown>((s: S) => {
          const result: unknown[] = []
          for (const a of getAllFn(s)) {
            const got = otherGet(a)
            if (isRight(got)) result.push(got.right)
          }
          return result
        })
      }
      throw new Error("Fold.compose: unsupported operand")
    },
  }
  return f as unknown as Fold<S, A>
}

function _buildSetter<S, A>(
  modifyFn: (f: (a: A) => A) => (s: S) => S,
): Setter<S, A> {
  const st = {
    [_SETTER]: true,
    modify: modifyFn,
    set(a: A): (s: S) => S { return modifyFn(() => a) },
    compose(that: unknown): unknown {
      if (_isSetter(that)) {
        const thatModify = that.modify
        return _buildSetter<S, unknown>((f: (b: unknown) => unknown) =>
          modifyFn((a: A): A => thatModify(f)(a) as A)
        )
      }
      if ("getAll" in (that as object) && "modifyAll" in (that as object)) {
        // Setter + Traversal → Setter
        const trav = that as Traversal<A, unknown>
        return _buildSetter<S, unknown>((f: (b: unknown) => unknown) =>
          modifyFn((a: A): A => trav.modifyAll(f as (a: unknown) => unknown)(a) as A)
        )
      }
      if ("getOptic" in (that as object)) {
        // Setter + OpticBase → Setter
        const optic = that as OpticBase<OpticTypeLambda, A, unknown>
        const otherGet = optic.getOptic
        const otherSet = optic.setOptic
        return _buildSetter<S, unknown>((f: (b: unknown) => unknown) =>
          modifyFn((a: A): A => {
            const got = otherGet(a)
            if (!isRight(got)) return a
            const setResult = otherSet(f(got.right))(a)
            return (isRight(setResult) ? setResult.right : a) as A
          })
        )
      }
      throw new Error("Setter.compose: unsupported operand")
    },
  }
  return st as unknown as Setter<S, A>
}

function _buildReview<S, A>(
  reviewFn: (a: A) => S,
): Review<S, A> {
  const r = {
    [_REVIEW]: true,
    review: reviewFn,
    compose(that: unknown): unknown {
      if (_isReview(that)) {
        const thatReview = that.review
        return _buildReview<S, unknown>((b: unknown) => reviewFn(thatReview(b) as A))
      }
      if ("getOptic" in (that as object)) {
        // Review + Iso/Prism (ones that have review/to)
        const optic = that as OpticBase<OpticTypeLambda, A, unknown>
        const otherSet = optic.setOptic
        return _buildReview<S, unknown>((b: unknown) => {
          const inner = otherSet(b)(undefined as A)
          if (!isRight(inner)) throw new Error("Review.compose failed")
          return reviewFn(inner.right)
        })
      }
      throw new Error("Review.compose: unsupported operand")
    },
  }
  return r as unknown as Review<S, A>
}
