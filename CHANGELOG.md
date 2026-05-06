# Changelog

All notable changes to the Static DOM project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Build-time codegen via Vite plugin** (`@static-dom/vite`). New
  `sdomCodegen()` plugin that hoists each statically-resolvable JSX
  template to a module-scope record and emits per-template `mount`
  / `update` functions. End to end on the krausest harness this
  moved `07_create10k` from 65.9 ms (interpreted runtime path) to
  42.9 ms (Solid 1.9.3: 44.5 ms on the same machine). Templates the
  plugin cannot statically resolve fall back to the runtime path
  unchanged. CSP-clean (no `eval` / `new Function`).
- **Incremental computation graph** (`@static-dom/core`). New
  primitives: `makeVar`, `Cell`, `Var`, `mapCell`, `mapCell2`,
  `mapCell3`, `bindCell`, `batch`, `stabilize`, with topo-height
  scheduling, per-cell cutoff, and observer-driven GC.
- **Optic lifting layer** over the graph: `liftLens`, `liftGetter`,
  `liftPrism`, `liftAffine`, `liftFold`, `focusVar`, `bindPrism`.
  Lenses lift `Cell<S>` to `Cell<A>` with the optic's domain
  equality as cutoff; prisms / affines lift to `Cell<A | null>` via
  `preview`.
- **Cell-first program runners** `attachToCell` and `programFromVar`
  expose the graph entry point directly for code that already has a
  `Cell` or wants to own the `Var` externally.
- **Native Cell consumption through every SDOM constructor.** Every
  constructor in `packages/core/src/constructors.ts` provides an
  `attachCell` implementation, so the standard runners now drive
  views off the graph end to end without a per-mount
  `cellToUpdateStream` bridge.

### Changed

- **Program runners regrounded on the graph.** `program`,
  `programWithEffects`, `programWithSubscriptions`,
  `programWithDelta`, and `elmProgram` now drive their views off a
  `Var<Model>` internally, replacing the bespoke `Signal<Model>`
  used in 0.1.0. Public API of these runners is unchanged.

### Removed

- **BREAKING:** `wrapChannel`, `SDOMWithChannel`, and `ChannelEvent`.
  The channel-flavored variant was a port of PureScript's
  `interpretChannel` and had no internal callers after the keyed
  array reconciler was rewritten. The new `Cell` / `Var` primitives
  cover the same local-state-with-parent-dispatch use case more
  cleanly. No observed external consumers.

## [0.1.0] - 2026-05-02

Initial public release. The project ships as a pnpm monorepo of seven packages
published to npm under the `@static-dom` organization (plus an unscoped facade).

### Packages

- **`@static-dom/core`** — virtual-DOM-free runtime, optics, JSX runtime,
  hyperscript / htm / html authoring variants, and `Program`.
- **`@static-dom/vdom`** — opt-in virtual-DOM boundary backed by Tachys (~11KB
  gzipped); use `vdomWith()` to bring your own renderer.
- **`@static-dom/react`** — React adapter (`SDOMBoundary`, `useSDOMBoundary`)
  for embedding Static DOM subtrees inside existing React apps.
- **`@static-dom/vite`** — Vite plugin that wires JSX automatic mode to the
  Static DOM JSX runtime.
- **`@static-dom/esbuild`** — esbuild plugin and config helpers (`sdomJsx`,
  `sdomJsxOptions`, `sdomSwcConfig`).
- **`@static-dom/eslint`** — ESLint plugin with `sdom/no-dynamic-children` rule
  for catching JSX patterns that violate the static-DOM invariant.
- **`static-dom`** — unscoped facade that re-exports `@static-dom/core` and all
  of its subpaths.

### Core features

- Static DOM runtime: mount once, update leaves directly, no diff.
- Structural primitives: `Show`, `Optional`, `For`, `match`, `dynamic`.
- Reconciler: keyed `array()` / `arrayBy()` with same-structure, append-only,
  and full-replace fast paths plus LIS-based reorder.
- `incrementalArray()` and `programWithDelta` for O(1) keyed deltas.
- Optics suite: `Lens`, `Prism`, `AffineTraversal`, `Traversal`, `Iso`,
  `Getter`, `Fold`, `Setter`, `Review`, plus path-based composition (`focus`,
  `at`).
- `Focusable` protocol for third-party optics integration.
- Authoring styles: JSX runtime, hyperscript, htm tagged templates, raw HTML.
- Template cloning compiler enabled by default for JSX/h/html/htm.
- `Program`, ports, and subscriptions for Elm Architecture-style applications.

### Tooling

- Dual licensed under Apache-2.0 OR MIT.
- Source-pointing `exports` in development; `publishConfig.exports` flips to
  `dist/` at publish time.
- `@static-dom/core/internal` subpath for adapter authors (`makeSDOM`,
  `guard`).

[Unreleased]: https://github.com/joshburgess/static-dom/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/joshburgess/static-dom/releases/tag/v0.1.0
