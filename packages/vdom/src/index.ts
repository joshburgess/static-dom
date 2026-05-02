/**
 * vdom.ts: Embedded virtual DOM subtree boundary.
 *
 * Provides `vdom()` and `vdomWith()` constructors that embed a virtual DOM
 * subtree inside a static-dom tree. The recommended `vdom()` boundary uses
 * Tachys (`tachys/sync`) for diffing and patching: an Inferno-style LIS
 * keyed-diff with V8-focused tuning, ~11KB gzipped.
 *
 * Everything inside the boundary pays vdom diffing cost O(tree size).
 * Everything outside remains static-dom O(leaf changes). The boundary
 * is explicit and scoped.
 *
 * Tachys is a peer dependency of this package.
 *
 * @example
 * ```typescript
 * import { vdom } from "@static-dom/vdom"
 * import { h } from "tachys/sync"
 *
 * const dynamicContent = vdom<Model, Msg>((model, dispatch) =>
 *   h("div", null,
 *     model.items.map(item =>
 *       h(item.type, {
 *         key: item.id,
 *         onClick: () => dispatch({ type: "click", id: item.id }),
 *       }, item.content)
 *     )
 *   )
 * )
 * ```
 */

import type { SDOM, Dispatcher } from "@static-dom/core"
import { makeSDOM, guard } from "@static-dom/core/internal"
import { render as tachysRender, type VNode } from "tachys/sync"

// ---------------------------------------------------------------------------
// vdom: Tachys-backed virtual DOM boundary
// ---------------------------------------------------------------------------

/**
 * Embed a Tachys virtual DOM subtree inside a static-dom tree.
 *
 * The render function is called on every model update and should return
 * a Tachys VNode tree. Tachys handles diffing and patching within
 * the boundary container.
 *
 * @param renderFn  Called with `(model, dispatch)` on every update.
 *                  Returns a Tachys VNode (use `h` from `tachys/sync`
 *                  or Tachys's JSX runtime).
 *
 * @example
 * ```typescript
 * import { vdom } from "@static-dom/vdom"
 * import { h } from "tachys/sync"
 *
 * const view = vdom<Model, Msg>((model, dispatch) =>
 *   h("ul", null,
 *     model.items.map(item =>
 *       h("li", { key: item.id, onClick: () => dispatch({ type: "select", id: item.id }) },
 *         item.label
 *       )
 *     )
 *   )
 * )
 * ```
 *
 * **Cost model:** Every update within the boundary pays O(tree size) vdom
 * diffing. The boundary itself is an SDOM node, so the rest of the
 * static-dom tree is unaffected.
 */
export function vdom<Model, Msg>(
  renderFn: (model: Model, dispatch: Dispatcher<Msg>) => VNode,
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const container = document.createElement("div")
    parent.appendChild(container)

    guard("attach", "vdom render", () => {
      const vnode = renderFn(initialModel, dispatch)
      tachysRender(vnode, container)
    }, undefined)

    const unsub = updates.subscribe(({ next }) => {
      guard("update", "vdom render", () => {
        const vnode = renderFn(next, dispatch)
        tachysRender(vnode, container)
      }, undefined)
    })

    return {
      teardown() {
        unsub()
        tachysRender(null, container)
        container.remove()
      },
    }
  })
}

// ---------------------------------------------------------------------------
// vdomWith: bring your own renderer
// ---------------------------------------------------------------------------

/**
 * Embed any imperative rendering engine inside a static-dom tree.
 *
 * This is the generic variant of `vdom()`. Instead of Tachys, you provide
 * your own render and teardown functions. Useful for integrating any renderer
 * (Canvas, WebGL, D3, a custom vdom, etc.) as an SDOM node.
 *
 * @param options.render    Called on mount and every model update.
 * @param options.teardown  Called when the SDOM node is removed.
 *
 * @example
 * ```typescript
 * import { vdomWith } from "@static-dom/vdom"
 *
 * const chart = vdomWith<Model, Msg>({
 *   render(container, model, dispatch) {
 *     // Any rendering logic: D3, Canvas, WebGL, etc.
 *     container.innerHTML = `<p>${model.value}</p>`
 *   },
 *   teardown(container) {
 *     container.innerHTML = ""
 *   },
 * })
 * ```
 */
export function vdomWith<Model, Msg>(
  options: {
    render: (container: HTMLElement, model: Model, dispatch: Dispatcher<Msg>) => void
    teardown: (container: HTMLElement) => void
  },
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const container = document.createElement("div")
    parent.appendChild(container)

    // Initial render
    guard("attach", "vdomWith render", () => {
      options.render(container, initialModel, dispatch)
    }, undefined)

    // Subscribe to updates
    const unsub = updates.subscribe(({ next }) => {
      guard("update", "vdomWith render", () => {
        options.render(container, next, dispatch)
      }, undefined)
    })

    return {
      teardown() {
        unsub()
        options.teardown(container)
        container.remove()
      },
    }
  })
}
