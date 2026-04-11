# Dynamic DOM Support Plan

static-dom's core guarantee — fixed DOM structure after mount, only leaf values update — covers most UI patterns. But some cases genuinely require structural changes at runtime: loading states, route switches, user-configured layouts, third-party widgets with unpredictable DOM.

This document outlines three approaches for supporting dynamic structure, ordered from most natural to most radical. Each builds on the existing escape hatches (`component`, `compiled`, `optional`) without compromising static-dom's performance model for the rest of the tree.

## Existing escape hatches

| Constructor | What it covers |
|---|---|
| `optional(prism, view)` | Binary show/hide — mount or unmount a single subtree based on a Prism/Affine |
| `component(setup)` | Third-party integration — gives you a raw `<div>` and imperative `update`/`teardown` hooks |
| `compiled(setup)` | Hand-optimized single-observer templates — full DOM control with one subscription |
| `array` / `arrayBy` / `incrementalArray` | Dynamic-length homogeneous lists with keyed reconciliation |

The biggest structural gap is **N-way switching** — showing one of several completely different DOM trees based on a discriminant.

---

## Proposal 1: `match` — discriminated union switch

**Priority: high** — covers ~80% of "I need dynamic structure" cases while staying within the static-dom philosophy.

### Problem

`optional` handles the binary case (present vs. absent), but many real-world patterns have N variants: loading/error/loaded states, route-based views, multi-step wizards, authenticated vs. anonymous layouts, feature flags with multiple treatments.

Today, users must nest multiple `optional` calls with complementary prisms or drop down to `component`/`compiled` and manage the switching imperatively.

### API

```typescript
import { match } from "static-dom"

type State =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "loaded"; data: Data }

const view = match("tag", {
  loading: loadingSpinner,   // SDOM<{ tag: "loading" }, Msg>
  error: errorPanel,         // SDOM<{ tag: "error"; message: string }, Msg>
  loaded: dataTable,         // SDOM<{ tag: "loaded"; data: Data }, Msg>
})
// -> SDOM<State, Msg>
```

### Signature

```typescript
function match<
  Tag extends string,
  Variants extends Record<string, unknown>,
  Msg,
>(
  discriminant: Tag,
  branches: { [K in keyof Variants]: SDOM<Variants[K], Msg> },
): SDOM<Variants[keyof Variants], Msg>
```

A second overload accepts a function instead of a property name, for models that don't use tagged unions:

```typescript
function match<Model, K extends string, Msg>(
  discriminant: (model: Model) => K,
  branches: Record<K, SDOM<Model, Msg>>,
): SDOM<Model, Msg>
```

### Behavior

- On mount: read the discriminant from the initial model, mount the corresponding branch.
- On update: if the discriminant hasn't changed, forward the update to the current branch (leaf-value updates only — standard static-dom fast path). If the discriminant changed, teardown the current branch and mount the new one.
- Each branch is a full static-dom tree with fixed structure — the dynamism is only at the switch point.
- A comment node anchor (like `optional` uses) marks the insertion point.

### Cost model

- Same-branch updates: O(leaf changes) — identical to any other static-dom component.
- Branch switches: O(teardown + mount) — proportional to the size of the branch being swapped, not the whole tree. This happens only when the discriminant value changes, which is typically infrequent (route changes, loading state transitions).

### Use cases

- Loading / error / loaded states
- Route-based page views
- Multi-step forms and wizards
- Authenticated vs. anonymous layouts
- Feature flag treatments
- Tab panels, accordion sections

---

## Proposal 2: `dynamic` — general structural escape hatch

**Priority: medium** — for cases where even `match` isn't enough because the set of possible structures isn't known at compile time.

### Problem

Some UI genuinely can't be expressed as a fixed set of branches:

- User-configured dashboards where the layout is data-driven
- Plugin systems where components are loaded at runtime
- Rich text renderers where structure mirrors an AST
- Any case where the number of structural variants is unbounded

### API

```typescript
import { dynamic } from "static-dom"

const view = dynamic(
  (model: Model) => model.layout,    // cache key — determines when to remount
  (model: Model) => {                // view factory — returns an SDOM
    if (model.layout === "grid") return gridView
    if (model.layout === "list") return listView
    return buildCustomLayout(model.columns)
  },
)
// -> SDOM<Model, Msg>
```

### Signature

```typescript
function dynamic<Model, Msg, K>(
  key: (model: Model) => K,
  factory: (model: Model) => SDOM<Model, Msg>,
): SDOM<Model, Msg>
```

### Behavior

- On mount: call `factory(initialModel)` to get an SDOM, mount it.
- On update: compute `key(nextModel)`. If it equals the previous key (by `===`), forward the update to the current SDOM (static-dom fast path). If it changed, teardown the current SDOM, call `factory(nextModel)` to get a new one, mount it.
- The factory is called lazily — only on mount and on key changes.

### Cost model

- Same-key updates: O(leaf changes) — the inner SDOM is still static-dom.
- Key changes: O(teardown + factory + mount) — full remount. This is the explicit contract: the user opts into remount cost at exactly the boundary where static structure breaks down.

The cost model is transparent: everything inside the `dynamic` boundary is static-dom fast; the boundary itself pays remount cost on key change.

### Caching

An optional third argument enables caching previously mounted branches so re-entering a key reuses the existing DOM rather than rebuilding from scratch:

```typescript
const view = dynamic(key, factory, { cache: true })
```

With caching, branch switches hide/show (via `display: none` or DOM removal + reinsertion from a detached fragment) rather than teardown/remount. This trades memory for faster switches — useful for tab-like patterns where users flip back and forth.

---

## Proposal 3: `vdom` boundary — embedded virtual DOM subtree

**Priority: low** — the nuclear option for when the dynamic structure is so fine-grained that even `dynamic` with caching isn't ergonomic.

### Problem

Some subtrees have per-update structural changes: nodes added, removed, reordered, or changed type every frame. Examples:

- Drag-and-drop builders where every interaction reshapes the tree
- WYSIWYG editors with arbitrary nesting
- Animation systems that add/remove elements on each tick
- Embedding third-party component libraries that expect vdom semantics

### API

```typescript
import { vdom } from "static-dom/vdom"

const dynamicContent = vdom<Model, Msg>((model, dispatch) =>
  h("div", {},
    model.items.map(item =>
      h(item.type, { key: item.id, onClick: () => dispatch({ type: "click", id: item.id }) },
        [item.content]
      )
    )
  )
)
// -> SDOM<Model, Msg>
```

### Approach

Rather than writing a full vdom differ, use **Preact** (~3KB gzipped) as the backing engine:

- `vdom()` returns an `SDOM<Model, Msg>` that creates a container element on mount.
- On every update, it calls the render function to produce a Preact VNode tree, then calls `render()` into the container.
- Preact handles diffing and patching within the boundary.
- On teardown, call `render(null, container)` to clean up.

This keeps static-dom's dependency footprint small (Preact is a peer dependency, only needed if you import `static-dom/vdom`) while providing battle-tested diffing for the subtrees that need it.

### Alternative: bring your own renderer

A lower-level variant accepts any renderer, not just Preact:

```typescript
import { vdomWith } from "static-dom/vdom"

const dynamicContent = vdomWith<Model, Msg>({
  render: (container, model, dispatch) => { /* any rendering logic */ },
  teardown: (container) => { /* cleanup */ },
})
```

This is essentially `component` with a slightly different ergonomic shape — it may not justify its own constructor unless the Preact integration provides enough value to warrant the `static-dom/vdom` entry point.

### Cost model

- Every update within the boundary pays vdom diffing cost — O(tree size), not O(changes).
- The boundary itself is still an `SDOM` node, so the rest of the static-dom tree is unaffected.
- The trade-off is explicit and scoped: "this subtree uses vdom; everything else is static."

---

## Recommendation

**Implement in this order:**

1. **`match`** — highest impact, lowest complexity, stays within the static-dom philosophy. Covers loading states, routing, wizards, and most "I need different DOM structures" cases. This is the natural complement to `optional` (binary) and `array` (homogeneous lists).

2. **`dynamic`** — general escape hatch for unbounded structural variation. More powerful than `match` but with a less constrained API. Useful for plugin systems, data-driven layouts, and anything where the set of possible views isn't known statically.

3. **`vdom` boundary** — only if users actually request it. `component` and `compiled` already let you embed any imperative rendering logic. A first-class Preact integration is nice but may be overengineering unless there's real demand. Wait for feedback.

Together with the existing `optional`, `component`, `compiled`, and `array` family, these three additions would give static-dom a complete spectrum from "fully static" to "fully dynamic" — with clear cost models at each level and explicit opt-in at exactly the boundaries where static structure breaks down.
