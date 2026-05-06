# Changelog

All notable changes to the Static DOM project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-06

Initial public release. The project ships as a pnpm monorepo of six packages
published to npm under the `@static-dom` organization.

### Packages

- **`@static-dom/core`** — virtual-DOM-free runtime, optics, JSX runtime,
  hyperscript / htm / html authoring variants, and `Program`.
- **`@static-dom/vdom`** — opt-in virtual-DOM boundary backed by Tachys (~11KB
  gzipped); use `vdomWith()` to bring your own renderer.
- **`@static-dom/react`** — React adapter (`SDOMBoundary`, `useSDOMBoundary`)
  for embedding Static DOM subtrees inside existing React apps.
- **`@static-dom/vite`** — Vite plugin: JSX automatic mode wiring (`sdomJsx`)
  plus build-time codegen (`sdomCodegen`) that hoists statically-resolvable
  JSX templates to module scope and emits per-template mount/update
  functions. CSP-clean (no `eval` / `new Function`); templates the plugin
  cannot statically resolve fall back to the runtime path unchanged.
- **`@static-dom/esbuild`** — esbuild plugin and config helpers (`sdomJsx`,
  `sdomJsxOptions`, `sdomSwcConfig`).
- **`@static-dom/eslint`** — ESLint plugin with `sdom/no-dynamic-children` rule
  for catching JSX patterns that violate the static-DOM invariant.

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
- Incremental computation graph as the reactive substrate: `Cell`, `Var`,
  `mapCell` / `mapCell2` / `mapCell3`, `bindCell`, `batch`, `stabilize`.
  Topo-height scheduling, per-cell cutoff, observer-driven GC. Program
  runners drive views off a `Var<Model>` end to end.
- Optic lifting over the graph: `liftLens`, `liftGetter`, `liftPrism`,
  `liftAffine`, `liftFold`, `focusVar`, `bindPrism`. Lens domain equality
  acts as the cutoff.
- Cell-first program runners `attachToCell` and `programFromVar` for code
  that already owns a `Cell` or `Var`.

### Tooling

- Dual licensed under Apache-2.0 OR MIT.
- Source-pointing `exports` in development; `publishConfig.exports` flips to
  `dist/` at publish time.
- `@static-dom/core/internal` subpath for adapter authors (`makeSDOM`,
  `guard`).

[0.1.0]: https://github.com/joshburgess/static-dom/releases/tag/v0.1.0
