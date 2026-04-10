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
import type { Prism } from "./optics"
import { guard, guardFn, guardFn2, __SDOM_GUARD__ } from "./errors"
import { __SDOM_DEV__, validateModelShape, validateUniqueKeys } from "./dev"

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
    const safeValue = guardFn("attach", "text derive", value, "")
    let lastText = safeValue(initialModel)
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

  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
    const el = document.createElement(tag) as HTMLElementTagNameMap[Tag] & Element

    const childTeardowns: Teardown[] = []
    const checkShape = validateModelShape(`element<"${tag}">`, initialModel)

    // ── Attr setup: initial values + build per-attr updaters ──
    // Instead of one subscription per attr (N subscriptions), we build
    // updater functions at mount time and call them from a single subscription.
    const attrUpdaters: Array<(prev: Model, next: Model) => void> = []
    const eventTeardowns: Array<() => void> = []

    for (const rawAttr of attrList) {
      const attr = rawAttr as SDOMAttr<Model, Msg>
      switch (attr.kind) {
        case "string": {
          // Cache last-written value in JS — avoids DOM read (getAttribute) on every tick
          let lastVal = guard("attach", `attr "${attr.name}"`, () => attr.value(initialModel), "")
          el.setAttribute(attr.name, lastVal)
          const derive = attr.value
          const name = attr.name
          attrUpdaters.push((_prev, next) => {
            const v = __SDOM_GUARD__
              ? guard("update", `attr "${name}"`, () => derive(next), "")
              : derive(next)
            if (v !== lastVal) { lastVal = v; el.setAttribute(name, v) }
          })
          break
        }
        case "bool": {
          let lastVal = guard("attach", `attr "${attr.name}"`, () => attr.value(initialModel), false)
          el.toggleAttribute(attr.name, lastVal)
          const derive = attr.value
          const name = attr.name
          attrUpdaters.push((_prev, next) => {
            const v = __SDOM_GUARD__
              ? guard("update", `attr "${name}"`, () => derive(next), false)
              : derive(next)
            if (v !== lastVal) { lastVal = v; el.toggleAttribute(name, v) }
          })
          break
        }
        case "prop": {
          let lastVal: string | boolean | number = guard("attach", `prop "${attr.name}"`, () => attr.value(initialModel), "")
          ;(el as any)[attr.name] = lastVal
          const derive = attr.value
          const name = attr.name
          attrUpdaters.push((_prev, next) => {
            const v = __SDOM_GUARD__
              ? guard("update", `prop "${name}"`, () => derive(next), "")
              : derive(next)
            if (v !== lastVal) { lastVal = v; (el as any)[name] = v }
          })
          break
        }
        case "style": {
          let lastVal = guard("attach", `style "${attr.property}"`, () => attr.value(initialModel), "")
          ;(el as HTMLElement).style.setProperty(attr.property, lastVal)
          const derive = attr.value
          const prop = attr.property
          attrUpdaters.push((_prev, next) => {
            const v = __SDOM_GUARD__
              ? guard("update", `style "${prop}"`, () => derive(next), "")
              : derive(next)
            if (v !== lastVal) { lastVal = v; (el as HTMLElement).style.setProperty(prop, v) }
          })
          break
        }
        case "classMap": {
          const emptyMap: Record<string, boolean> = {}
          let lastMap = guard("attach", "classMap", () => attr.map(initialModel), emptyMap)
          applyClassMap(el, lastMap)
          const derive = attr.map
          attrUpdaters.push((_prev, next) => {
            const nextMap = __SDOM_GUARD__
              ? guard("update", "classMap", () => derive(next), emptyMap)
              : derive(next)
            if (nextMap !== lastMap) { applyClassMap(el, nextMap, lastMap); lastMap = nextMap }
          })
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
          el.addEventListener(name, handler)
          attrUpdaters.push((_prev, next) => { ref.current = next })
          eventTeardowns.push(() => el.removeEventListener(name, handler))
          break
        }
      }
    }

    // ── Single subscription for all attrs ──
    // One observer callback that runs all updaters in a tight loop.
    // This replaces N separate subscriptions (one per attr).
    let attrUnsub: (() => void) | null = null
    const nUpdaters = attrUpdaters.length
    if (nUpdaters > 0) {
      attrUnsub = updates.subscribe(({ prev, next }) => {
        if (__SDOM_DEV__) checkShape(next)
        for (let i = 0; i < nUpdaters; i++) {
          attrUpdaters[i]!(prev, next)
        }
      })
    }

    // ── Children: still get the full update stream ──
    // Children are separate SDOM trees with their own subscriptions.
    // They subscribe to `updates` directly (not through the attr subscription).
    for (let i = 0; i < children.length; i++) {
      const td = guard("attach", `element<${tag}> child[${i}]`, () =>
        children[i]!.attach(el, initialModel, updates, dispatch),
        { teardown() {} }
      )
      childTeardowns.push(td)
    }

    parent.appendChild(el)

    return {
      teardown() {
        attrUnsub?.()
        eventTeardowns.forEach(fn => fn())
        childTeardowns.forEach(t => t.teardown())
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

    // Map from key → { markers, teardown, model ref, observer(s) }
    // No wrapper div — items attach directly to the container.
    // Comment markers delimit each item's DOM range.
    // Single-observer fast path: store first subscriber directly, avoid Set.
    type ItemEntry = {
      startMarker: Comment
      endMarker: Comment
      teardown: Teardown
      modelRef: { current: ItemModel }
      observer: Observer<Update<ItemModel>> | null
      observers: Set<Observer<Update<ItemModel>>> | null
      update: { prev: ItemModel; next: ItemModel }
    }
    const liveItems = new Map<string, ItemEntry>()

    function mountItem(key: string, itemModel: ItemModel): void {
      const startMarker = document.createComment(`s:${key}`)
      const endMarker = document.createComment(`e:${key}`)

      const modelRef = { current: itemModel }
      const update = { prev: itemModel, next: itemModel }

      const entry: ItemEntry = {
        startMarker, endMarker, teardown: { teardown() {} }, modelRef,
        observer: null, observers: null, update,
      }
      liveItems.set(key, entry)

      // Item update stream with single-observer fast path
      const itemUpdates: UpdateStream<ItemModel> = {
        subscribe(observer) {
          if (entry.observer === null && entry.observers === null) {
            entry.observer = observer
          } else {
            if (entry.observers === null) {
              entry.observers = new Set()
              if (entry.observer) {
                entry.observers.add(entry.observer)
                entry.observer = null
              }
            }
            entry.observers.add(observer)
          }
          return () => {
            if (entry.observer === observer) {
              entry.observer = null
            } else if (entry.observers) {
              entry.observers.delete(observer)
            }
          }
        },
      }

      // Build item in a fragment: [startMarker, ...content, endMarker]
      const frag = document.createDocumentFragment()
      frag.appendChild(startMarker)

      entry.teardown = guard("attach", `array item "${key}"`, () =>
        itemSdom.attach(frag, itemModel, itemUpdates, dispatch),
        { teardown() {} }
      )

      frag.appendChild(endMarker)
      container.appendChild(frag)
    }

    function pushItemUpdate(entry: ItemEntry, prevModel: ItemModel, itemModel: ItemModel): void {
      entry.modelRef.current = itemModel
      entry.update.prev = prevModel
      entry.update.next = itemModel
      if (entry.observer) {
        entry.observer(entry.update)
      } else if (entry.observers) {
        entry.observers.forEach(obs => obs(entry.update))
      }
    }

    /** Move all nodes in [startMarker..endMarker] before `ref`. */
    function moveItemBefore(entry: ItemEntry, ref: ChildNode | null): void {
      let node: ChildNode | null = entry.startMarker
      const end = entry.endMarker
      while (node !== null) {
        const next: ChildNode | null = node.nextSibling
        container.insertBefore(node, ref)
        if (node === end) break
        node = next
      }
    }

    /** Remove an item: teardown (removes content nodes) + remove markers. */
    function removeItem(key: string): void {
      const entry = liveItems.get(key)
      if (!entry) return
      entry.teardown.teardown()
      // Teardown removes content nodes; markers remain — remove them.
      entry.startMarker.remove()
      entry.endMarker.remove()
      liveItems.delete(key)
    }

    function reconcile(_prev: Model, next: Model): void {
      const nextItems = getItems(next)

      validateUniqueKeys(nextItems.map(i => i.key), "array")

      // Build next key set for removal check — O(n)
      const nextByKey = new Map<string, ItemModel>()
      for (const item of nextItems) nextByKey.set(item.key, item.model)

      // 1. Remove items no longer present
      for (const [key] of liveItems) {
        if (!nextByKey.has(key)) removeItem(key)
      }

      // 2. Mount new items + fan out updates to existing items
      // Use liveItems.modelRef for previous model — avoids building prevByKey map
      for (const { key, model: itemModel } of nextItems) {
        const entry = liveItems.get(key)
        if (!entry) {
          mountItem(key, itemModel)
        } else if (entry.modelRef.current !== itemModel) {
          pushItemUpdate(entry, entry.modelRef.current, itemModel)
        }
      }

      // 3. Ensure DOM order — cursor-based walk over markers
      let cursor: ChildNode | null = container.firstChild
      for (let i = 0; i < nextItems.length; i++) {
        const entry = liveItems.get(nextItems[i]!.key)!
        if (entry.startMarker === cursor) {
          // Already in position — skip past this item
          cursor = entry.endMarker.nextSibling
        } else {
          // Out of position — move before cursor
          moveItemBefore(entry, cursor)
        }
      }
    }

    // Initial mount
    reconcile(initialModel, initialModel)

    const unsub = updates.subscribe(({ prev, next }) => reconcile(prev, next))

    return {
      teardown() {
        unsub()
        for (const { teardown: td, startMarker, endMarker } of liveItems.values()) {
          td.teardown()
          startMarker.remove()
          endMarker.remove()
        }
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
      currentTeardown = guard("attach", "optional inner", () =>
        inner.attach(fragment, subModel, subUpdates, dispatch),
        { teardown() {} }
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
