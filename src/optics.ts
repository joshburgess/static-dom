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

/** Shared sentinel for "not present" — avoids allocating Error objects on every prism miss. */
const LEFT_ABSENT: Either<never, Error> = { _tag: "Left", left: new Error("absent") } as Either<never, Error>

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

/**
 * The fully general optic type, parameterized over get/set error types.
 * Specialized as Iso, Lens, Prism, Affine, and Traversal.
 */
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
  // Any optic composed with a Traversal yields a Traversal
  compose<A2>(that: Traversal<GetPiece, A2>): Traversal<GetWhole, A2>

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

/**
 * Traversal: focuses on zero or more targets within a whole.
 *
 * Unlike Iso/Lens/Prism/Affine, a Traversal is not modeled as getOptic/setOptic
 * since it targets multiple values. It has its own interface with:
 *   - getAll: extract all focused values
 *   - modifyAll: transform all focused values in place
 *   - foldMap: fold all focused values with a monoid
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

  // -- Lens/Iso convenience methods --

  get(s: GW): GP {
    const r = this.getOptic(s)
    if (!isRight(r)) throw new Error("get called on a Prism/Affine that failed — use preview instead")
    return r.right
  }

  set(a: SP, s: SWB): SWA {
    const r = this.setOptic(a)(s)
    // SAFETY: on failure, return whole unchanged. For Lens/Affine SWB≡SWA;
    // for Prism/Iso this branch is unreachable (setOptic always succeeds).
    if (!isRight(r)) return s as unknown as SWA
    return r.right
  }

  from(s: GW): GP { return this.get(s) }

  to(a: SP): SWA {
    // SAFETY: meaningful for Prism/Iso only, where SWB=unknown.
    // setOptic ignores the whole parameter for these types.
    const r = this.setOptic(a)(undefined as SWB)
    if (!isRight(r)) throw new Error("to/review failed")
    return r.right
  }

  toUpdate(): (s: GW) => GP { return (s) => this.get(s) }

  // -- Prism/Affine convenience methods --

  preview(s: GW): GP | null {
    const r = this.getOptic(s)
    return isRight(r) ? r.right : null
  }

  review(a: SP): SWA { return this.to(a) }

  composeLens<B>(l: Lens<GP, B>): Affine<GW, B> {
    return this.compose(l)
  }

  // -- Core operations --

  modify(f: (a: GP) => SP): (s: GW & SWB) => SWA {
    return (s: GW & SWB): SWA => {
      const got = this.getOptic(s)
      // SAFETY: target absent → return whole unchanged (same reasoning as set())
      if (!isRight(got)) return s as unknown as SWA
      const r = this.setOptic(f(got.right))(s)
      if (!isRight(r)) return s as unknown as SWA
      return r.right
    }
  }

  // -- Composition --
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required: TypeScript overloaded method implementations need `any` for variance compatibility
  compose(that: any): any {
    // Type-erase self once for composition internals.
    // Overload signatures on the Optic interface provide full type safety to callers.
    const selfGet = this.getOptic as (s: unknown) => Either<unknown, unknown>
    const selfSet = this.setOptic as (a: unknown) => (s: unknown) => Either<unknown, unknown>
    const selfGetDelta = this.getDelta
    const selfTag = this.tag

    // Composing with a Traversal (has getAll/modifyAll, no getOptic)
    if (that !== null && typeof that === "object" && "getAll" in that && "modifyAll" in that && !("getOptic" in that)) {
      const trav = that as Traversal<unknown, unknown>
      return _buildTraversal(
        (s: unknown) => {
          const got = selfGet(s)
          if (!isRight(got)) return []
          return trav.getAll(got.right)
        },
        (f: (b: unknown) => unknown) => (s: unknown) => {
          const got = selfGet(s)
          if (!isRight(got)) return s
          const modified = trav.modifyAll(f)(got.right)
          const r = selfSet(modified)(s)
          return isRight(r) ? r.right : s
        },
      )
    }

    // Composing with another single-target optic (Builder)
    const otherGet = that.getOptic as (s: unknown) => Either<unknown, unknown>
    const otherSet = that.setOptic as (a: unknown) => (s: unknown) => Either<unknown, unknown>
    const otherGetDelta = that.getDelta as ((parentDelta: unknown) => unknown | undefined) | undefined
    const otherTag = that.tag as OpticTag

    const composedGetDelta =
      selfGetDelta && otherGetDelta
        ? (parentDelta: unknown) => {
            const mid = selfGetDelta(parentDelta)
            return mid !== undefined ? otherGetDelta(mid) : undefined
          }
        : selfGetDelta && !otherGetDelta
          ? selfGetDelta
          : undefined

    // "lens" composition: inner set needs the intermediate value from outer get
    // "prism" composition: inner set is independent of the whole
    const tag = selfTag === OpticTag.Lens || otherTag === OpticTag.Lens
      ? OpticTag.Lens
      : OpticTag.Prism

    if (tag === OpticTag.Lens) {
      return new Builder(
        OpticTag.Lens,
        (s: unknown) => {
          const outer = selfGet(s)
          if (!isRight(outer)) return outer
          return otherGet(outer.right)
        },
        (b: unknown) => (s: unknown) => {
          const outer = selfGet(s)
          if (!isRight(outer)) return LEFT_ABSENT
          const innerSet = otherSet(b)(outer.right)
          if (!isRight(innerSet)) return innerSet
          return selfSet(innerSet.right)(s)
        },
        composedGetDelta,
      )
    } else {
      return new Builder(
        OpticTag.Prism,
        (s: unknown) => {
          const outer = selfGet(s)
          if (!isRight(outer)) return outer
          return otherGet(outer.right)
        },
        (b: unknown) => (_s: unknown) => {
          const innerSet = otherSet(b)(undefined)
          if (!isRight(innerSet)) return innerSet
          return selfSet(innerSet.right)(undefined)
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
  return new Builder(
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
  return new Builder(
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
  return new Builder(
    OpticTag.Prism,
    (s: S): Either<A, Error> => {
      const a = preview(s)
      return a !== null ? right(a) : LEFT_ABSENT
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
  return new Builder(
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Variance: Lens<A,B> is invariant, so Lens<unknown,unknown> won't accept concrete lenses. Overload signatures provide type safety.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Variance: building a heterogeneous lens chain requires `any`. Overload signatures provide type safety.
  return (...keys: string[]): any => {
    if (keys.length === 0) throw new Error("at() requires at least one key")
    let result: Lens<any, any> = prop<any>()(keys[0]!)
    for (let i = 1; i < keys.length; i++) {
      result = result.compose(prop<any>()(keys[i]!)) as Lens<any, any>
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
  const t: Traversal<S, A> = {
    getAll,
    modifyAll,
    fold<R>(f: (acc: R, a: A) => R, initial: R) {
      return (s: S) => {
        let acc = initial
        for (const a of getAll(s)) acc = f(acc, a)
        return acc
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required: overloaded method implementation
    compose(that: any): any {
      // Traversal + Traversal
      if ("getAll" in that && "modifyAll" in that) {
        const thatT = that as Traversal<A, unknown>
        return _buildTraversal(
          (s: S) => {
            const result: unknown[] = []
            for (const a of getAll(s)) {
              for (const b of thatT.getAll(a)) result.push(b)
            }
            return result
          },
          (f: (b: unknown) => unknown) => modifyAll((a: A): A =>
            thatT.modifyAll(f)(a) as A
          ),
        )
      }
      // Traversal + single-target optic (Lens/Prism/Affine/Iso)
      const otherGet = that.getOptic as (s: unknown) => Either<unknown, unknown>
      const otherSet = that.setOptic as (a: unknown) => (s: unknown) => Either<unknown, unknown>
      return _buildTraversal(
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
          return (isRight(setResult) ? setResult.right : a) as A
        }),
      )
    },
  }
  return t
}

// Traversal composition with single-target optics is handled directly in
// Builder.compose — no monkey-patching needed.
