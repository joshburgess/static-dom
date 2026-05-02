# @static-dom/eslint

ESLint rules for [Static DOM](https://github.com/joshburgess/static-dom) JSX.

Catches patterns that violate SDOM's static-DOM invariant before they reach the runtime.

## Install

```sh
pnpm add -D @static-dom/eslint
```

`eslint` is an optional peer dependency (>=8.0.0).

## Usage

```js
// eslint.config.js
import sdom from "@static-dom/eslint"

export default [
  {
    plugins: { sdom },
    rules: {
      "sdom/no-dynamic-children": "error",
    },
  },
]
```

## Rules

### `sdom/no-dynamic-children`

Flags JSX children patterns that create dynamic DOM structure:

- `{cond ? <A/> : <B/>}` — use `<Show>` or `<Optional>` instead.
- `{flag && <Component/>}` — use `<Show>`.
- `{items.map(x => <div/>)}` — use `<For>` for keyed lists.

## License

Dual-licensed under Apache-2.0 OR MIT.
