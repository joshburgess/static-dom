/**
 * constructors.ts
 *
 * Smart constructors for SDOM nodes.
 *
 * Each constructor returns an `SDOM<Model, Msg>` with the static-DOM
 * invariant upheld: the DOM structure produced during `attach` never
 * changes after that call.
 *
 * Public API surface:
 *   text(fn)                   — text node
 *   element(tag, attrs, ch)    — element with type-safe tag/attrs/events
 *   array(tag, getItems, item) — dynamic list with DOM reuse
 *   optional(prism, inner)     — conditionally present subtree
 *   component(fn)              — escape hatch / third-party integration
 *   wrapChannel(inner, interp) — lower a channeled SDOM to plain SDOM
 */

import { makeSDOM, type SDOM, type Teardown, type AttrInput,
         type SDOMAttr, type KeyedItem, type ArrayContext,
         type ChannelEvent, type SDOMWithChannel } from "./types"
import type { Observer, Update, UpdateStream, Dispatcher } from "./observable"
import type { Prism, Affine } from "./optics"
import { guard, guardApply, getErrorHandler, __SDOM_GUARD__ } from "./errors"
import { __SDOM_DEV__, validateModelShape, validateUniqueKeys } from "./dev"
import { registerEvent, getCurrentDelegator, withDelegator } from "./delegation"
import { createArrayReconciler, lis as lisImpl } from "./reconcile"

// ---------------------------------------------------------------------------
// Direct property assignment map (from Inferno)
//
// el.className = v is 2–5× faster than el.setAttribute("class", v)
// because it bypasses the attribute→property reflection layer.
// ---------------------------------------------------------------------------

/** @internal Exported for jsx-runtime prop classification. */
export const ATTR_TO_PROP: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  cellspacing: "cellSpacing",
  rowspan: "rowSpan",
  colspan: "colSpan",
  usemap: "useMap",
  frameborder: "frameBorder",
  contenteditable: "contentEditable",
  crossorigin: "crossOrigin",
  accesskey: "accessKey",
}

// ---------------------------------------------------------------------------
// Prototype-based updaters (from Most.js)
//
// V8 optimizes method calls on objects with stable hidden classes via inline
// caching. Each updater class has a fixed field layout and a prototype `run`
// method, giving V8 monomorphic dispatch within each type. This replaces
// ad-hoc closures whose unique captured-variable shapes cause megamorphic
// call sites in the updater loop.
// ---------------------------------------------------------------------------

const EMPTY_CLASS_MAP: Record<string, boolean> = {}

class PropUpdater<M> {
  lastVal: unknown
  constructor(
    readonly el: Element,
    readonly name: string,
    readonly label: string,
    readonly derive: (m: M) => unknown,
    readonly fallback: unknown,
    initial: unknown,
  ) { this.lastVal = initial; Reflect.set(el, name, initial) }
  run(_p: M, n: M): void {
    const v = __SDOM_GUARD__
      ? guard("update", this.label, () => this.derive(n), this.fallback)
      : this.derive(n)
    if (v !== this.lastVal) { this.lastVal = v; Reflect.set(this.el, this.name, v) }
  }
}

class StringAttrUpdater<M> {
  lastVal: string
  constructor(
    readonly el: Element,
    readonly name: string,
    readonly label: string,
    readonly derive: (m: M) => string,
    initial: string,
  ) { this.lastVal = initial; el.setAttribute(name, initial) }
  run(_p: M, n: M): void {
    const v = __SDOM_GUARD__
      ? guard("update", this.label, () => this.derive(n), "")
      : this.derive(n)
    if (v !== this.lastVal) { this.lastVal = v; this.el.setAttribute(this.name, v) }
  }
}

class BoolAttrUpdater<M> {
  lastVal: boolean
  constructor(
    readonly el: Element,
    readonly name: string,
    readonly label: string,
    readonly derive: (m: M) => boolean,
    initial: boolean,
  ) { this.lastVal = initial; el.toggleAttribute(name, initial) }
  run(_p: M, n: M): void {
    const v = __SDOM_GUARD__
      ? guard("update", this.label, () => this.derive(n), false)
      : this.derive(n)
    if (v !== this.lastVal) { this.lastVal = v; this.el.toggleAttribute(this.name, v) }
  }
}

class StyleUpdater<M> {
  lastVal: string
  constructor(
    readonly el: HTMLElement,
    readonly prop: string,
    readonly label: string,
    readonly derive: (m: M) => string,
    initial: string,
  ) { this.lastVal = initial; el.style.setProperty(prop, initial) }
  run(_p: M, n: M): void {
    const v = __SDOM_GUARD__
      ? guard("update", this.label, () => this.derive(n), "")
      : this.derive(n)
    if (v !== this.lastVal) { this.lastVal = v; this.el.style.setProperty(this.prop, v) }
  }
}

class ClassMapUpdater<M> {
  lastMap: Record<string, boolean>
  constructor(
    readonly el: Element,
    readonly derive: (m: M) => Record<string, boolean>,
    initial: Record<string, boolean>,
  ) { this.lastMap = initial; applyClassMap(el, initial) }
  run(_p: M, n: M): void {
    const nextMap = __SDOM_GUARD__
      ? guard("update", "classMap", () => this.derive(n), EMPTY_CLASS_MAP)
      : this.derive(n)
    if (nextMap !== this.lastMap) { applyClassMap(this.el, nextMap, this.lastMap); this.lastMap = nextMap }
  }
}

class EventRefUpdater<M> {
  constructor(readonly ref: { current: M }) {}
  run(_p: M, n: M): void { this.ref.current = n }
}

interface IUpdater<M> { run(prev: M, next: M): void }

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

/**
 * A text node whose content is derived from the model.
 *
 * INVARIANT: Creates exactly one `Text` DOM node. Updates its `textContent`.
 *
 * @param value  Function from model to text content.
 */
export function text<Model>(value: (model: Model) => string): SDOM<Model, never> {
  return makeSDOM<Model, never>((parent, initialModel, updates, _dispatch) => {
    let lastText = guardApply("attach", "text derive", value, initialModel, "")
    const node = document.createTextNode(lastText)
    parent.appendChild(node)

    const checkShape = validateModelShape("text", initialModel)
    const unsub = updates.subscribe(({ next }) => {
      checkShape(next)
      const nextText = __SDOM_GUARD__
        ? guard("update", "text derive", () => value(next), "")
        : value(next)
      if (nextText !== lastText) {
        lastText = nextText
        node.textContent = nextText
      }
    })

    return {
      teardown() {
        unsub()
        node.remove()
      },
    }
  })
}

/**
 * A static text node — no model dependency.
 */
export function staticText(content: string): SDOM<unknown, never> {
  return makeSDOM<unknown, never>((parent, _m, _u, _d) => {
    const node = document.createTextNode(content)
    parent.appendChild(node)
    return { teardown: () => node.remove() }
  })
}

// ---------------------------------------------------------------------------
// element
// ---------------------------------------------------------------------------

/**
 * An element node with type-safe attributes and event handlers.
 *
 * INVARIANT: Creates exactly one DOM element during `attach`.
 *   Children are mounted into it once. Attributes are updated in-place.
 *
 * @param tag      The HTML tag name. Constrains the `attrs` and `on` types.
 * @param attrInput Attributes, event handlers, classes, and styles.
 * @param children  Static list of child SDOM nodes.
 *
 * Example:
 *   element("input", {
 *     attrs: { value: m => m.text, disabled: m => m.loading },
 *     on: { input: (e, _m) => ({ type: "textChanged", value: (e.target as HTMLInputElement).value }) },
 *     classes: m => ({ error: m.hasError, active: m.isActive }),
 *   }, [])
 */
export function element<
  Tag extends keyof HTMLElementTagNameMap,
  Model,
  Msg
>(
  tag: Tag,
  attrInput: NoInfer<AttrInput<Tag, Model, Msg>>,
  children: NoInfer<SDOM<Model, Msg>>[]
): SDOM<Model, Msg> {
  // Pre-process attrInput into a flat SDOMAttr list once at construction time,
  // not on every attach. This avoids repeated object traversal at runtime.
  const attrList = buildAttrList(attrInput)

  // Bitwise element flags (from Inferno) — precompute at construction time
  // so the attach function can skip entire branches with a single & test.
  const HAS_ATTRS = attrList.length > 0
  const HAS_CHILDREN = children.length > 0

  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const el = document.createElement(tag) as HTMLElementTagNameMap[Tag] & Element

    let childTeardowns: Teardown[] | null = null
    const checkShape = validateModelShape(`element<"${tag}">`, initialModel)

    // ── Attr setup ──
    // Prototype-based updater classes (from Most.js): each class has a stable
    // hidden class and a prototype `run` method, giving V8 monomorphic dispatch
    // within each updater type instead of megamorphic closure calls.
    // Bitwise flag HAS_ATTRS gates the entire loop — skip for static elements.
    let attrUpdaters: IUpdater<Model>[] | null = null
    let eventTeardowns: Array<() => void> | null = null

    if (HAS_ATTRS) {
    attrUpdaters = []
    eventTeardowns = []

    for (const rawAttr of attrList) {
      const attr = rawAttr as SDOMAttr<Model, Msg>
      switch (attr.kind) {
        case "string": {
          const initial = guardApply("attach", `attr "${attr.name}"`, attr.value, initialModel, "")
          const propName = ATTR_TO_PROP[attr.name]
          if (propName) {
            // Direct property assignment — 2–5× faster than setAttribute
            attrUpdaters.push(new PropUpdater<Model>(el, propName, `attr "${attr.name}"`, attr.value, "", initial))
          } else {
            attrUpdaters.push(new StringAttrUpdater<Model>(el, attr.name, `attr "${attr.name}"`, attr.value, initial))
          }
          break
        }
        case "bool": {
          const initial = guardApply("attach", `attr "${attr.name}"`, attr.value, initialModel, false)
          attrUpdaters.push(new BoolAttrUpdater<Model>(el, attr.name, `attr "${attr.name}"`, attr.value, initial))
          break
        }
        case "prop": {
          const initial = guardApply("attach", `prop "${attr.name}"`, attr.value, initialModel, "")
          attrUpdaters.push(new PropUpdater<Model>(el, attr.name, `prop "${attr.name}"`, attr.value, "", initial))
          break
        }
        case "style": {
          const initial = guardApply("attach", `style "${attr.property}"`, attr.value, initialModel, "")
          attrUpdaters.push(new StyleUpdater<Model>(el as HTMLElement, attr.property, `style "${attr.property}"`, attr.value, initial))
          break
        }
        case "classMap": {
          const initial = guardApply("attach", "classMap", attr.map, initialModel, EMPTY_CLASS_MAP)
          attrUpdaters.push(new ClassMapUpdater<Model>(el, attr.map, initial))
          break
        }
        case "event": {
          const ref = { current: initialModel }
          const evtHandler = attr.handler
          const name = attr.name
          const handler = (event: Event) => {
            const msg = __SDOM_GUARD__
              ? guard("event", `on "${name}"`, () => evtHandler(event, ref.current), null)
              : evtHandler(event, ref.current)
            if (msg !== null) dispatch(msg)
          }
          attrUpdaters.push(new EventRefUpdater<Model>(ref))
          const cleanup = registerEvent(el, name, handler)
          if (cleanup !== null) eventTeardowns.push(cleanup)
          break
        }
      }
    }
    } // end if (HAS_ATTRS)

    // ── Single subscription for all attrs ──
    // One observer callback runs all updaters in a tight loop.
    let attrUnsub: (() => void) | null = null
    if (attrUpdaters !== null) {
      const updaters = attrUpdaters
      const nUpdaters = updaters.length
      if (nUpdaters > 0) {
        attrUnsub = updates.subscribe(({ prev, next }) => {
          if (__SDOM_DEV__) checkShape(next)
          for (let i = 0; i < nUpdaters; i++) {
            updaters[i]!.run(prev, next)
          }
        })
      }
    }

    // ── Children ──
    // Bitwise flag HAS_CHILDREN gates child mount — skip for leaf elements.
    // Inline try/catch avoids closure allocation from guard() per child.
    if (HAS_CHILDREN) {
      childTeardowns = []
      if (__SDOM_GUARD__) {
        for (let i = 0; i < children.length; i++) {
          try {
            childTeardowns.push(children[i]!.attach(el, initialModel, updates, dispatch))
          } catch (error) {
            getErrorHandler()({ error, phase: "attach", context: `element<${tag}> child[${i}]` })
            childTeardowns.push({ teardown() {} })
          }
        }
      } else {
        for (let i = 0; i < children.length; i++) {
          childTeardowns.push(children[i]!.attach(el, initialModel, updates, dispatch))
        }
      }
    }

    parent.appendChild(el)

    return {
      teardown() {
        attrUnsub?.()
        if (eventTeardowns) eventTeardowns.forEach(fn => fn())
        if (childTeardowns) childTeardowns.forEach(t => t.teardown())
        el.remove()
      },
    }
  })
}

// ---------------------------------------------------------------------------
// array
// ---------------------------------------------------------------------------

/**
 * A dynamic list of uniformly-shaped items.
 *
 * INVARIANT: The *shape* of each item is fixed (they all use `itemSdom`).
 *   Items are added/removed as the array grows/shrinks, but existing item
 *   DOM nodes are reused by key — no item is ever re-created if its key
 *   persists across updates.
 *
 * @param containerTag  The tag to wrap all items in (e.g. "ul", "div").
 * @param getItems      Project the model to a list of keyed items.
 * @param itemSdom      The SDOM template for each item.
 *                      Its model type is `{ item: ItemModel, ctx: ArrayContext }`.
 *
 * The item's Msg can reference the *array* (e.g. "remove me") via the
 * `ArrayMsg` wrapper type — see `array.arrayMsg` helper.
 *
 * Example:
 *   array(
 *     "ul",
 *     m => m.todos.map((t, i) => ({ key: t.id, model: t })),
 *     todoItem   // SDOM<Todo, TodoMsg>
 *   )
 */
export function array<
  Model,
  ItemModel,
  Msg
>(
  containerTag: keyof HTMLElementTagNameMap,
  getItems: (model: Model) => KeyedItem<ItemModel>[],
  itemSdom: SDOM<ItemModel, Msg>
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const container = document.createElement(containerTag)
    parent.appendChild(container)

    const reconciler = createArrayReconciler<ItemModel, Msg>(
      container, itemSdom, dispatch, "array",
    )

    // Cache the previous items for array-identity fast path.
    let prevItems: KeyedItem<ItemModel>[] | null = null

    // Initial mount
    const initialItems = getItems(initialModel)
    reconciler.sync(
      initialItems.length,
      i => initialItems[i]!.key,
      i => initialItems[i]!.model,
    )
    prevItems = initialItems

    const unsub = updates.subscribe(({ next }) => {
      const nextItems = getItems(next)
      // Array-identity fast path: skip when same reference
      if (nextItems === prevItems) return
      reconciler.sync(
        nextItems.length,
        i => nextItems[i]!.key,
        i => nextItems[i]!.model,
      )
      prevItems = nextItems
    })

    return {
      teardown() {
        unsub()
        reconciler.teardown()
      },
    }
  })
}

// ---------------------------------------------------------------------------
// arrayBy — zero-allocation keyed array
// ---------------------------------------------------------------------------

/**
 * Like `array()`, but takes a key extractor function instead of requiring
 * the user to `.map()` items into `{ key, model }` wrappers. This avoids
 * n object allocations per reconciliation — the raw items array is used
 * directly.
 *
 * ```typescript
 * // Before (array): allocates n wrapper objects per render
 * array("tbody", m => m.rows.map(r => ({ key: r.id, model: r })), rowView)
 *
 * // After (arrayBy): zero wrapper allocation
 * arrayBy("tbody", m => m.rows, r => r.id, rowView)
 * ```
 *
 * Internally maintains a flat `string[]` of previous keys for fast-path
 * detection, which is much cheaper than n `{ key, model }` objects.
 */
export function arrayBy<
  Model,
  ItemModel,
  Msg
>(
  containerTag: keyof HTMLElementTagNameMap,
  getItems: (model: Model) => readonly ItemModel[],
  getKey: (item: ItemModel) => string,
  itemSdom: SDOM<ItemModel, Msg>,
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const container = document.createElement(containerTag)
    parent.appendChild(container)

    const reconciler = createArrayReconciler<ItemModel, Msg>(
      container, itemSdom, dispatch, "arrayBy",
    )

    // Array reference cache — enables O(1) identity check.
    let prevItemsRef: readonly ItemModel[] | null = null

    // Initial mount
    const initialItems = getItems(initialModel)
    reconciler.sync(
      initialItems.length,
      i => getKey(initialItems[i]!),
      i => initialItems[i]!,
    )
    prevItemsRef = initialItems

    const unsub = updates.subscribe(({ next }) => {
      const nextItems = getItems(next)
      // Array-identity fast path: skip when same reference
      if (nextItems === prevItemsRef) return
      reconciler.sync(
        nextItems.length,
        i => getKey(nextItems[i]!),
        i => nextItems[i]!,
      )
      prevItemsRef = nextItems
    })

    return {
      teardown() {
        unsub()
        reconciler.teardown()
      },
    }
  })
}

// ---------------------------------------------------------------------------
// indexedArray — non-keyed fast path (from Inferno)
// ---------------------------------------------------------------------------

/**
 * A non-keyed array that patches items by index.
 *
 * Unlike `array` which uses string keys and a Map for O(1) lookup, this
 * constructor uses pure positional indexing: slot N always shows item N.
 * Items are added/removed only at the end.
 *
 * Trade-offs vs `array`:
 *   + No Map allocation or key lookups — lower overhead per item
 *   + No DOM reordering logic — items never move
 *   - Removing from the middle re-patches all subsequent slots
 *   - No identity preservation across reorderings
 *
 * Use for: logs, fixed grids, tables without sorting, append-only lists.
 *
 * @param containerTag  Wrapper element tag.
 * @param getItems      Project model to item array (no keys needed).
 * @param itemSdom      Template for each item.
 */
export function indexedArray<Model, ItemModel, Msg>(
  containerTag: keyof HTMLElementTagNameMap,
  getItems: (model: Model) => ItemModel[],
  itemSdom: SDOM<ItemModel, Msg>
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const container = document.createElement(containerTag)
    parent.appendChild(container)

    // Capture the ambient delegator so deferred per-item mounts still
    // register through the program's root listener.
    const capturedDelegator = getCurrentDelegator()

    type Slot = {
      teardown: Teardown
      modelRef: { current: ItemModel }
      observer: Observer<Update<ItemModel>> | null
      update: { prev: ItemModel; next: ItemModel }
    }

    const slots: Slot[] = []

    function mountSlot(itemModel: ItemModel): void {
      const modelRef = { current: itemModel }
      const update = { prev: itemModel, next: itemModel }
      const slot: Slot = { teardown: { teardown() {} }, modelRef, observer: null, update }

      const itemUpdates: UpdateStream<ItemModel> = {
        subscribe(obs) {
          slot.observer = obs
          return () => { slot.observer = null }
        },
      }

      slot.teardown = withDelegator(capturedDelegator, () =>
        itemSdom.attach(container, itemModel, itemUpdates, dispatch))
      slots.push(slot)
    }

    function unmountLast(): void {
      const slot = slots.pop()!
      slot.teardown.teardown()
    }

    // Initial mount
    const initialItems = getItems(initialModel)
    for (const item of initialItems) mountSlot(item)

    const unsub = updates.subscribe(({ next }) => {
      const nextItems = getItems(next)
      const prevLen = slots.length
      const nextLen = nextItems.length

      // Patch existing slots (up to min of old/new length)
      const patchLen = prevLen < nextLen ? prevLen : nextLen
      for (let i = 0; i < patchLen; i++) {
        const slot = slots[i]!
        const newModel = nextItems[i]!
        if (slot.modelRef.current !== newModel) {
          const prev = slot.modelRef.current
          slot.modelRef.current = newModel
          slot.update.prev = prev
          slot.update.next = newModel
          slot.observer?.(slot.update as Update<ItemModel>)
        }
      }

      // Shrink: unmount excess from end
      for (let i = prevLen - 1; i >= nextLen; i--) unmountLast()

      // Grow: mount new at end
      for (let i = prevLen; i < nextLen; i++) mountSlot(nextItems[i]!)
    })

    return {
      teardown() {
        unsub()
        for (const slot of slots) slot.teardown.teardown()
        container.remove()
      },
    }
  })
}

// ---------------------------------------------------------------------------
// optional — conditionally present subtree
// ---------------------------------------------------------------------------

/**
 * Render `inner` only when `prism.preview(model)` is non-null.
 *
 * Unlike `showIf` (which toggles visibility), `optional` creates and
 * destroys DOM nodes as the condition changes.
 *
 * Use `showIf` for frequent toggles (avoids re-mounting cost).
 * Use `optional` for tabs, modals, or branches that are rarely toggled.
 *
 * @param prism   Extracts the sub-model if it exists.
 * @param inner   Component to render when the sub-model exists.
 */
export function optional<Model, SubModel, Msg>(
  prism: Prism<Model, SubModel> | Affine<Model, SubModel>,
  inner: SDOM<SubModel, Msg>
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    // A stable anchor so we know where to insert/remove the optional content
    const anchor = document.createComment("optional")
    parent.appendChild(anchor)

    // Capture for deferred re-mounts.
    const capturedDelegator = getCurrentDelegator()

    let currentTeardown: Teardown | null = null
    let currentSubModel: SubModel | null = prism.preview(initialModel)

    function mount(subModel: SubModel): void {
      const fragment = document.createDocumentFragment()
      const subUpdates: UpdateStream<SubModel> = {
        subscribe(observer) {
          return updates.subscribe(({ prev, next, delta }) => {
            // Delta fast path: skip if prism's target didn't change
            if (delta !== undefined && prism.getDelta) {
              const innerDelta = prism.getDelta(delta)
              if (innerDelta === undefined) return
              const nextSub = prism.preview(next)
              if (nextSub !== null) {
                observer({
                  prev: prism.preview(prev) ?? subModel,
                  next: nextSub,
                  delta: innerDelta,
                })
              }
              return
            }
            // Slow path: reference equality
            const prevSub = prism.preview(prev)
            const nextSub = prism.preview(next)
            if (nextSub !== null && prevSub !== nextSub) {
              observer({ prev: prevSub ?? subModel, next: nextSub })
            }
          })
        },
      }
      currentTeardown = withDelegator(capturedDelegator, () =>
        guard("attach", "optional inner", () =>
          inner.attach(fragment, subModel, subUpdates, dispatch),
          { teardown() {} }
        )
      )
      anchor.parentNode?.insertBefore(fragment, anchor.nextSibling)
    }

    function unmount(): void {
      currentTeardown?.teardown()
      currentTeardown = null
    }

    if (currentSubModel !== null) {
      mount(currentSubModel)
    }

    const unsub = updates.subscribe(({ next, delta }) => {
      // Delta fast path: skip mount/unmount check if field unchanged
      if (delta !== undefined && prism.getDelta) {
        const innerDelta = prism.getDelta(delta)
        if (innerDelta === undefined) return
      }

      const nextSub = prism.preview(next)
      const wasPresent = currentSubModel !== null
      const isPresent = nextSub !== null

      if (!wasPresent && isPresent) {
        mount(nextSub!)
      } else if (wasPresent && !isPresent) {
        unmount()
      }
      currentSubModel = nextSub
    })

    return {
      teardown() {
        unsub()
        unmount()
        anchor.remove()
      },
    }
  })
}

// ---------------------------------------------------------------------------
// component — escape hatch / third-party integration
// ---------------------------------------------------------------------------

/**
 * Integrate a third-party (non-SDOM) component.
 *
 * The `setup` function receives the container element and the initial model,
 * and should return an object with:
 *   - `update`: called whenever the model changes (for direct DOM manipulation)
 *   - `teardown`: called when the component is removed
 *
 * This mirrors the PureScript approach of "our representation is already low-level".
 *
 * Example — wrapping a canvas-based chart library:
 *   component((el, model) => {
 *     const chart = new MyChart(el, model.data)
 *     return {
 *       update: (newModel) => chart.setData(newModel.data),
 *       teardown: () => chart.destroy(),
 *     }
 *   })
 */
export function component<Model, Msg = never>(
  setup: (
    el: HTMLElement,
    model: Model,
    dispatch: Dispatcher<Msg>
  ) => {
    update: (model: Model) => void
    teardown: () => void
  }
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const el = document.createElement("div")
    parent.appendChild(el)

    const instance = guard("attach", "component setup", () =>
      setup(el, initialModel, dispatch),
      { update: () => {}, teardown: () => {} }
    )

    const unsub = updates.subscribe(({ next }) => {
      guard("update", "component update", () => { instance.update(next) }, undefined)
    })

    return {
      teardown() {
        unsub()
        instance.teardown()
        el.remove()
      },
    }
  })
}

// ---------------------------------------------------------------------------
// compiled — fused single-observer template (from Inferno/Most.js)
// ---------------------------------------------------------------------------

/**
 * A hand-optimized SDOM component with a single observer.
 *
 * Unlike `element` (which creates N subscriptions for N attrs + children),
 * `compiled` registers exactly ONE observer on the update stream. The user
 * provides raw DOM creation and update logic — no guard overhead, no
 * per-attr dispatch, no intermediate subscription layers.
 *
 * This is the SDOM equivalent of Inferno's compiled templates or Solid's
 * compiled JSX output: maximum throughput by eliminating framework overhead.
 *
 * Use for performance-critical inner loops (e.g., list item templates in
 * a 1000-row table). For most components, `element` is more ergonomic.
 *
 * @param setup  Called once during `attach`. Creates DOM nodes, appends them
 *               to `parent`, and returns an update + teardown pair.
 *
 * @example
 * ```typescript
 * const fastRow = compiled<Row, Msg>((parent, model, dispatch) => {
 *   const tr = document.createElement("tr")
 *   const td1 = document.createElement("td")
 *   const td2 = document.createElement("td")
 *   td1.className = model.selected ? "selected" : ""
 *   td1.textContent = model.id
 *   td2.textContent = model.label
 *   tr.appendChild(td1)
 *   tr.appendChild(td2)
 *   parent.appendChild(tr)
 *
 *   let lastCls = td1.className, lastLabel = model.label
 *   return {
 *     update(_prev, next) {
 *       const cls = next.selected ? "selected" : ""
 *       if (cls !== lastCls) { lastCls = cls; td1.className = cls }
 *       const lbl = next.label
 *       if (lbl !== lastLabel) { lastLabel = lbl; td2.textContent = lbl }
 *     },
 *     teardown() { tr.remove() },
 *   }
 * })
 * ```
 */
/**
 * Internal brand: when `compiled()` produces an SDOM the user setup is also
 * stashed on the SDOM under this symbol. The keyed array reconciler reads it
 * at factory time and, when present, mounts each row by invoking the setup
 * directly — skipping the subscribe / unsub / wrapper-Teardown layer that
 * `compiled()`'s own attach normally allocates per row. The symbol-keyed
 * field is invisible to combinator chaining and the public type.
 */
export const __SDOM_COMPILED_SETUP__: unique symbol = Symbol("sdom.compiledSetup")

export type CompiledSetup<Model, Msg> = (
  parent: Element | DocumentFragment,
  initialModel: Model,
  dispatch: Dispatcher<Msg>,
) => {
  update: (prev: Model, next: Model) => void
  teardown: () => void
}

export function compiled<Model, Msg>(
  setup: CompiledSetup<Model, Msg>,
): SDOM<Model, Msg> {
  const sdom = makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const instance = setup(parent, initialModel, dispatch)
    const unsub = updates.subscribe(({ prev, next }) => {
      instance.update(prev, next)
    })
    return {
      teardown() {
        unsub()
        instance.teardown()
      },
    }
  })
  ;(sdom as unknown as { [__SDOM_COMPILED_SETUP__]: CompiledSetup<Model, Msg> })[
    __SDOM_COMPILED_SETUP__
  ] = setup
  return sdom
}

// ---------------------------------------------------------------------------
// compiledState — state-based variant for codegen
//
// Same idea as `compiled()` but splits the per-row work into three module-scope
// functions sharing a per-row state object. Trades the per-row instance
// `{update, teardown}` literal + two method closures for a single state object
// that the shared functions read and write through. Used by sdomCodegen.
// ---------------------------------------------------------------------------

/**
 * Internal brand: parallels `__SDOM_COMPILED_SETUP__` but carries the
 * three-part {setup, update, teardown} spec produced by `compiledState()`.
 * The keyed array reconciler reads this brand first and, when present,
 * allocates a single per-row state object instead of the legacy
 * setup-returns-instance shape.
 */
export const __SDOM_COMPILED_STATE__: unique symbol = Symbol("sdom.compiledState")

export interface CompiledStateSpec<Model, Msg, State> {
  setup: (
    parent: Element | DocumentFragment,
    initialModel: Model,
    dispatch: Dispatcher<Msg>,
  ) => State
  update: (state: State, prev: Model, next: Model) => void
  teardown: (state: State) => void
}

export function compiledState<Model, Msg, State extends object>(
  spec: CompiledStateSpec<Model, Msg, State>,
): SDOM<Model, Msg> {
  const sdom = makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const state = spec.setup(parent, initialModel, dispatch)
    const unsub = updates.subscribe(({ prev, next }) => {
      spec.update(state, prev, next)
    })
    return {
      teardown() {
        unsub()
        spec.teardown(state)
      },
    }
  })
  ;(sdom as unknown as { [__SDOM_COMPILED_STATE__]: CompiledStateSpec<Model, Msg, State> })[
    __SDOM_COMPILED_STATE__
  ] = spec
  return sdom
}

// ---------------------------------------------------------------------------
// match — discriminated union switch (N-way optional)
// ---------------------------------------------------------------------------

/**
 * Mount one of several SDOM branches based on a discriminant.
 *
 * This is the N-way generalization of `optional`: where `optional` handles
 * binary (present vs. absent), `match` handles N variants with completely
 * different DOM structures per branch.
 *
 * Accepts either a property name (for tagged unions) or a function:
 *
 * @example Tagged union (property name):
 * ```typescript
 * type State =
 *   | { tag: "loading" }
 *   | { tag: "error"; message: string }
 *   | { tag: "loaded"; data: Data }
 *
 * const view = match("tag", {
 *   loading: loadingSpinner,
 *   error: errorPanel,
 *   loaded: dataTable,
 * })
 * ```
 *
 * @example Function discriminant:
 * ```typescript
 * const view = match(m => m.loggedIn ? "auth" : "anon", {
 *   auth: dashboardView,
 *   anon: loginView,
 * })
 * ```
 *
 * **Cost model:**
 * - Same-branch updates: O(leaf changes) — standard static-dom fast path.
 * - Branch switches: O(teardown + mount) — proportional to branch size.
 */
export function match<
  Model extends Record<Tag, string>,
  Tag extends string,
  Msg,
  Branches extends Record<Model[Tag], SDOM<Model, Msg>>,
>(
  discriminant: Tag,
  branches: Branches,
): SDOM<Model, Msg>
export function match<
  Model,
  K extends string,
  Msg,
>(
  discriminant: (model: Model) => K,
  branches: Record<K, SDOM<Model, Msg>>,
): SDOM<Model, Msg>
export function match<Model, Msg>(
  discriminant: string | ((model: Model) => string),
  branches: Record<string, SDOM<Model, Msg>>,
): SDOM<Model, Msg> {
  const getKey: (model: Model) => string =
    typeof discriminant === "function"
      ? discriminant
      : (model: Model) => (model as Record<string, string>)[discriminant]!

  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const anchor = document.createComment("match")
    parent.appendChild(anchor)

    // Capture for deferred branch re-mounts.
    const capturedDelegator = getCurrentDelegator()

    let currentKey = getKey(initialModel)
    let currentTeardown: Teardown | null = null
    // Track DOM nodes inserted by the current branch for removal on switch.
    // Most branches produce a single root element, but fragment children
    // can produce multiple — so we track the list.
    let currentNodes: Node[] = []

    function mountBranch(key: string, model: Model): void {
      const branch = branches[key]
      if (!branch) return

      const fragment = document.createDocumentFragment()
      // Branch update stream: forward updates only when the model's discriminant
      // still matches this branch. We check the model directly (not `currentKey`)
      // because inner subscriptions fire before the outer switch subscriber —
      // without this, a branch would see one final update with the wrong variant
      // shape before being torn down.
      const branchUpdates: UpdateStream<Model> = {
        subscribe(observer) {
          return updates.subscribe(update => {
            if (getKey(update.next) === key) {
              observer(update)
            }
          })
        },
      }
      currentTeardown = withDelegator(capturedDelegator, () =>
        guard("attach", `match branch "${key}"`, () =>
          branch.attach(fragment, model, branchUpdates, dispatch),
          { teardown() {} }
        )
      )

      currentNodes = Array.from(fragment.childNodes)
      anchor.parentNode?.insertBefore(fragment, anchor.nextSibling)
    }

    function unmountBranch(): void {
      currentTeardown?.teardown()
      currentTeardown = null
      for (const node of currentNodes) {
        node.parentNode?.removeChild(node)
      }
      currentNodes = []
    }

    mountBranch(currentKey, initialModel)

    const unsub = updates.subscribe(({ next }) => {
      const nextKey = getKey(next)
      if (nextKey !== currentKey) {
        unmountBranch()
        currentKey = nextKey
        mountBranch(nextKey, next)
      }
    })

    return {
      teardown() {
        unsub()
        unmountBranch()
        anchor.remove()
      },
    }
  })
}

// ---------------------------------------------------------------------------
// dynamic — general structural escape hatch
// ---------------------------------------------------------------------------

/**
 * A general escape hatch for unbounded structural variation.
 *
 * Unlike `match` (which requires a fixed set of branches known at compile
 * time), `dynamic` accepts a factory function that can return any SDOM
 * based on the current model. A key function determines when to remount.
 *
 * @param key      Extracts a cache key from the model. When the key changes
 *                 (by `===`), the current branch is torn down and the factory
 *                 is called to produce a new one.
 * @param factory  Called on mount and on key changes to produce an SDOM.
 * @param options  Optional `{ cache: true }` to reuse previously mounted
 *                 branches rather than rebuilding from scratch on re-entry.
 *
 * @example
 * ```typescript
 * const view = dynamic(
 *   (model: Model) => model.layout,
 *   (model: Model) => {
 *     if (model.layout === "grid") return gridView
 *     if (model.layout === "list") return listView
 *     return buildCustomLayout(model.columns)
 *   },
 * )
 * ```
 *
 * **Cost model:**
 * - Same-key updates: O(leaf changes) — inner SDOM is still static-dom.
 * - Key changes: O(teardown + factory + mount) — full remount.
 * - With `cache: true`, key changes hide/show cached branches instead of
 *   teardown/remount — trades memory for faster switches.
 */
export function dynamic<Model, Msg, K>(
  key: (model: Model) => K,
  factory: (model: Model) => SDOM<Model, Msg>,
  options?: { cache?: boolean },
): SDOM<Model, Msg> {
  const useCache = options?.cache === true

  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const anchor = document.createComment("dynamic")
    parent.appendChild(anchor)

    // Capture for deferred branch re-mounts.
    const capturedDelegator = getCurrentDelegator()

    let currentKeyValue = key(initialModel)
    let currentModel = initialModel
    let currentTeardown: Teardown | null = null
    let currentNodes: Node[] = []

    // Cache: key → { nodes (detached), teardown, lastModel, notify }
    // The `notify` function lets us push a synthetic update into a cached
    // branch when it's re-entered so it catches up to the current model.
    interface CachedBranch {
      nodes: Node[]
      teardown: Teardown
      lastModel: Model
      notify: (update: { prev: Model; next: Model }) => void
    }
    const cache = useCache ? new Map<K, CachedBranch>() : null

    function mountBranch(keyValue: K, model: Model): void {
      // Check cache first — reinsert existing DOM without re-running factory
      if (cache?.has(keyValue)) {
        const cached = cache.get(keyValue)!
        currentTeardown = cached.teardown
        currentNodes = cached.nodes
        const fragment = document.createDocumentFragment()
        for (const node of currentNodes) {
          fragment.appendChild(node)
        }
        anchor.parentNode?.insertBefore(fragment, anchor.nextSibling)

        // Catch the branch up to the current model if it changed while detached
        if (cached.lastModel !== model) {
          cached.notify({ prev: cached.lastModel, next: model })
          cached.lastModel = model
        }
        return
      }

      const sdom = factory(model)
      const fragment = document.createDocumentFragment()

      // Observers registered by the inner branch — used for synthetic notify
      const observers = new Set<Observer<Update<Model>>>()

      // Branch update stream: filter against `currentKeyValue` (closed over)
      // rather than re-calling key() — the outer subscriber already computes
      // the key and updates `currentKeyValue` before switching branches.
      const branchUpdates: UpdateStream<Model> = {
        subscribe(observer) {
          observers.add(observer)
          const unsub = updates.subscribe(update => {
            if (currentKeyValue === keyValue) {
              observer(update)
            }
          })
          return () => {
            observers.delete(observer)
            unsub()
          }
        },
      }

      currentTeardown = withDelegator(capturedDelegator, () =>
        guard("attach", "dynamic branch", () =>
          sdom.attach(fragment, model, branchUpdates, dispatch),
          { teardown() {} }
        )
      )
      currentNodes = Array.from(fragment.childNodes)
      anchor.parentNode?.insertBefore(fragment, anchor.nextSibling)

      if (cache) {
        cache.set(keyValue, {
          nodes: currentNodes,
          teardown: currentTeardown,
          lastModel: model,
          notify: (update) => {
            for (const obs of observers) obs(update)
          },
        })
      }
    }

    function unmountBranch(): void {
      if (!useCache) {
        // Non-cached: full teardown (unsubscribes inner observers)
        currentTeardown?.teardown()
        currentTeardown = null
      }
      // In both modes, detach DOM nodes
      for (const node of currentNodes) {
        node.parentNode?.removeChild(node)
      }
      currentNodes = []
    }

    mountBranch(currentKeyValue, initialModel)

    const unsub = updates.subscribe(({ next }) => {
      currentModel = next
      const nextKeyValue = key(next)
      if (nextKeyValue !== currentKeyValue) {
        // Snapshot lastModel for the outgoing cached branch
        if (cache?.has(currentKeyValue)) {
          cache.get(currentKeyValue)!.lastModel = next
        }
        unmountBranch()
        currentKeyValue = nextKeyValue
        mountBranch(nextKeyValue, next)
      }
    })

    return {
      teardown() {
        unsub()
        if (cache) {
          // Tear down all cached branches (including the active one)
          for (const [, cached] of cache) {
            cached.teardown.teardown()
            for (const node of cached.nodes) {
              node.parentNode?.removeChild(node)
            }
          }
          cache.clear()
        } else {
          currentTeardown?.teardown()
          for (const node of currentNodes) {
            node.parentNode?.removeChild(node)
          }
        }
        anchor.remove()
      },
    }
  })
}

// ---------------------------------------------------------------------------
// wrapChannel — lower SDOMWithChannel to SDOM
// ---------------------------------------------------------------------------

/**
 * Interpret a channel-using component, converting channel events to Msg
 * and/or applying local model transforms.
 *
 * Matches PureScript's `interpretChannel`.
 *
 * The interpreter can:
 *   - Call `dispatch(msg)` for persistent state changes (goes through
 *     the program's update loop — the standard Elm architecture path).
 *   - Return a model transform for immediate local feedback (applied
 *     optimistically; overwritten on the next outer model update).
 *
 * "update" kind channel events carry a model transform directly and
 * are applied the same way.
 *
 * @param inner      A component that emits `ChannelEvent<Channel, Model>`.
 * @param interpret  Maps parent channel events to model transforms or Msg values.
 */
export function wrapChannel<Channel, Model, Msg>(
  inner: SDOMWithChannel<Channel, Model>,
  interpret: (
    channel: Channel,
    dispatch: Dispatcher<Msg>
  ) => ((model: Model) => Model) | null
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    // Local model state — tracks the latest model from either outer updates
    // or local transforms. Outer updates are authoritative and reset this.
    let currentModel = initialModel
    const localObservers = new Set<Observer<Update<Model>>>()

    // Merged update stream: inner component sees both outer updates and
    // local transforms from channel events.
    const mergedUpdates: UpdateStream<Model> = {
      subscribe(observer) {
        localObservers.add(observer)
        const outerUnsub = updates.subscribe(update => {
          currentModel = update.next
          observer(update)
        })
        return () => {
          localObservers.delete(observer)
          outerUnsub()
        }
      },
    }

    function applyTransform(fn: (model: Model) => Model): void {
      const prev = currentModel
      const next = fn(prev)
      if (prev !== next) {
        currentModel = next
        localObservers.forEach(obs => obs({ prev, next }))
      }
    }

    const channelDispatch: Dispatcher<ChannelEvent<Channel, Model>> = event => {
      if (event.kind === "parent") {
        const transform = interpret(event.value, dispatch)
        if (transform) applyTransform(transform)
      } else {
        applyTransform(event.fn)
      }
    }

    return inner.attach(parent, initialModel, mergedUpdates, channelDispatch)
  })
}

// ---------------------------------------------------------------------------
// fragment — group multiple SDOMs without a wrapper element
// ---------------------------------------------------------------------------

/**
 * Mount multiple SDOM nodes without adding a wrapper element to the DOM.
 *
 * The nodes are mounted into a DocumentFragment initially, then appended.
 * All share the same model and dispatcher.
 */
export function fragment<Model, Msg>(
  children: NoInfer<SDOM<Model, Msg>>[]
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const frag = document.createDocumentFragment()
    const teardowns = children.map(child =>
      child.attach(frag, initialModel, updates, dispatch)
    )
    parent.appendChild(frag)

    return {
      teardown() {
        teardowns.forEach(t => t.teardown())
      },
    }
  })
}

/** @deprecated Import from `./reconcile` instead. Re-exported for backward compatibility. */
export const lis = lisImpl

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert the user-friendly `AttrInput` object into a flat list of
 * `SDOMAttr` descriptors for efficient mounting.
 */
function buildAttrList<Tag extends keyof HTMLElementTagNameMap, Model, Msg>(
  input: AttrInput<Tag, Model, Msg>
): SDOMAttr<Model, Msg>[] {
  const list: SDOMAttr<Model, Msg>[] = []

  if (input.attrs) {
    for (const [name, valueFn] of Object.entries(input.attrs)) {
      if (valueFn == null) continue
      list.push({ kind: "prop", name, value: valueFn as (m: Model) => string })
    }
  }

  if (input.on) {
    for (const [name, handler] of Object.entries(input.on)) {
      if (handler == null) continue
      list.push({
        kind: "event",
        name,
        handler: handler as (e: Event, m: Model) => Msg | null,
      })
    }
  }

  if (input.classes) {
    list.push({ kind: "classMap", map: input.classes as (m: Model) => Record<string, boolean> })
  }

  if (input.style) {
    for (const [property, valueFn] of Object.entries(input.style)) {
      list.push({ kind: "style", property, value: valueFn as (m: Model) => string })
    }
  }

  if (input.rawAttrs) {
    for (const [name, valueFn] of Object.entries(input.rawAttrs)) {
      list.push({ kind: "string", name, value: valueFn as (m: Model) => string })
    }
  }

  return list
}


/** @internal Exported for jsx-runtime compiled templates. */
export function applyClassMap(
  el: Element,
  nextMap: Record<string, boolean>,
  prevMap?: Record<string, boolean>
): void {
  // Fast path: initial render — no prevMap, just add truthy classes directly.
  // Avoids Set allocation and Object.keys on an empty prev.
  if (!prevMap) {
    const keys = Object.keys(nextMap)
    for (let i = 0; i < keys.length; i++) {
      if (nextMap[keys[i]!]) el.classList.add(keys[i]!)
    }
    return
  }

  const allKeys = new Set([
    ...Object.keys(nextMap),
    ...Object.keys(prevMap),
  ])
  for (const cls of allKeys) {
    const shouldHave = nextMap[cls] ?? false
    const hadBefore = prevMap[cls] ?? false
    if (shouldHave !== hadBefore) {
      el.classList.toggle(cls, shouldHave)
    }
  }
}
