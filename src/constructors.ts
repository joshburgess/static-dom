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
import type { UpdateStream, Dispatcher } from "./observable"
import type { Prism } from "./optics"

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
    const node = document.createTextNode(value(initialModel))
    parent.appendChild(node)

    const unsub = updates.subscribe(({ next }) => {
      const nextText = value(next)
      if (node.textContent !== nextText) {
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

  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const el = document.createElement(tag) as HTMLElementTagNameMap[Tag] & Element

    const teardowns: Teardown[] = []

    // Apply initial attribute values and set up subscriptions
    for (const attr of attrList) {
      teardowns.push(
        mountAttr(attr as SDOMAttr<Model, Msg>, el, initialModel, updates, dispatch)
      )
    }

    // Mount children — static structure, mounted once
    for (const child of children) {
      teardowns.push(child.attach(el, initialModel, updates, dispatch))
    }

    parent.appendChild(el)

    return {
      teardown() {
        teardowns.forEach(t => t.teardown())
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

    // Ordered list of live item keys (for position reconciliation)
    let liveOrder: string[] = []

    // Map from key → { wrapper element, teardown, mutable model ref }
    const liveItems = new Map<string, {
      wrapper: Element
      teardown: Teardown
      /** Mutable ref — updated when the array item model changes. */
      modelRef: { current: ItemModel }
    }>()

    function mountItem(key: string, itemModel: ItemModel): void {
      const wrapper = document.createElement("div")
      wrapper.dataset["sdKey"] = key

      const modelRef = { current: itemModel }

      // Each item has its own update stream derived from the parent's
      const itemUpdates: UpdateStream<ItemModel> = {
        subscribe(observer) {
          return updates.subscribe(({ prev, next }) => {
            const prevItems = getItems(prev)
            const nextItems = getItems(next)
            const prevEntry = prevItems.find(i => i.key === key)
            const nextEntry = nextItems.find(i => i.key === key)

            if (nextEntry && prevEntry?.model !== nextEntry.model) {
              const prevModel = prevEntry?.model ?? modelRef.current
              modelRef.current = nextEntry.model
              observer({ prev: prevModel, next: nextEntry.model })
            }
          })
        },
      }

      const td = itemSdom.attach(wrapper, itemModel, itemUpdates, dispatch)
      liveItems.set(key, { wrapper, teardown: td, modelRef })
    }

    function reconcile(model: Model): void {
      const nextItems = getItems(model)
      const nextKeys = new Set(nextItems.map(i => i.key))

      // 1. Remove items that are no longer present
      for (const [key, { wrapper, teardown }] of liveItems) {
        if (!nextKeys.has(key)) {
          teardown.teardown()
          wrapper.remove()
          liveItems.delete(key)
        }
      }

      // 2. Mount new items
      for (const { key, model: itemModel } of nextItems) {
        if (!liveItems.has(key)) {
          mountItem(key, itemModel)
        }
      }

      // 3. Ensure DOM order matches nextItems
      nextItems.forEach(({ key }, index) => {
        const { wrapper } = liveItems.get(key)!
        const currentAtIndex = container.children[index]
        if (currentAtIndex !== wrapper) {
          container.insertBefore(wrapper, currentAtIndex ?? null)
        }
      })

      liveOrder = nextItems.map(i => i.key)
    }

    // Initial mount
    reconcile(initialModel)

    const unsub = updates.subscribe(({ next }) => reconcile(next))

    return {
      teardown() {
        unsub()
        for (const { teardown: td } of liveItems.values()) td.teardown()
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
  prism: Prism<Model, SubModel>,
  inner: SDOM<SubModel, Msg>
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    // A stable anchor so we know where to insert/remove the optional content
    const anchor = document.createComment("optional")
    parent.appendChild(anchor)

    let currentTeardown: Teardown | null = null
    let currentSubModel: SubModel | null = prism.preview(initialModel)

    function mount(subModel: SubModel): void {
      const fragment = document.createDocumentFragment()
      const subUpdates: UpdateStream<SubModel> = {
        subscribe(observer) {
          return updates.subscribe(({ prev, next }) => {
            const prevSub = prism.preview(prev)
            const nextSub = prism.preview(next)
            if (nextSub !== null && prevSub !== nextSub) {
              observer({ prev: prevSub ?? subModel, next: nextSub })
            }
          })
        },
      }
      currentTeardown = inner.attach(fragment, subModel, subUpdates, dispatch)
      anchor.parentNode?.insertBefore(fragment, anchor.nextSibling)
    }

    function unmount(): void {
      currentTeardown?.teardown()
      currentTeardown = null
    }

    if (currentSubModel !== null) {
      mount(currentSubModel)
    }

    const unsub = updates.subscribe(({ next }) => {
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

    const instance = setup(el, initialModel, dispatch)

    const unsub = updates.subscribe(({ next }) => instance.update(next))

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
// wrapChannel — lower SDOMWithChannel to SDOM
// ---------------------------------------------------------------------------

/**
 * Interpret a channel-using component, converting channel events to Msg.
 *
 * Matches PureScript's `interpretChannel`.
 *
 * @param inner    A component that emits `ChannelEvent<Channel, Model>`.
 * @param interpret  Maps channel events to model updates or Msg values.
 *
 * Example — an array item that can "remove itself":
 *   type ItemChannel = "remove"
 *
 *   const item: SDOMWithChannel<ItemChannel, Item> = ...
 *
 *   wrapChannel(item, (channel, _dispatch) => {
 *     if (channel === "remove") return msg => ({ ...msg, removeId: currentKey })
 *     return null
 *   })
 */
export function wrapChannel<Channel, Model, Msg>(
  inner: SDOMWithChannel<Channel, Model>,
  interpret: (
    channel: Channel,
    dispatch: Dispatcher<Msg>
  ) => ((model: Model) => Model) | null
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const channelDispatch: Dispatcher<ChannelEvent<Channel, Model>> = event => {
      if (event.kind === "parent") {
        // Channel event — pass to interpreter
        const update = interpret(event.value, dispatch)
        // If the interpreter returns a model transform, we'd need to feed it
        // back to the store. In a full implementation this connects to the
        // top-level update loop. For now, this is a hook point.
        // (In practice, you'd call your store's dispatch here.)
        void update
      }
      // "update" events are handled by the update loop externally
    }

    return inner.attach(parent, initialModel, updates, channelDispatch)
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

/** Mount a single SDOMAttr onto a DOM element and subscribe to updates. */
function mountAttr<Model, Msg>(
  attr: SDOMAttr<Model, Msg>,
  el: Element,
  initialModel: Model,
  updates: UpdateStream<Model>,
  dispatch: Dispatcher<Msg>
): Teardown {
  switch (attr.kind) {
    case "string": {
      el.setAttribute(attr.name, attr.value(initialModel))
      const unsub = updates.subscribe(({ next }) => {
        const v = attr.value(next)
        if (el.getAttribute(attr.name) !== v) el.setAttribute(attr.name, v)
      })
      return { teardown: unsub }
    }

    case "bool": {
      el.toggleAttribute(attr.name, attr.value(initialModel))
      const unsub = updates.subscribe(({ next }) => {
        el.toggleAttribute(attr.name, attr.value(next))
      })
      return { teardown: unsub }
    }

    case "prop": {
      ;(el as any)[attr.name] = attr.value(initialModel)
      const unsub = updates.subscribe(({ next }) => {
        const v = attr.value(next)
        if ((el as any)[attr.name] !== v) {
          ;(el as any)[attr.name] = v
        }
      })
      return { teardown: unsub }
    }

    case "style": {
      ;(el as HTMLElement).style.setProperty(attr.property, attr.value(initialModel))
      const unsub = updates.subscribe(({ next }) => {
        ;(el as HTMLElement).style.setProperty(attr.property, attr.value(next))
      })
      return { teardown: unsub }
    }

    case "classMap": {
      applyClassMap(el, attr.map(initialModel))
      const unsub = updates.subscribe(({ prev, next }) => {
        const prevMap = attr.map(prev)
        const nextMap = attr.map(next)
        // Only diff if the map reference changed
        if (prevMap !== nextMap) applyClassMap(el, nextMap, prevMap)
      })
      return { teardown: unsub }
    }

    case "event": {
      // We close over a mutable model ref so the handler always sees
      // the current model without subscribing to the update stream.
      let currentModel = initialModel
      const modelUnsub = updates.subscribe(({ next }) => { currentModel = next })

      const handler = (event: Event) => {
        const msg = attr.handler(event, currentModel)
        if (msg !== null) dispatch(msg)
      }

      el.addEventListener(attr.name, handler)

      return {
        teardown() {
          el.removeEventListener(attr.name, handler)
          modelUnsub()
        },
      }
    }
  }
}

function applyClassMap(
  el: Element,
  nextMap: Record<string, boolean>,
  prevMap?: Record<string, boolean>
): void {
  const allKeys = new Set([
    ...Object.keys(nextMap),
    ...(prevMap ? Object.keys(prevMap) : []),
  ])
  for (const cls of allKeys) {
    const shouldHave = nextMap[cls] ?? false
    const hadBefore = prevMap?.[cls] ?? false
    if (shouldHave !== hadBefore) {
      el.classList.toggle(cls, shouldHave)
    }
  }
}
