/**
 * types.ts
 *
 * The core SDOM type hierarchy.
 *
 * We use the "final encoding" from the blog post — each SDOM value IS
 * its setup function — but wrap it in a branded interface so we can
 * add combinators as methods and the type is opaque to consumers.
 *
 * ─────────────────────────────────────────────────────────────────────
 * TYPE PARAMETERS
 * ─────────────────────────────────────────────────────────────────────
 *
 *   Model  — the slice of application state this component reads.
 *   Msg    — the type of messages this component can emit upward.
 *
 * Following the PureScript evolution, the full internal type would be
 *   SDOM<Channel, Context, ModelIn, ModelOut, Msg>
 * but we expose a simplified public API:
 *   SDOM<Model, Msg>
 * where Channel is handled via `wrapChannel`, Context via closures,
 * and the profunctor split (ModelIn/ModelOut) via `dimap`.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE STATIC DOM GUARANTEE
 * ─────────────────────────────────────────────────────────────────────
 *
 * The type system encodes the guarantee at the value level, not the type
 * level (TypeScript can't enforce "this function never creates new DOM nodes
 * after initial setup"). The INVARIANT is documented on each constructor:
 *
 *   INIT-ONLY: DOM nodes/structure are created ONLY during `attach`.
 *   LEAF-ONLY: Only text content and attribute values change after init.
 *
 * ─────────────────────────────────────────────────────────────────────
 * HTML TYPE SAFETY
 * ─────────────────────────────────────────────────────────────────────
 *
 * We exploit TypeScript's built-in DOM lib types:
 *   HTMLElementTagNameMap  — maps tag string → element interface
 *   HTMLElementEventMap    — maps event name → event interface
 *
 * This gives us, for free:
 *   element("input", { attrs: { value: m => m.name } }, [])
 *   // TypeScript knows `value` is a valid string prop on HTMLInputElement
 *
 *   element("button", { on: { click: (e, m) => ... } }, [])
 *   // TypeScript knows `e` is a MouseEvent
 */

import type { UpdateStream, Dispatcher } from "./observable"
import type { Lens, Prism } from "./optics"

// ---------------------------------------------------------------------------
// Focusable — structural protocol for .focus()
// ---------------------------------------------------------------------------

/**
 * Structural protocol that any optic library can satisfy to work with `.focus()`.
 *
 * Only `get` is required. `compose` enables focus fusion (consecutive `.focus()`
 * calls collapse into a single subscription layer). `getDelta` enables O(1) delta
 * propagation — both are optional and degrade gracefully when absent.
 *
 * static-dom's own `Lens` satisfies this. So do lenses from fp-ts, Effect,
 * monocle-ts, and any library whose lens has a `get` method.
 *
 * @example
 * ```typescript
 * // fp-ts integration
 * import * as L from "fp-ts/Lens"
 *
 * const nameLens = L.pipe(L.id<User>(), L.prop("name"))
 * // nameLens has .get — it satisfies Focusable
 * const nameView = userView.focus(nameLens)
 * ```
 */
export interface Focusable<S, A> {
  /** Read the focused value. Must always succeed (total). */
  readonly get: (s: S) => A

  /**
   * Compose with another Focusable.
   * When present, enables focus fusion: `view.focus(a).focus(b)` collapses
   * into `view.focus(a.compose(b))` — one subscription layer instead of two.
   * When absent, each `.focus()` creates its own subscription layer (still
   * correct, just O(depth) instead of O(1) per update).
   */
  readonly compose?: (that: Focusable<A, unknown>) => Focusable<S, unknown>

  /**
   * Extract a sub-delta for this optic's focus from a parent delta.
   * When present, enables O(1) delta propagation — `.focus()` can skip
   * updates when the focused field didn't change, without calling `get`.
   * static-dom specific; 3rd party optics can ignore this.
   */
  readonly getDelta?: (parentDelta: unknown) => unknown | undefined
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/** Returned by `attach`. Call to remove all event listeners and subscriptions. */
export interface Teardown {
  teardown(): void
}

// ---------------------------------------------------------------------------
// Attribute descriptors
// ─────────────────────────────────────────────────────────────────────────────
// We distinguish four kinds of attributes because their DOM update paths differ:
//
//   StringAttr  → element.setAttribute(name, value)
//   BoolAttr    → element.toggleAttribute(name, value)
//   PropAttr    → element[name] = value  (for IDL attributes like .value, .checked)
//   StyleAttr   → element.style.setProperty(name, value)
//   EventAttr   → element.addEventListener(name, handler)
// ---------------------------------------------------------------------------

/** A DOM attribute whose value is derived from the model. */
export type SDOMAttr<Model, Msg> =
  | {
      readonly kind: "string"
      readonly name: string
      readonly value: (model: Model) => string
    }
  | {
      readonly kind: "bool"
      readonly name: string
      readonly value: (model: Model) => boolean
    }
  | {
      /** IDL / property attribute — assigned directly, not via setAttribute */
      readonly kind: "prop"
      readonly name: string
      readonly value: (model: Model) => string | boolean | number
    }
  | {
      readonly kind: "style"
      readonly property: string
      readonly value: (model: Model) => string
    }
  | {
      readonly kind: "event"
      readonly name: string
      /** Returns null to suppress dispatch. */
      readonly handler: (event: Event, model: Model) => Msg | null
    }
  | {
      /** Class list management — more ergonomic than a raw string attr. */
      readonly kind: "classMap"
      readonly map: (model: Model) => Record<string, boolean>
    }

// ---------------------------------------------------------------------------
// Type-safe attribute constructor input types
//
// When you call `element("input", { ... }, children)` we want TypeScript to
// validate the attributes against the actual HTMLInputElement interface.
//
// We achieve this with two mapped types:
//   WritableAttrs<Tag>  — maps tag → allowed `attrs` object shape
//   TypedEvents<Tag>    — maps tag → allowed `on` object shape
// ---------------------------------------------------------------------------

/**
 * Extract writable string/number/boolean properties from an HTML element type.
 * These are the properties we allow in the `attrs` shorthand.
 */
type WritableStringProps<El> = {
  [K in keyof El as El[K] extends string | number | boolean
    ? K extends string
      ? K
      : never
    : never]?: El[K] extends string
    ? string
    : El[K] extends number
    ? number
    : El[K] extends boolean
    ? boolean
    : never
}

/**
 * The `attrs` shorthand for a given tag: each key maps to a function
 * `(model: Model) => <property type>`.
 */
export type TagAttrs<Tag extends keyof HTMLElementTagNameMap, Model> = {
  [K in keyof WritableStringProps<HTMLElementTagNameMap[Tag]>]?: (
    model: Model
  ) => WritableStringProps<HTMLElementTagNameMap[Tag]>[K]
}

/**
 * The `on` shorthand for a given tag: each event name maps to a handler.
 */
export type TagEvents<
  Tag extends keyof HTMLElementTagNameMap,
  Model,
  Msg
> = {
  [K in keyof HTMLElementEventMap]?: (
    event: HTMLElementEventMap[K],
    model: Model
  ) => Msg | null
}

/**
 * Full attribute input object for `element(tag, attrInput, children)`.
 */
export interface AttrInput<
  Tag extends keyof HTMLElementTagNameMap,
  Model,
  Msg
> {
  /** IDL property attributes — type-checked against the element interface. */
  attrs?: TagAttrs<Tag, Model>
  /** Event handlers — event type is inferred from the event name. */
  on?: TagEvents<Tag, Model, Msg>
  /** CSS classes toggled by boolean flags. */
  classes?: (model: Model) => Record<string, boolean>
  /** Inline style properties. */
  style?: Record<string, (model: Model) => string>
  /** Raw string attributes (aria-*, data-*, custom attributes). */
  rawAttrs?: Record<string, (model: Model) => string>
}

// ---------------------------------------------------------------------------
// SDOM core type — final encoding
// ---------------------------------------------------------------------------

/**
 * The central type. A value of `SDOM<Model, Msg>` is a component that:
 *   - Reads from `Model` to produce DOM content and attribute values.
 *   - Emits messages of type `Msg` in response to DOM events.
 *   - Is INIT-ONLY: DOM structure is fixed after the first `attach` call.
 *
 * Internally, an `SDOM<Model, Msg>` is just its `attach` function.
 * The interface wrapper lets us hang methods on it.
 */
export interface SDOM<Model, out Msg> {
  /**
   * Mount this component under `parent`, initialize from `initialModel`,
   * subscribe to `updates`, and dispatch messages via `dispatch`.
   *
   * Returns a Teardown that removes all subscriptions and event listeners.
   * Does NOT remove the created DOM nodes (the caller is responsible).
   *
   * INVARIANT: After this call returns, no further DOM nodes will ever
   * be created by this component except by the `array` case growing its list.
   */
  attach(
    parent: Element | DocumentFragment,
    initialModel: Model,
    updates: UpdateStream<Model>,
    dispatch: Dispatcher<Msg>
  ): Teardown

  // ─────────────────────────────────────────────────
  // Combinator methods — these are just shorthand for
  // the free functions in combinators.ts, added here
  // for method-chaining ergonomics.
  // ─────────────────────────────────────────────────

  /**
   * Focus this component on a sub-model via a lens or any Focusable optic.
   *
   * Accepts static-dom's own `Lens`, or any optic with a `get` method —
   * including lenses from fp-ts, Effect, monocle-ts, etc.
   */
  focus<Outer>(lens: Focusable<Outer, Model>): SDOM<Outer, Msg>

  /**
   * Map outgoing messages.
   * Equivalent to PureScript's `Html.map` / `interpretChannel`.
   */
  mapMsg<Msg2>(f: (msg: Msg) => Msg2): SDOM<Model, Msg2>

  /**
   * Map the model contravariantly (narrow what the component sees).
   * `contramap(f)` is `focus(lens(f, (_, s) => s))` but without a setter
   * (read-only view). Use when you only need to read, not write back.
   */
  contramap<Outer>(f: (outer: Outer) => Model): SDOM<Outer, Msg>

  /**
   * Show/hide this component based on a predicate on the model.
   * The DOM nodes are created immediately but toggled via `display: none`.
   * (For truly conditional rendering use `optional`.)
   */
  showIf(predicate: (model: Model) => boolean): SDOM<Model, Msg>
}

// ---------------------------------------------------------------------------
// The SDOMNode internal variants
//
// These are the constructors for the final encoding.
// Each is a function that closes over its configuration and returns
// the `attach` function wrapped in the SDOM interface.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Focus fusion symbols (from Most.js operator fusion)
//
// When consecutive .focus() calls are chained, we compose the lenses into
// a single lens and eliminate the intermediate subscription layer.
// This avoids O(depth) observer hops for deeply nested component trees.
// ---------------------------------------------------------------------------

const _FOCUS_TARGET: unique symbol = Symbol("sdom.focusTarget")
const _FOCUS_LENS: unique symbol = Symbol("sdom.focusLens")

/** Brand interface for SDOM nodes carrying focus-fusion metadata. */
interface FocusFusionBrand {
  [_FOCUS_TARGET]?: unknown
  [_FOCUS_LENS]?: unknown
}

/**
 * Internal helper: given an `attach` function, produce a full SDOM<M, Msg>
 * with all the combinator methods wired up.
 *
 * This is the only place where the combinator methods are implemented;
 * all constructors call `makeSDOM` to get the full interface.
 */
export function makeSDOM<Model, Msg>(
  attachFn: SDOM<Model, Msg>["attach"]
): SDOM<Model, Msg> {
  const sdom: SDOM<Model, Msg> = {
    attach: attachFn,

    focus<Outer>(lensOuter: Focusable<Outer, Model>): SDOM<Outer, Msg> {
      // Focus fusion: if this SDOM was itself created by .focus() and the
      // incoming optic supports compose, collapse consecutive focus calls
      // into a single subscription layer.
      // a.focus(L1).focus(L2) → a.focus(L2.compose(L1)) — one observer, not two.
      if (lensOuter.compose) {
        const branded = sdom as SDOM<Model, Msg> & FocusFusionBrand
        const innerTarget = branded[_FOCUS_TARGET] as SDOM<unknown, Msg> | undefined
        const innerLens = branded[_FOCUS_LENS] as Focusable<Model, unknown> | undefined
        if (innerTarget !== undefined && innerLens !== undefined) {
          return innerTarget.focus(lensOuter.compose(innerLens) as Focusable<Outer, unknown>)
        }
      }

      const result = makeSDOM<Outer, Msg>((parent, initialOuter, outerUpdates, dispatch) => {
        // Project updates to only fire when the focused slice changes.
        // When a structured delta is available and the optic has getDelta,
        // we can check whether this field changed without calling get().
        const innerUpdates: UpdateStream<Model> = {
          subscribe(observer) {
            return outerUpdates.subscribe(({ prev, next, delta }) => {
              // Fast path: if we have a delta and the optic can inspect it,
              // check whether this slice was touched at all.
              if (delta !== undefined && lensOuter.getDelta) {
                const innerDelta = lensOuter.getDelta(delta)
                if (innerDelta === undefined) {
                  // Delta says this field didn't change — skip entirely
                  return
                }
                // Field changed — propagate with the sub-delta
                observer({
                  prev: lensOuter.get(prev),
                  next: lensOuter.get(next),
                  delta: innerDelta,
                })
                return
              }
              // Slow path: reference equality check
              const prevInner = lensOuter.get(prev)
              const nextInner = lensOuter.get(next)
              if (prevInner !== nextInner) {
                observer({ prev: prevInner, next: nextInner })
              }
            })
          },
        }
        return sdom.attach(parent, lensOuter.get(initialOuter), innerUpdates, dispatch)
      })

      // Tag the result for future fusion (only if compose is available)
      if (lensOuter.compose) {
        const fusionBranded = result as SDOM<Outer, Msg> & FocusFusionBrand
        fusionBranded[_FOCUS_TARGET] = sdom
        fusionBranded[_FOCUS_LENS] = lensOuter
      }
      return result
    },

    mapMsg<Msg2>(f: (msg: Msg) => Msg2): SDOM<Model, Msg2> {
      return makeSDOM<Model, Msg2>((parent, initialModel, updates, dispatch2) =>
        sdom.attach(parent, initialModel, updates, msg => dispatch2(f(msg)))
      )
    },

    contramap<Outer>(f: (outer: Outer) => Model): SDOM<Outer, Msg> {
      return makeSDOM<Outer, Msg>((parent, initialOuter, outerUpdates, dispatch) => {
        const innerUpdates: UpdateStream<Model> = {
          subscribe(observer) {
            return outerUpdates.subscribe(({ prev, next }) => {
              const prevM = f(prev)
              const nextM = f(next)
              if (prevM !== nextM) observer({ prev: prevM, next: nextM })
            })
          },
        }
        return sdom.attach(parent, f(initialOuter), innerUpdates, dispatch)
      })
    },

    showIf(predicate: (model: Model) => boolean): SDOM<Model, Msg> {
      return makeSDOM<Model, Msg>((parent, initialModel, updates, dispatch) => {
        // We wrap the subtree in a span so we have a single DOM node to toggle.
        const wrapper = document.createElement("span")
        wrapper.style.display = predicate(initialModel) ? "" : "none"
        parent.appendChild(wrapper)

        const inner = sdom.attach(wrapper, initialModel, updates, dispatch)

        const unsub = updates.subscribe(({ next }) => {
          wrapper.style.display = predicate(next) ? "" : "none"
        })

        return {
          teardown() {
            unsub()
            inner.teardown()
          },
        }
      })
    },
  }

  return sdom
}

// ---------------------------------------------------------------------------
// Channel types
//
// Matching the PureScript `ArrayChannel` concept.
// ---------------------------------------------------------------------------

/** A channel event is either "send to parent" or "update this model". */
export type ChannelEvent<Channel, Model> =
  | { readonly kind: "parent"; readonly value: Channel }
  | { readonly kind: "update"; readonly fn: (model: Model) => Model }

/**
 * The channel variant of SDOM, where instead of emitting Msg directly,
 * a component can either emit a message to the parent channel or apply
 * a local model update.
 *
 * `SDOMWithChannel<Channel, Model>` is the internal type used by `array`.
 * The public API wraps it with `wrapChannel` to get back to `SDOM<Model, Msg>`.
 */
export interface SDOMWithChannel<Channel, Model> {
  attach(
    parent: Element | DocumentFragment,
    initialModel: Model,
    updates: UpdateStream<Model>,
    dispatch: Dispatcher<ChannelEvent<Channel, Model>>
  ): Teardown
}

// ---------------------------------------------------------------------------
// Array item context
// Matching PureScript's `ArrayContext`
// ---------------------------------------------------------------------------

/** Context available to each item in an `array` SDOM. */
export interface ArrayContext {
  readonly index: number
  readonly key: string
}

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

/** Infer the Model type of an SDOM. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required: `any` in conditional type inference position; `unknown` fails due to SDOM's contravariant Msg parameter
export type ModelOf<S> = S extends SDOM<infer M, any> ? M : never

/** Infer the Msg type of an SDOM. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required: `any` in conditional type inference position; `unknown` fails due to SDOM's covariant Model parameter
export type MsgOf<S> = S extends SDOM<any, infer Msg> ? Msg : never

/**
 * A keyed item for use with `array`.
 * The key must be stable across renders (like React keys).
 */
export interface KeyedItem<ItemModel> {
  readonly key: string
  readonly model: ItemModel
}
