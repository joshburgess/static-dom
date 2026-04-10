/**
 * optics.ts
 *
 * Unified optics using structural subtyping, inspired by @fp-ts/optic (ZIO Optics).
 *
 * A single `Optic` base type is parameterized so that Iso, Lens, Prism, and
 * Affine emerge as type aliases. Composition result types fall out automatically
 * from method overload resolution:
 *
 *   Iso   + Iso   = Iso
 *   Lens  + Lens  = Lens
 *   Prism + Prism = Prism
 *   Lens  + Prism = Affine   (via structural subtyping — both are subtypes of Affine)
 *   Prism + Lens  = Affine
 *
 * Subtyping lattice:
 *
 *          Iso
 *        /     \
 *     Lens     Prism
 *        \     /
 *        Affine
 *
 * See docs/OPTICS-REDESIGN.md for the full design rationale.
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

function left<E>(e: E): Either<never, E> {
  return { _tag: "Left", left: e }
}

function isRight<A, E>(e: Either<A, E>): e is { readonly _tag: "Right"; readonly right: A } {
  return e._tag === "Right"
}

// ---------------------------------------------------------------------------
// Optic — unified base type
//
// Type parameters:
//   GetWhole       — the type we read from
//   SetWholeBefore — the type we need to write back into (S for Lens/Affine, unknown for Iso/Prism)
//   SetPiece       — the type we write (usually A)
//   GetError       — error type for failed get (never for Iso/Lens, Error for Prism/Affine)
//   SetError       — error type for failed set (never for Iso/Lens/Prism, Error for Affine)
//   GetPiece       — the type we read out (usually A)
//   SetWholeAfter  — the whole type after setting (usually S)
// ---------------------------------------------------------------------------

export interface Optic<GetWhole, SetWholeBefore, SetPiece, GetError, SetError, GetPiece, SetWholeAfter> {
  readonly getOptic: (s: GetWhole) => Either<GetPiece, GetError>
  readonly setOptic: (a: SetPiece) => (s: SetWholeBefore) => Either<SetWholeAfter, SetError>

  // Composition overloads — most specific first.
  // TypeScript resolves to the most specific matching overload.
  // Because Iso <: Lens <: Affine and Iso <: Prism <: Affine,
  // composing Lens + Prism falls through to the Affine overload.
  compose<S2, A2>(this: Iso<GetWhole, GetPiece>, that: Iso<GetPiece, A2>): Iso<GetWhole, A2>
  compose<A2>(this: Lens<GetWhole, GetPiece>, that: Lens<GetPiece, A2>): Lens<GetWhole, A2>
  compose<A2>(this: Prism<GetWhole, GetPiece>, that: Prism<GetPiece, A2>): Prism<GetWhole, A2>
  compose<A2>(this: Affine<GetWhole, GetPiece>, that: Affine<GetPiece, A2>): Affine<GetWhole, A2>

  /** Transform the focus value in place. Works on all optic types. */
  modify(f: (a: GetPiece) => SetPiece): (s: GetWhole & SetWholeBefore) => SetWholeAfter

  /**
   * Extract the sub-delta for this optic's focus from a parent delta.
   * Returns `undefined` if the delta doesn't apply.
   * SDOM-specific: enables O(1) delta propagation through `focus`.
   */
  getDelta?: (parentDelta: unknown) => unknown | undefined
}

// ---------------------------------------------------------------------------
// Subtype aliases
//
// Each fixes specific type parameters of Optic to encode the capabilities:
//   - Iso:    total get, whole-independent set
//   - Lens:   total get, whole-dependent set
//   - Prism:  partial get (can fail), whole-independent set (has review)
//   - Affine: partial get (can fail), whole-dependent set
// ---------------------------------------------------------------------------

/** Isomorphism: total bidirectional conversion. */
export interface Iso<S, A>
  extends Optic<S, unknown, A, never, never, A, S> {
  readonly from: (s: S) => A
  readonly to: (a: A) => S
}

/** Lens: total get, whole-dependent set. */
export interface Lens<S, A>
  extends Optic<S, S, A, never, never, A, S> {
  /** Read the focused value. Always succeeds. */
  readonly get: (s: S) => A
  /** Write the focused value, returning a new whole. */
  readonly set: (a: A, s: S) => S
  /** Alias of `get` — convenience for mapUpdate usage. */
  readonly toUpdate: () => (s: S) => A
}

/** Prism: partial get, whole-independent set (has review). */
export interface Prism<S, A>
  extends Optic<S, unknown, A, Error, never, A, S> {
  /** Try to extract A. Returns null if not present. */
  readonly preview: (s: S) => A | null
  /** Embed A into S. */
  readonly review: (a: A) => S
  /** Compose with a Lens. Backward compat alias for compose(). */
  readonly composeLens: <B>(l: Lens<A, B>) => Affine<S, B>
}

/** Affine/Optional: partial get, whole-dependent set. */
export interface Affine<S, A>
  extends Optic<S, S, A, Error, Error, A, S> {
  /** Try to extract A. Returns null if not present. */
  readonly preview: (s: S) => A | null
  /** Write A back if the target exists. Returns S unchanged if target absent. */
  readonly set: (a: A, s: S) => S
}

// ---------------------------------------------------------------------------
// Builder — single runtime class for all optic types
// ---------------------------------------------------------------------------

const enum OpticTag { Lens, Prism }

class Builder<GW, SWB, SP, GE, SE, GP, SWA>
  implements Optic<GW, SWB, SP, GE, SE, GP, SWA>
{
  readonly getDelta?: (parentDelta: unknown) => unknown | undefined

  constructor(
    readonly tag: OpticTag,
    readonly getOptic: (s: GW) => Either<GP, GE>,
    readonly setOptic: (a: SP) => (s: SWB) => Either<SWA, SE>,
    getDelta?: (parentDelta: unknown) => unknown | undefined,
  ) {
    if (getDelta) this.getDelta = getDelta
  }

  compose(that: any): any {
    const self = this
    const composedGetDelta =
      self.getDelta && that.getDelta
        ? (parentDelta: unknown) => {
            const mid = self.getDelta!(parentDelta)
            return mid !== undefined ? that.getDelta!(mid) : undefined
          }
        : self.getDelta && !that.getDelta
          ? self.getDelta
          : undefined

    // Determine composition strategy:
    // "lens" composition: the inner set needs the intermediate value from outer get
    // "prism" composition: the inner set is independent of the whole
    const tag = self.tag === OpticTag.Lens || that.tag === OpticTag.Lens
      ? OpticTag.Lens
      : OpticTag.Prism

    if (tag === OpticTag.Lens) {
      return _build(
        OpticTag.Lens,
        (s: any) => {
          const outer = self.getOptic(s)
          if (!isRight(outer)) return outer
          return that.getOptic(outer.right)
        },
        (b: any) => (s: any) => {
          const outer = (self as Builder<any, any, any, any, any, any, any>).getOptic(s)
          if (!isRight(outer)) return left(new Error("Cannot set through failed get"))
          const innerSet = that.setOptic(b)(outer.right)
          if (!isRight(innerSet)) return innerSet
          return (self as Builder<any, any, any, any, any, any, any>).setOptic(innerSet.right)(s)
        },
        composedGetDelta,
      )
    } else {
      return _build(
        OpticTag.Prism,
        (s: any) => {
          const outer = (self as Builder<any, any, any, any, any, any, any>).getOptic(s)
          if (!isRight(outer)) return outer
          return that.getOptic(outer.right)
        },
        (b: any) => (_s: any) => {
          const innerSet = that.setOptic(b)(undefined as any)
          if (!isRight(innerSet)) return innerSet
          return (self as Builder<any, any, any, any, any, any, any>).setOptic(innerSet.right)(undefined as any)
        },
        composedGetDelta,
      )
    }
  }

  modify(f: (a: any) => any): (s: any) => any {
    return (s: any) => {
      const got = this.getOptic(s)
      if (!isRight(got)) return s // Prism/Affine: target absent, return unchanged
      const set = this.setOptic(f(got.right))(s)
      if (!isRight(set)) return s
      return set.right
    }
  }
}

// ---------------------------------------------------------------------------
// Internal builder helper — attaches convenience accessors
// ---------------------------------------------------------------------------

function _build(
  tag: OpticTag,
  getOptic: (s: any) => Either<any, any>,
  setOptic: (a: any) => (s: any) => Either<any, any>,
  getDeltaFn?: (parentDelta: unknown) => unknown | undefined,
): any {
  const b = new Builder(tag, getOptic, setOptic, getDeltaFn)
  // Attach convenience methods based on capabilities
  _attachGetSet(b)
  _attachPreviewReview(b, tag)
  _attachComposeLens(b)
  return b
}

/** Attach get/set for Lens-compatible optics (getOptic returns Right). */
function _attachGetSet(b: any): void {
  b.get = (s: any) => {
    const r = b.getOptic(s)
    if (!isRight(r)) throw new Error("get called on a Prism/Affine that failed — use preview instead")
    return r.right
  }
  b.set = (a: any, s: any) => {
    const r = b.setOptic(a)(s)
    if (!isRight(r)) return s
    return r.right
  }
  b.toUpdate = () => b.get
  // Iso aliases
  b.from = b.get
  b.to = (a: any) => {
    const r = b.setOptic(a)(undefined as any)
    if (!isRight(r)) throw new Error("to/review failed")
    return r.right
  }
}

/** Attach preview/review for Prism/Affine-compatible optics. */
function _attachPreviewReview(b: any, tag: OpticTag): void {
  b.preview = (s: any) => {
    const r = b.getOptic(s)
    return isRight(r) ? r.right : null
  }
  if (tag === OpticTag.Prism) {
    b.review = (a: any) => {
      const r = b.setOptic(a)(undefined as any)
      if (!isRight(r)) throw new Error("review failed")
      return r.right
    }
  }
}

/** Attach composeLens backward compat method. */
function _attachComposeLens(b: any): void {
  b.composeLens = function(this: any, l: any) {
    return this.compose(l)
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
  return _build(
    OpticTag.Prism, // Iso uses prism composition (set doesn't need whole)
    (s: S) => right(from(s)),
    (a: A) => (_s: unknown) => right(to(a)),
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
  return _build(
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
  return _build(
    OpticTag.Prism,
    (s: S) => {
      const a = preview(s)
      return a !== null ? right(a) : left(new Error("Prism: target not present"))
    },
    (a: A) => (_s: unknown) => right(review(a)),
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
  return _build(
    OpticTag.Lens, // Affine uses lens composition (set needs whole)
    (s: S) => {
      const a = preview(s)
      return a !== null ? right(a) : left(new Error("Affine: target not present"))
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
export function composeLenses(...lenses: Lens<any, any>[]): Lens<any, any> {
  return lenses.reduce((acc, l) => acc.compose(l) as Lens<any, any>)
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
  return (...keys: string[]): any => {
    if (keys.length === 0) throw new Error("at() requires at least one key")
    // Build a chain of prop lenses and compose them
    let result: any = prop<any>()(keys[0]!)
    for (let i = 1; i < keys.length; i++) {
      result = result.compose(prop<any>()(keys[i]!))
    }
    return result
  }
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
