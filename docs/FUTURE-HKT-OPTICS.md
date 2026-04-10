# Future: TypeLambda-Based Optics

## Motivation

The current optics redesign (see `OPTICS-REDESIGN.md`) uses a structural
subtyping approach inspired by `@fp-ts/optic` — a single `Optic` base type
parameterized so that subtypes (Lens, Prism, Affine, Iso) emerge through
the type system's subtyping rules, and composition "just works" via method
overload resolution.

This document captures a more ambitious future direction: using the Effect
`TypeLambda` pattern to abstract over the optic type constructors themselves,
enabling fully generic optic combinators and type classes.

## The TypeLambda Pattern

The core mechanism is ~10 lines of type-level code:

```typescript
interface TypeLambda {
  readonly In: unknown
  readonly Out2: unknown
  readonly Out1: unknown
  readonly Target: unknown
}

type Kind<F extends TypeLambda, In, Out2, Out1, Target> =
  F extends { readonly type: unknown }
    ? (F & { readonly In: In; readonly Out2: Out2; readonly Out1: Out1; readonly Target: Target })["type"]
    : never
```

Each type constructor declares a "type lambda" that references `this`:

```typescript
interface LensTypeLambda extends TypeLambda {
  readonly type: Lens<this["In"], this["Target"]>
}

// Kind<LensTypeLambda, string, never, never, number> === Lens<string, number>
```

The trick: `this` inside an interface refers to the actual intersection type
when `Kind` computes `(F & { Target: A })["type"]`, causing `this["Target"]`
to resolve to the concrete `A`.

## What This Would Enable

### 1. Generic optic combinators

```typescript
// A function polymorphic over any optic kind that has "get"
function view<F extends GettableOptic>(optic: Kind<F, S, A>, s: S): A

// Works with Lens, Iso, Getter — type error on Prism, Affine, Traversal
```

### 2. Type class hierarchy for optics

```typescript
interface Composable<F extends TypeLambda, G extends TypeLambda, R extends TypeLambda> {
  compose<S, A, B>(
    first: Kind<F, S, never, never, A>,
    second: Kind<G, A, never, never, B>
  ): Kind<R, S, never, never, B>
}

// Instance: composing a Lens with a Prism yields an Affine
const lensComposesPrism: Composable<LensTypeLambda, PrismTypeLambda, AffineTypeLambda> = {
  compose: (lens, prism) => affine(
    s => prism.preview(lens.get(s)),
    (b, s) => lens.set(prism.review(b), s)  // only when prism.review exists
  )
}
```

### 3. Abstracting over effect types

Beyond optics, the same pattern could abstract over `Signal` vs `Observable`
vs `Stream` in SDOM's reactive layer:

```typescript
interface ReactiveTypeLambda extends TypeLambda {
  readonly type: Reactive<this["Target"]>
}

interface Subscribable<F extends TypeLambda> {
  subscribe<A>(source: Kind<F, unknown, unknown, unknown, A>, observer: (a: A) => void): Teardown
}
```

## Why Not Now

1. **Complexity budget.** The structural subtyping approach gives us correct
   composition (Lens+Prism=Affine) with zero additional type machinery. The
   TypeLambda pattern adds a layer of indirection that's only justified when
   you need to be generic over the optic *kind* itself — which SDOM's current
   API surface doesn't require.

2. **Inference quality.** TypeScript's inference for `this`-type intersections
   has improved but can still produce opaque error messages. The structural
   subtyping approach gives clean, readable types in IDE tooltips. With
   TypeLambda encoding, users would see `Kind<LensTypeLambda, User, never,
   never, string>` instead of `Lens<User, string>`.

3. **Ecosystem alignment.** No existing optics library uses TypeLambda for
   optics. `@fp-ts/optic` uses the structural subtyping approach. `optics-ts`
   uses a domain-specific numeric encoding. Using TypeLambda for optics would
   be novel — valuable for research, but risky as the sole foundation for a
   production library.

4. **Incremental adoption.** The structural subtyping redesign is strictly
   more expressive than the current separate `Lens`/`Prism`/`Iso` types,
   and it's a clean migration path. TypeLambda can be layered on top later
   without breaking changes — the two approaches are complementary, not
   competing.

## When To Revisit

Consider adopting the TypeLambda pattern when:

- SDOM needs to be generic over its reactive primitive (Signal vs Observable)
- Users want to write functions polymorphic over optic kind
  (e.g., a generic "debug this optic" utility)
- A third-party library using TypeLambda for optics emerges and proves the
  ergonomics work (error messages, inference, IDE support)
- SDOM's optic combinators grow beyond compose/modify/get/set/preview to
  include Traversal, Fold, Setter — where the composition table becomes
  complex enough that encoding it via overloads becomes unwieldy

## References

- Effect TypeLambda: `effect/src/HKT.ts` (~45 lines)
- `@fp-ts/optic`: github.com/fp-ts/optic (structural subtyping, not TypeLambda)
- `optics-ts`: github.com/akheron/optics-ts (numeric-index encoding)
- The `this`-type intersection trick: foundation for all modern TS HKT encodings
- hkt-core (2024): lightweight extraction of the pattern
