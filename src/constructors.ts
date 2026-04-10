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
  lastVal: any
  constructor(
    readonly el: any,
    readonly name: string,
    readonly label: string,
    readonly derive: (m: M) => any,
    readonly fallback: any,
    initial: any,
  ) { this.lastVal = initial; el[name] = initial }
  run(_p: M, n: M): void {
    const v = __SDOM_GUARD__
      ? guard("update", this.label, () => this.derive(n), this.fallback)
      : this.derive(n)
    if (v !== this.lastVal) { this.lastVal = v; this.el[this.name] = v }
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
          el.addEventListener(name, handler)
          attrUpdaters.push(new EventRefUpdater<Model>(ref))
          eventTeardowns.push(() => el.removeEventListener(name, handler))
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

    // Map from key → { markers, teardown, model ref, observer(s) }
    // No wrapper div — items attach directly to the container.
    // Comment markers delimit each item's DOM range for reconciliation.
    // On initial mount, markers are deferred — items append directly.
    // Single-observer fast path: store first subscriber directly, avoid Set.
    type ItemEntry = {
      startMarker: Comment | null
      endMarker: Comment | null
      teardown: Teardown
      modelRef: { current: ItemModel }
      observer: Observer<Update<ItemModel>> | null
      observers: Set<Observer<Update<ItemModel>>> | null
      update: { prev: ItemModel; next: ItemModel }
    }
    const liveItems = new Map<string, ItemEntry>()

    // Shared UpdateStream — avoids per-row function object allocation.
    // `currentMountEntry` is set by the mount functions before calling
    // itemSdom.attach(), so subscribe captures the correct entry.
    let currentMountEntry: ItemEntry | null = null
    const sharedUpdateStream: UpdateStream<ItemModel> = {
      subscribe(observer) {
        const entry = currentMountEntry!
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

    /** Mount an item during initial render — no markers, no fragment. */
    function mountItemInitial(key: string, itemModel: ItemModel): void {
      const modelRef = { current: itemModel }
      const update = { prev: itemModel, next: itemModel }
      const entry: ItemEntry = {
        startMarker: null, endMarker: null,
        teardown: { teardown() {} }, modelRef,
        observer: null, observers: null, update,
      }
      liveItems.set(key, entry)

      // Track the first node this item will add (for lazy marker insertion)
      const lastBefore = container.lastChild

      currentMountEntry = entry
      entry.teardown = guard("attach", `array item "${key}"`, () =>
        itemSdom.attach(container, itemModel, sharedUpdateStream, dispatch),
        { teardown() {} }
      )
      currentMountEntry = null

      // Record the first node added by this item
      const firstNode = lastBefore ? lastBefore.nextSibling : container.firstChild
      if (firstNode) itemFirstNodes.set(key, firstNode)
    }

    /** Mount an item during reconciliation — with markers for reordering. */
    function mountItemFull(key: string, itemModel: ItemModel): void {
      const startMarker = document.createComment(`s:${key}`)
      const endMarker = document.createComment(`e:${key}`)

      const modelRef = { current: itemModel }
      const update = { prev: itemModel, next: itemModel }
      const entry: ItemEntry = {
        startMarker, endMarker,
        teardown: { teardown() {} }, modelRef,
        observer: null, observers: null, update,
      }
      liveItems.set(key, entry)

      const frag = document.createDocumentFragment()
      frag.appendChild(startMarker)

      currentMountEntry = entry
      entry.teardown = guard("attach", `array item "${key}"`, () =>
        itemSdom.attach(frag, itemModel, sharedUpdateStream, dispatch),
        { teardown() {} }
      )
      currentMountEntry = null

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

    // --- Lazy marker insertion ---
    // Items from initial mount have no markers. Before the first reconcile,
    // we retroactively insert markers around every markerless item.
    // This keeps initial render fast while supporting correct reconciliation.
    //
    // Approach: track each item's first DOM node at mount time. To insert
    // markers, walk items in order, using the stored firstNode references
    // as anchors. Each item's startMarker goes before its firstNode, and
    // its endMarker goes before the next item's startMarker (or at the end).
    let markersInserted = false
    const itemFirstNodes = new Map<string, ChildNode>()

    function ensureMarkers(): void {
      if (markersInserted) return
      markersInserted = true

      const entries = Array.from(liveItems.entries())
      // First pass: insert all startMarkers before each item's first node
      for (const [key, entry] of entries) {
        if (entry.startMarker !== null) continue
        const firstNode = itemFirstNodes.get(key)
        if (!firstNode) continue

        const start = document.createComment(`s:${key}`)
        entry.startMarker = start
        container.insertBefore(start, firstNode)
      }

      // Second pass: insert endMarkers after each item's last node.
      // Each endMarker goes right before the next item's startMarker,
      // or at the end of the container.
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]![1]
        if (entry.endMarker !== null) continue

        const end = document.createComment(`e:${entries[i]![0]}`)
        entry.endMarker = end

        const nextEntry = i + 1 < entries.length ? entries[i + 1]![1] : null
        const ref = nextEntry?.startMarker ?? null
        container.insertBefore(end, ref)
      }

      itemFirstNodes.clear()
    }

    /** Move all nodes in [startMarker..endMarker] before `ref`. */
    function moveItemBefore(entry: ItemEntry, ref: ChildNode | null): void {
      let node: ChildNode | null = entry.startMarker!
      const end = entry.endMarker!
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
      entry.startMarker?.remove()
      entry.endMarker?.remove()
      liveItems.delete(key)
    }

    // Cache the previous items for fast-path detection.
    let prevItems: KeyedItem<ItemModel>[] | null = null

    function reconcile(_prev: Model, next: Model): void {
      const nextItems = getItems(next)

      if (__SDOM_DEV__) validateUniqueKeys(nextItems.map(i => i.key), "array")

      // ── Fast path: same keys, same order → update-only ──────────
      // When the item list has identical keys in identical order (the common
      // case for partial updates), skip all Map building, removal checks,
      // LIS computation, and reorder logic. Just dispatch updates.
      if (prevItems !== null && nextItems.length === prevItems.length) {
        let sameStructure = true
        for (let i = 0; i < nextItems.length; i++) {
          if (nextItems[i]!.key !== prevItems[i]!.key) {
            sameStructure = false
            break
          }
        }
        if (sameStructure) {
          for (let i = 0; i < nextItems.length; i++) {
            const { key, model: itemModel } = nextItems[i]!
            const entry = liveItems.get(key)!
            if (entry.modelRef.current !== itemModel) {
              pushItemUpdate(entry, entry.modelRef.current, itemModel)
            }
          }
          prevItems = nextItems
          return
        }
      }

      // ── Fast path: append-only ──────────────────────────────────
      // When new items are appended at the end and existing items haven't
      // changed order, skip full reconciliation. Just update existing items
      // and mount the new ones.
      if (prevItems !== null && nextItems.length > prevItems.length) {
        let isAppend = true
        for (let i = 0; i < prevItems.length; i++) {
          if (nextItems[i]!.key !== prevItems[i]!.key) {
            isAppend = false
            break
          }
        }
        if (isAppend) {
          // Update existing items
          for (let i = 0; i < prevItems.length; i++) {
            const { key, model: itemModel } = nextItems[i]!
            const entry = liveItems.get(key)!
            if (entry.modelRef.current !== itemModel) {
              pushItemUpdate(entry, entry.modelRef.current, itemModel)
            }
          }
          // Mount new items
          ensureMarkers()
          for (let i = prevItems.length; i < nextItems.length; i++) {
            mountItemFull(nextItems[i]!.key, nextItems[i]!.model)
          }
          prevItems = nextItems
          return
        }
      }

      // ── Full reconciliation ─────────────────────────────────────

      // ── Fast path: clear all ────────────────────────────────────
      // When the new list is empty, skip marker insertion and per-item
      // removal — just teardown everything and bulk-clear the container.
      if (nextItems.length === 0 && liveItems.size > 0) {
        for (const { teardown: td } of liveItems.values()) td.teardown()
        container.textContent = ""
        liveItems.clear()
        markersInserted = false
        itemFirstNodes.clear()
        prevItems = nextItems
        return
      }

      // Build next key set for removal check — O(n)
      const nextByKey = new Map<string, ItemModel>()
      for (const item of nextItems) nextByKey.set(item.key, item.model)

      // ── Fast path: full replacement ─────────────────────────────
      // When no old keys survive, skip per-item removal + markers and
      // use the fast initial mount path (no markers, no fragment).
      // Must run BEFORE ensureMarkers() to avoid inserting markers
      // that would be immediately cleared.
      if (liveItems.size > 0 && nextItems.length > 0) {
        let noOverlap = true
        for (const [key] of liveItems) {
          if (nextByKey.has(key)) { noOverlap = false; break }
        }
        if (noOverlap) {
          // Teardown all items (cleanup observers/signals)
          for (const { teardown: td } of liveItems.values()) td.teardown()
          // Bulk clear DOM — faster than per-item marker/node removal
          container.textContent = ""
          liveItems.clear()
          markersInserted = false
          itemFirstNodes.clear()
          // Mount all new items using initial fast path (no markers)
          for (let i = 0; i < nextItems.length; i++) {
            mountItemInitial(nextItems[i]!.key, nextItems[i]!.model)
          }
          prevItems = nextItems
          return
        }
      }

      // Lazily insert markers around items from initial mount
      // (only needed for partial structural changes, not full replacement)
      ensureMarkers()

      // 1. Remove items no longer present
      for (const [key] of liveItems) {
        if (!nextByKey.has(key)) removeItem(key)
      }

      // 2. Mount new items + fan out updates to existing items
      for (const { key, model: itemModel } of nextItems) {
        const entry = liveItems.get(key)
        if (!entry) {
          mountItemFull(key, itemModel)
        } else if (entry.modelRef.current !== itemModel) {
          pushItemUpdate(entry, entry.modelRef.current, itemModel)
        }
      }

      // 3. Reorder using LIS (from Inferno) for minimum DOM moves.
      const oldPos = new Map<string, number>()
      let posIdx = 0
      for (const [key] of liveItems) {
        if (nextByKey.has(key)) oldPos.set(key, posIdx++)
      }

      const positions: number[] = []
      const posKeys: string[] = []
      for (const { key } of nextItems) {
        const p = oldPos.get(key)
        if (p !== undefined) {
          positions.push(p)
          posKeys.push(key)
        }
      }

      if (positions.length > 0) {
        const lisResult = lis(positions)
        const lisSet = new Set<number>()
        for (const idx of lisResult) lisSet.add(idx)

        let lastPlaced: ChildNode | null = null
        let seqIdx = posKeys.length - 1
        for (let i = nextItems.length - 1; i >= 0; i--) {
          const entry = liveItems.get(nextItems[i]!.key)!
          if (seqIdx >= 0 && nextItems[i]!.key === posKeys[seqIdx]) {
            if (!lisSet.has(seqIdx)) {
              moveItemBefore(entry, lastPlaced)
            }
            seqIdx--
          } else {
            moveItemBefore(entry, lastPlaced)
          }
          lastPlaced = entry.startMarker
        }
      }

      prevItems = nextItems
    }

    // Initial mount — fast path: no markers, no fragment, no reconcile overhead
    {
      const initialItems = getItems(initialModel)
      for (let i = 0; i < initialItems.length; i++) {
        const item = initialItems[i]!
        mountItemInitial(item.key, item.model)
      }
      prevItems = initialItems
    }

    const unsub = updates.subscribe(({ prev, next }) => reconcile(prev, next))

    return {
      teardown() {
        unsub()
        for (const { teardown: td, startMarker, endMarker } of liveItems.values()) {
          td.teardown()
          startMarker?.remove()
          endMarker?.remove()
        }
        container.remove()
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

      slot.teardown = itemSdom.attach(container, itemModel, itemUpdates, dispatch)
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
export function compiled<Model, Msg>(
  setup: (
    parent: Element | DocumentFragment,
    initialModel: Model,
    dispatch: Dispatcher<Msg>
  ) => {
    update: (prev: Model, next: Model) => void
    teardown: () => void
  }
): SDOM<Model, Msg> {
  return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
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
// LIS — Longest Increasing Subsequence (from Inferno)
//
// Used in array reconciliation to find the maximum set of items that are
// already in correct relative order. Only items NOT in the LIS need DOM
// moves, minimizing expensive insertBefore calls.
//
// Time: O(n log n)  Space: O(n)
// ---------------------------------------------------------------------------

/**
 * Compute the longest increasing subsequence of `arr`.
 * Returns indices into `arr` that form the LIS, in order.
 */
export function lis(arr: number[]): number[] {
  const n = arr.length
  if (n === 0) return []

  // tails[i] = smallest value ending an IS of length i+1
  const tails: number[] = []
  // tailIdx[i] = index in arr where tails[i] lives
  const tailIdx: number[] = []
  // prev[i] = predecessor index in the LIS chain for arr[i]
  const prev = new Int32Array(n).fill(-1)

  for (let i = 0; i < n; i++) {
    const val = arr[i]!
    // Binary search: leftmost position in tails >= val
    let lo = 0, hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tails[mid]! < val) lo = mid + 1
      else hi = mid
    }

    tails[lo] = val
    tailIdx[lo] = i
    prev[i] = lo > 0 ? tailIdx[lo - 1]! : -1
  }

  // Reconstruct: walk backwards from the tail of the longest chain
  const result = new Array<number>(tails.length)
  let k = tailIdx[tails.length - 1]!
  for (let i = tails.length - 1; i >= 0; i--) {
    result[i] = k
    k = prev[k]!
  }

  return result
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
