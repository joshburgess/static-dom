/**
 * optics.ts
 *
 * Lens and Prism types for the `focus` combinator.
 *
 * Design goals:
 *   - No typeclass machinery (we're in TypeScript).
 *   - Lenses compose left-to-right with a `.compose()` method.
 *   - Prisms handle optional sub-models (e.g. union type branches,
 *     "this tab is visible", nullable fields).
 *   - A small set of derivation helpers for common record patterns.
 *
 * This is deliberately NOT a full optics library (no Traversal, no Iso, etc.).
 * We only need what SDOM requires.
 */

// ---------------------------------------------------------------------------
// Lens<S, A>
// ---------------------------------------------------------------------------

/**
 * A lens focuses on a part A of a whole S.
 *
 *   get : S → A          (read the part)
 *   set : (A, S) → S     (write the part, returning a new whole)
 *
 * Laws (not enforced, but assumed by `focus`):
 *   get(set(a, s)) === a           (set-get)
 *   set(get(s), s) === s           (get-set)
 *   set(b, set(a, s)) === set(b,s) (set-set)
 */
export interface Lens<S, A> {
  readonly get: (s: S) => A
  readonly set: (a: A, s: S) => S
  /** Left-to-right composition: `lens.compose(other)` focuses on A then on B. */
  compose<B>(other: Lens<A, B>): Lens<S, B>
  /** Lift this lens to work on { prev, next } pairs (used in `mapUpdate`). */
  toUpdate(): (s: S) => A  // convenience alias of `get` for mapUpdate usage
  /**
   * Extract the sub-delta for this lens's focus from a parent delta.
   * Returns `undefined` if the delta doesn't apply or isn't structured.
   * This enables O(1) delta propagation through `focus` — a RecordDelta
   * with a `fields` variant can tell child lenses whether their field changed.
   */
  getDelta?: (parentDelta: unknown) => unknown | undefined
}

/**
 * Construct a Lens. The returned object also carries the `compose` method.
 */
export function lens<S, A>(
  get: (s: S) => A,
  set: (a: A, s: S) => S,
  getDelta?: (parentDelta: unknown) => unknown | undefined
): Lens<S, A> {
  const base = {
    get,
    set,
    compose<B>(other: Lens<A, B>): Lens<S, B> {
      const composedGetDelta =
        getDelta && other.getDelta
          ? (parentDelta: unknown) => {
              const mid = getDelta(parentDelta)
              return mid !== undefined ? other.getDelta!(mid) : undefined
            }
          : getDelta && !other.getDelta
            ? getDelta
            : undefined
      return lens(
        (s: S) => other.get(get(s)),
        (b: B, s: S) => set(other.set(b, get(s)), s),
        composedGetDelta
      )
    },
    toUpdate() {
      return get
    },
  }
  // Only attach getDelta when defined — exactOptionalPropertyTypes
  // forbids assigning `undefined` to an optional property.
  if (getDelta) {
    return { ...base, getDelta } as Lens<S, A>
  }
  return base as Lens<S, A>
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
 *
 * The curried form lets TypeScript infer S from context while still
 * requiring you to name the key explicitly.
 */
export function prop<S>(): <K extends keyof S>(key: K) => Lens<S, S[K]> {
  return <K extends keyof S>(key: K): Lens<S, S[K]> =>
    lens<S, S[K]>(
      (s: S) => s[key],
      (a: S[K], s: S) => {
        const result = { ...s }
        result[key] = a
        return result
      },
      (parentDelta: unknown): unknown | undefined => {
        // Extract the sub-delta for this field from a RecordDelta.
        // Returns undefined if the delta doesn't apply to this field.
        if (
          parentDelta != null &&
          typeof parentDelta === "object" &&
          "kind" in parentDelta
        ) {
          const d = parentDelta as { kind: string; value?: unknown; fields?: Record<string, unknown> }
          if (d.kind === "noop") return undefined
          if (d.kind === "replace" && d.value != null && typeof d.value === "object") {
            // Entire record replaced — extract the field value as an atom replace
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
  return lenses.reduce((acc, l) => acc.compose(l))
}

// ---------------------------------------------------------------------------
// Prism<S, A>  — for optional / union sub-models
// ---------------------------------------------------------------------------

/**
 * A prism focuses on a part A that may or may not exist within S.
 * Used for conditional rendering: "only render this branch when the
 * model satisfies this predicate".
 *
 *   preview  : S → A | null   (try to extract A)
 *   review   : A → S          (embed A back into S, used for dispatch)
 *
 * Laws:
 *   preview(review(a)) === a
 *   if preview(s) === a then review(a) "looks like" s
 */
export interface Prism<S, A> {
  readonly preview: (s: S) => A | null
  readonly review: (a: A) => S
  /** Compose with a lens focusing inside A. */
  composeLens<B>(l: Lens<A, B>): Prism<S, B>
}

export function prism<S, A>(
  preview: (s: S) => A | null,
  review: (a: A) => S
): Prism<S, A> {
  return {
    preview,
    review,
    composeLens<B>(l: Lens<A, B>): Prism<S, B> {
      return prism(
        (s: S) => {
          const a = preview(s)
          return a !== null ? l.get(a) : null
        },
        (b: B) => {
          // We need an A to embed b into, but we don't have one here.
          // Prism composition with Lens for dispatch direction requires
          // an existing S or a default A. Use `withDefault` variant below.
          throw new Error("Cannot review a composed Prism<S,B> without a default A")
        }
      )
    },
  }
}

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
  return prism(
    (s: S) => (predicate(s) ? s : null),
    (a: A) => a as S
  )
}

/**
 * Prism for a nullable field.
 *
 *   nullablePrism<{ name: string | null }>()("name")
 */
export function nullablePrism<S>(): <K extends keyof S>(
  key: K
) => Prism<S, NonNullable<S[K]>> {
  return <K extends keyof S>(key: K) =>
    prism(
      (s: S) => (s[key] != null ? (s[key] as NonNullable<S[K]>) : null),
      (_a: NonNullable<S[K]>) => {
        throw new Error("nullablePrism review not supported without full S context")
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lens<ReadonlyArray<A>, A>(
    (arr: ReadonlyArray<A>): A => {
      const v: A | undefined = arr[index]
      if (v === undefined) throw new RangeError(`indexLens: index ${index} out of bounds`)
      return v
    },
    (a: A, arr: ReadonlyArray<A>): ReadonlyArray<A> => {
      const copy = Array.from(arr)
      // Cast through unknown to bypass noUncheckedIndexedAccess on the write path
      ;(copy as unknown[])[index] = a
      return copy as A[]
    }
  )
}

// ---------------------------------------------------------------------------
// Iso<S, A>  — isomorphism (a lens where set is lossless)
// Useful for model normalization without data loss.
// ---------------------------------------------------------------------------

export interface Iso<S, A> extends Lens<S, A> {
  readonly from: (s: S) => A  // alias of get
  readonly to: (a: A) => S    // alias of (a, _s) => set(a, anything)
}

export function iso<S, A>(from: (s: S) => A, to: (a: A) => S): Iso<S, A> {
  return {
    ...lens(from, (a, _s) => to(a)),
    from,
    to,
  }
}
