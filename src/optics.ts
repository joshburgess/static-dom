/**
 * optics.ts
 *
 * Unified optics using a tagged-kind approach with `OpticKind` string literal
 * tags and a type-level composition table (`ComposeKinds`).
 *
 * Each optic kind (Iso, Lens, Prism, Affine) is a concrete named interface
 * extending `OpticBase<K, S, A>`. The `compose` method uses `ComposeKinds` and
 * `ResolveOptic` to compute the result type at the type level — no overloads
 * needed for single-optic composition, and zero `any` in signatures.
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
// Optic kind — a string literal type tag
// ---------------------------------------------------------------------------

export type OpticKind = "iso" | "lens" | "prism" | "affine"

// ---------------------------------------------------------------------------
// Type-level composition table
// ---------------------------------------------------------------------------

export type ComposeKinds<K1 extends OpticKind, K2 extends OpticKind> =
  K1 extends "iso" ? K2 :
  K2 extends "iso" ? K1 :
  K1 extends "lens" ? (K2 extends "lens" ? "lens" : "affine") :
  K1 extends "prism" ? (K2 extends "prism" ? "prism" : "affine") :
  "affine"

// ---------------------------------------------------------------------------
// Resolve kind -> concrete interface
// ---------------------------------------------------------------------------

export type ResolveOptic<K extends OpticKind, S, A> =
  K extends "iso" ? Iso<S, A> :
  K extends "lens" ? Lens<S, A> :
  K extends "prism" ? Prism<S, A> :
  K extends "affine" ? Affine<S, A> :
  never

// ---------------------------------------------------------------------------
// OpticBase — shared methods, parameterized by kind
// ---------------------------------------------------------------------------

export interface OpticBase<K extends OpticKind, S, A> {
  readonly _kind: K

  /** The raw get function (Either-based). Part of the optic contract. */
  readonly getOptic: (s: S) => Either<A, Error>
  /** The raw set function (Either-based). Part of the optic contract. */
  readonly setOptic: (a: A) => (s: S) => Either<S, Error>

  /**
   * Compose this optic with a Traversal, yielding a Traversal.
   */
  compose<B>(that: Traversal<A, B>): Traversal<S, B>

  /**
   * Compose this optic with another single-target optic.
   * Result kind is computed at the type level via ComposeKinds — no overloads needed.
   */
  compose<K2 extends OpticKind, B>(
    that: OpticBase<K2, A, B>
  ): ResolveOptic<ComposeKinds<K, K2>, S, B>

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
// Concrete optic interfaces — each extends OpticBase with its kind tag
//
// No conditional types in the interface bodies — this is what makes
// compose inference work.
// ---------------------------------------------------------------------------

/** Isomorphism: total bidirectional conversion. */
export interface Iso<S, A> extends OpticBase<"iso", S, A> {
  readonly from: (s: S) => A
  readonly to: (a: A) => S
  readonly get: (s: S) => A
  readonly set: (a: A, s: S) => S
  readonly preview: (s: S) => A | null
  readonly review: (a: A) => S
  readonly toUpdate: () => (s: S) => A
}

/** Lens: total get, whole-dependent set. */
export interface Lens<S, A> extends OpticBase<"lens", S, A> {
  /** Read the focused value. Always succeeds. */
  readonly get: (s: S) => A
  /** Write the focused value, returning a new whole. */
  readonly set: (a: A, s: S) => S
  /** Alias of `get` — convenience for mapUpdate usage. */
  readonly toUpdate: () => (s: S) => A
}

/** Prism: partial get, whole-independent set (has review). */
export interface Prism<S, A> extends OpticBase<"prism", S, A> {
  /** Try to extract A. Returns null if not present. */
  readonly preview: (s: S) => A | null
  /** Embed A into S. */
  readonly review: (a: A) => S
  /** Compose with a Lens. Backward compat alias for compose(). */
  readonly composeLens: <B>(l: Lens<A, B>) => Affine<S, B>
}

/** Affine/Optional: partial get, whole-dependent set. */
export interface Affine<S, A> extends OpticBase<"affine", S, A> {
  /** Try to extract A. Returns null if not present. */
  readonly preview: (s: S) => A | null
  /** Write A back if the target exists. Returns S unchanged if target absent. */
  readonly set: (a: A, s: S) => S
}

/**
 * `Optic` — convenience alias mapping a kind tag to its concrete interface.
 * Usage: `Optic<"lens", S, A>` is the same as `Lens<S, A>`.
 */
export type Optic<K extends OpticKind, S, A> = ResolveOptic<K, S, A>

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
}

// ---------------------------------------------------------------------------
// Runtime implementation — single class for all optic types
// ---------------------------------------------------------------------------

const enum OpticTag { Lens, Prism }

class OpticImpl<K extends OpticKind, S, A> {
  /** Phantom — exists only at the type level for structural discrimination. */
  declare readonly _kind: K

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
    // On failure, return whole unchanged. For Lens/Affine S≡S;
    // for Prism/Iso this branch is unreachable (setOptic always succeeds).
    if (!isRight(r)) return s
    return r.right
  }

  from(s: S): A { return this.get(s) }

  to(a: A): S {
    // Meaningful for Prism/Iso only, where setOptic ignores the whole parameter.
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
  //
  // Two overloads: one for Traversal, one for single-target optics.
  // The Traversal overload must come first so that objects with both
  // getAll/modifyAll AND getOptic don't accidentally match the wrong one.

  compose<B>(that: Traversal<A, B>): Traversal<S, B>
  compose<K2 extends OpticKind, B>(that: OpticBase<K2, A, B>): ResolveOptic<ComposeKinds<K, K2>, S, B>
  compose(
    // Implementation signature: broad enough for both overloads.
    // Type safety is provided by the overload signatures above.
    that: Traversal<A, unknown> | OpticBase<OpticKind, A, unknown>
  ): Traversal<S, unknown> | Iso<S, unknown> | Lens<S, unknown> | Prism<S, unknown> | Affine<S, unknown> | OpticImpl<OpticKind, S, unknown> {
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
    const other = that as OpticBase<OpticKind, A, unknown>
    const otherImpl = other as OpticImpl<OpticKind, A, unknown>
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
      return new OpticImpl<OpticKind, S, unknown>(
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
      return new OpticImpl<OpticKind, S, unknown>(
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
  return new OpticImpl<"iso", S, A>(
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
  return new OpticImpl<"lens", S, A>(
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
  return new OpticImpl<"prism", S, A>(
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
  return new OpticImpl<"affine", S, A>(
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
// Implementation: the overload signatures provide full type safety.
// Lens is invariant, so no concrete Lens type can serve as a uniform accumulator.
// We cast through OpticImpl internally to chain compose calls.
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
    compose<B>(
      that: Traversal<A, B> | OpticBase<OpticKind, A, B>
    ): Traversal<S, B> {
      // Traversal + Traversal (has getAll/modifyAll)
      if ("getAll" in that && "modifyAll" in that) {
        const thatT = that as Traversal<A, B>
        return _buildTraversal<S, B>(
          (s: S) => {
            const result: B[] = []
            for (const a of getAll(s)) {
              for (const b of thatT.getAll(a)) result.push(b)
            }
            return result
          },
          (f: (b: B) => B) => modifyAll((a: A): A =>
            thatT.modifyAll(f)(a)
          ),
        )
      }
      // Traversal + single-target optic (Lens/Prism/Affine/Iso)
      const optic = that as OpticBase<OpticKind, A, B>
      const otherGet = optic.getOptic
      const otherSet = optic.setOptic
      return _buildTraversal<S, B>(
        (s: S) => {
          const result: B[] = []
          for (const a of getAll(s)) {
            const got = otherGet(a)
            if (isRight(got)) result.push(got.right)
          }
          return result
        },
        (f: (b: B) => B) => modifyAll((a: A): A => {
          const got = otherGet(a)
          if (!isRight(got)) return a
          const setResult = otherSet(f(got.right))(a)
          return isRight(setResult) ? setResult.right : a
        }),
      )
    },
  }
  return t
}
