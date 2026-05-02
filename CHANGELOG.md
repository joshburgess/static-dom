# Changelog

All notable changes to the Static DOM project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/joshburgess/static-dom/releases/tag/v0.1.0
