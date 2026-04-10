# Optics Redesign: Structural Subtyping Approach

## Problem

The current `src/optics.ts` has separate `Lens<S,A>`, `Prism<S,A>`, and
`Iso<S,A>` interfaces that don't share a common base. This causes:

1. **No Affine/Optional type.** Composing a Lens with a Prism should yield an
   Affine (can fail to get, needs the whole to set), but there's no type for it.
2. **Broken Prism-Prism composition.** `Prism.composeLens` exists but
   `Prism.composePrism` doesn't. Prism composed with Lens throws on `review`.
3. **No `modify`.** Every optic should support `modify(f: A => A): S => S`.
4. **No path selectors.** `.at("user", "name")` for the common case of
   drilling into nested records.
5. **Composition is method-specific.** `Lens.compose(Lens)` and
   `Prism.composeLens(Lens)` are different methods. Should be one `compose`.

## Design: Single `Optic` Base Type

Inspired by `@fp-ts/optic` (ZIO Optics ported to TypeScript), we use a single
generic interface where optic subtypes emerge from structural subtyping.

### Core Idea

Each optic is a pair of functions: `getOptic` (try to extract the focus) and
`setOptic` (try to write the focus back). The type parameters control which
operations can fail and whether the whole is needed for setting:

```
                  GetError  SetError  SetWholeBefore
Iso               never     never     unknown        (get always works, set doesn't need whole)
Lens              never     never     S              (get always works, set needs whole)
Prism             Error     never     unknown        (get can fail, set doesn't need whole)
Affine/Optional   Error     Error     S              (get can fail, set needs whole)
```

### Type Hierarchy (Structural Subtyping)

```
         Iso
       /     \
    Lens     Prism
       \     /
       Affine
```

Because `Iso` has `SetWholeBefore = unknown` and `GetError = never`, it is
structurally a subtype of both `Lens` (which narrows `SetWholeBefore` to `S`)
and `Prism` (which widens `GetError` to `Error`). Both `Lens` and `Prism` are
subtypes of `Affine`.

Composition result types fall out automatically via method overload resolution:

```typescript
interface Optic<...> {
  // Most specific overloads first
  compose(this: Iso<S, A>,    that: Iso<A, B>):    Iso<S, B>
  compose(this: Lens<S, A>,   that: Lens<A, B>):   Lens<S, B>
  compose(this: Prism<S, A>,  that: Prism<A, B>):  Prism<S, B>
  compose(this: Affine<S, A>, that: Affine<A, B>): Affine<S, B>  // fallback
}
```

When you compose a `Lens` with a `Prism`, neither the Lens-Lens nor Prism-Prism
overload matches, but the Affine-Affine overload does (both are subtypes of
Affine) — so the result is `Affine<S, B>`. Correct by construction.

## Detailed Type Definitions

### Base Optic

```typescript
interface Optic<
  in GetWhole,
  in SetWholeBefore,
  in SetPiece,
  out GetError,
  out SetError,
  out GetPiece,
  out SetWholeAfter
> {
  readonly getOptic: (s: GetWhole) => Either<GetPiece, GetError>
  readonly setOptic: (a: SetPiece) => (s: SetWholeBefore) => Either<SetWholeAfter, SetError>

  // Composition overloads (most specific first)
  compose<B>(this: Iso<S, A>, that: Iso<A, B>): Iso<S, B>
  compose<B>(this: Lens<S, A>, that: Lens<A, B>): Lens<S, B>
  compose<B>(this: Prism<S, A>, that: Prism<A, B>): Prism<S, B>
  compose<B>(this: Affine<S, A>, that: Affine<A, B>): Affine<S, B>

  // Universal operations
  modify(f: (a: GetPiece) => SetPiece): (s: GetWhole & SetWholeBefore) => SetWholeAfter

  // Delta integration (SDOM-specific)
  getDelta?: (parentDelta: unknown) => unknown | undefined
}
```

### Subtype Aliases

```typescript
// Iso: total get, whole-independent set
interface Iso<in out S, in out A>
  extends Optic<S, unknown, A, never, never, A, S> {}

// Lens: total get, whole-dependent set
interface Lens<in out S, in out A>
  extends Optic<S, S, A, never, never, A, S> {}

// Prism: partial get, whole-independent set (has review)
interface Prism<in out S, in out A>
  extends Optic<S, unknown, A, Error, never, A, S> {}

// Affine/Optional: partial get, whole-dependent set
interface Affine<in out S, in out A>
  extends Optic<S, S, A, Error, Error, A, S> {}
```

### Convenience Accessors

These are derived from `getOptic`/`setOptic` and made available on the
appropriate subtypes:

```typescript
// On Iso and Lens (GetError = never → get always succeeds)
get(s: S): A              // unwrap Right from getOptic
set(a: A, s: S): S        // unwrap Right from setOptic

// On Prism and Affine (GetError = Error → get can fail)
preview(s: S): A | null   // Right → A, Left → null

// On Iso and Prism (SetWholeBefore = unknown → don't need whole)
review(a: A): S           // setOptic(a)(undefined as any) → unwrap Right
```

These are provided as standalone functions that accept any structurally
compatible optic, plus as methods on the concrete constructor return types.

## Constructor Functions

```typescript
// Most users will use these, not the raw Optic interface
function isoOf<S, A>(from: (s: S) => A, to: (a: A) => S): Iso<S, A>
function lensOf<S, A>(get: (s: S) => A, set: (a: A, s: S) => S): Lens<S, A>
function prismOf<S, A>(preview: (s: S) => A | null, review: (a: A) => S): Prism<S, A>
function affineOf<S, A>(preview: (s: S) => A | null, set: (a: A, s: S) => S): Affine<S, A>
```

### Runtime Implementation

All constructors produce the same `Builder` class (following `@fp-ts/optic`):

```typescript
class Builder<GW, SWB, SP, GE, SE, GP, SWA>
  implements Optic<GW, SWB, SP, GE, SE, GP, SWA>
{
  constructor(
    readonly tag: "lens" | "prism",  // determines composition strategy
    readonly getOptic: (s: GW) => Either<GP, GE>,
    readonly setOptic: (a: SP) => (s: SWB) => Either<SWA, SE>,
    readonly getDelta?: (parentDelta: unknown) => unknown | undefined,
  ) {}

  compose(that: any): any {
    // Two composition strategies based on tag:
    // "lens": inner set needs intermediate value from outer get
    // "prism": inner set is independent
    return this.tag === "lens" || that.tag === "lens"
      ? lensCompose(this, that)
      : prismCompose(this, that)
  }

  modify(f: (a: any) => any): (s: any) => any {
    return (s) => {
      const got = this.getOptic(s)
      if (isLeft(got)) return s  // Prism/Affine: target absent, return unchanged
      return unwrapRight(this.setOptic(f(got.right))(s))
    }
  }
}
```

The `Either` type is a minimal internal discriminated union (not imported from
any library):

```typescript
type Either<A, E> = { readonly _tag: "Right"; readonly right: A }
                  | { readonly _tag: "Left"; readonly left: E }
```

## Path Selectors

For the common case of drilling into nested records:

```typescript
function at<S>(): {
  <K1 extends keyof S>(k1: K1): Lens<S, S[K1]>
  <K1 extends keyof S, K2 extends keyof S[K1]>(
    k1: K1, k2: K2
  ): Lens<S, S[K1][K2]>
  <K1 extends keyof S, K2 extends keyof S[K1], K3 extends keyof S[K1][K2]>(
    k1: K1, k2: K2, k3: K3
  ): Lens<S, S[K1][K2][K3]>
  // ... up to 6 levels
}
```

Implementation: chains `prop` lenses internally.

```typescript
// Usage
const nameLens = at<AppModel>()("user", "profile", "name")
// Type: Lens<AppModel, string>

// Compose with a prism — result is Affine
const optionalName = nameLens.compose(nullablePrism())
// Type: Affine<AppModel, string>
```

## Delta Integration

Every optic carries an optional `getDelta` that extracts a sub-delta from a
parent delta. This is SDOM-specific and enables O(1) subtree skipping in
`focus()`:

```typescript
// prop("user") lens gets getDelta automatically:
// If parent delta is { kind: "fields", fields: { user: subDelta } }
// then getDelta returns subDelta
// If parent delta is { kind: "noop" }, returns undefined (skip)
```

Delta propagation composes through `compose()`:

```typescript
// at<App>()("user", "name") composes two prop lenses,
// and the composed getDelta chains: parent → user delta → name delta
```

## Migration Path

### Backward Compatible Exports

The new module re-exports thin wrappers matching the current API:

```typescript
// Old API still works
export function lens<S, A>(get, set, getDelta?): Lens<S, A>  // → lensOf(...)
export function prop<S>()                                      // same, returns Lens
export function composeLenses(...)                              // → a.compose(b).compose(c)
export function prism<S, A>(preview, review, getDelta?)        // → prismOf(...)
export function unionMember<S, A>(predicate)                   // → prismOf(...)
export function nullablePrism<S>()(key)                        // → affineOf(...)  (!)
export function iso<S, A>(from, to)                            // → isoOf(...)
export function indexLens<A>(index)                             // → lensOf(...)
```

Note: `nullablePrism` currently returns `Prism` but its `review` throws. In
the new system it should return `Affine` (partial get, whole-dependent set) —
this is a type-level breaking change but a correctness fix.

### SDOM Integration Points

1. **`SDOM.focus()`** — currently accepts `Lens<Outer, Model>`. Should also
   accept `Iso<Outer, Model>` (which is a subtype of Lens, so this works
   automatically).

2. **`optional()`** — currently accepts `Prism<Model, SubModel>`. Should also
   accept `Affine<Model, SubModel>` since `Prism` is a subtype of `Affine`.
   Actually, `optional` only uses `preview` and `getDelta`, so it should
   accept anything with those — which is `Affine` (the most general type with
   `preview`).

3. **Focus fusion** — `_FOCUS_LENS` stores a lens for composition.
   `.compose()` on the new unified type handles this.

4. **`mapUpdate`** in `observable.ts` — uses `lens.get`. Works unchanged since
   `Lens` and `Iso` both have `get`.

## Implementation Plan

### Step 1: New `src/optics.ts`

Replace the current file with:
- Minimal `Either` type (internal, not exported)
- `Optic` base interface with 7 type params
- `Iso`, `Lens`, `Prism`, `Affine` type aliases
- `Builder` class implementing compose/modify
- Constructor functions: `isoOf`, `lensOf`, `prismOf`, `affineOf`
- Convenience: `get`, `set`, `preview`, `review`, `modify` (standalone + methods)
- `getDelta` support on Builder

### Step 2: Derived constructors

- `prop<S>()(key)` → `Lens` with `getDelta`
- `at<S>()(k1, k2, ...)` → composed `Lens` via path
- `unionMember(predicate)` → `Prism`
- `nullablePrism<S>()(key)` → `Affine` (correctness fix)
- `indexLens(index)` → `Lens`
- `composeLenses(...)` → thin wrapper over `.compose()`

### Step 3: Update SDOM integration

- `types.ts`: `focus()` accepts `Lens<Outer, Model>` (Iso works via subtyping)
- `constructors.ts`: `optional()` accepts `Affine<Model, SubModel>` or keep
  accepting `Prism` (which is a subtype)
- `observable.ts`: `mapUpdate` unchanged
- `jsx-runtime.ts`: `Optional` component uses `Prism` or `Affine`

### Step 4: Backward compat re-exports

- Keep `lens()`, `prism()`, `iso()` function names as aliases
- Keep `composeLenses()` as alias
- `Lens`, `Prism`, `Iso` type names stay the same

### Step 5: Tests

- Port all 43 existing optics tests
- Add composition table tests: Iso+Lens=Lens, Lens+Prism=Affine, etc.
- Add `modify` tests for all optic types
- Add path selector (`at`) tests
- Add Affine tests (preview + set, compose with Lens/Prism)
- Verify `nullablePrism` returns Affine

### Step 6: Update exports and docs

- `src/index.ts`: export new types (`Affine`, `isoOf`, `lensOf`, `prismOf`,
  `affineOf`, `at`)
- `ROADMAP.md`: note optics redesign
- Existing code using `lens()`, `prop()`, etc. continues to work
