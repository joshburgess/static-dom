# @static-dom/vdom

Virtual-DOM boundary for [Static DOM](https://github.com/joshburgess/static-dom).

Embeds a virtual-DOM subtree inside an SDOM tree. Use it for genuinely dynamic regions where the structure changes shape arbitrarily and SDOM's static-tree primitives are too restrictive.

The recommended `vdom()` boundary uses [Tachys](https://www.npmjs.com/package/tachys) (an Inferno-style LIS keyed-diff renderer, ~11KB gzipped). `vdomWith()` lets you bring your own renderer (D3, Canvas, WebGL, anything imperative).

## Install

```sh
pnpm add @static-dom/vdom tachys
```

`tachys` is a peer dependency.

## Usage

```ts
import { vdom } from "@static-dom/vdom"
import { h } from "tachys/sync"

const view = vdom<Model, Msg>((model, dispatch) =>
  h("ul", null,
    model.items.map(item =>
      h("li", { key: item.id, onClick: () => dispatch({ type: "select", id: item.id }) },
        item.label
      )
    )
  )
)
```

### Bring your own renderer

```ts
import { vdomWith } from "@static-dom/vdom"

const chart = vdomWith<Model, Msg>({
  render(container, model, dispatch) {
    container.innerHTML = `<p>${model.value}</p>`
  },
  teardown(container) {
    container.innerHTML = ""
  },
})
```

## Cost model

Everything inside the boundary pays vdom diffing cost on every update. Everything outside remains SDOM (cost proportional to leaf changes). The boundary is explicit and scoped.

## License

Dual-licensed under Apache-2.0 OR MIT.
