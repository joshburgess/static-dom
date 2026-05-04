/**
 * delegation.ts — Event delegation utility (from Inferno)
 *
 * Instead of calling `el.addEventListener(name, handler)` on every element,
 * a single listener on a root container routes events via bubbling. This
 * reduces memory usage and speeds up mount/teardown for large lists.
 *
 * Usage:
 *   const delegator = createDelegator(document.getElementById("app")!)
 *   // Register a handler on a specific element:
 *   const unregister = delegator.on(buttonEl, "click", handler)
 *   // Events bubble to the root and are dispatched to the registered handler.
 *   // Teardown:
 *   unregister()
 *   delegator.teardown()
 *
 * Integration with SDOM: use `delegatedElement` as a drop-in replacement for
 * `element` that registers events via a delegator instead of addEventListener.
 */

// One WeakMap per event type maps elements directly to their handler.
// Skipping the inner Map<eventName, handler> avoids one Map allocation per
// element registration — meaningful when 10k rows each register 1+ events.
type EventMap = WeakMap<EventTarget, (event: Event) => void>

// Per-event-type bookkeeping. The root listener and the property-based
// handler key are computed once when the listener is installed; bundling
// them with the WeakMap lets the hot delegateProp/attach paths grab
// everything they need with a single Map lookup.
interface EventBucket {
  map: EventMap
  handlerKey: string
}

/**
 * Property-based dispatch: the codegen stores the user's pure
 * `(event, model) => msg` function directly on the clickable element,
 * and the row state on the row root. The root listener walks up to find
 * both, calls fn with the live model, and routes the result through
 * dispatch. Skipping the per-row closure + WeakMap.set is a measurable
 * win on bulk mount.
 */
const STATE_KEY = "__sdom_state"
function handlerKeyFor(eventName: string): string {
  return "__sdom_h_" + eventName
}

interface RowState {
  evtModel: unknown
  dispatch: (msg: unknown) => void
}

interface ElementWithDispatch extends Element {
  [STATE_KEY]?: RowState
  [key: string]: unknown
}

export interface EventDelegator {
  /**
   * Register an event handler for a specific element.
   * Returns an unregister function.
   */
  on(el: Element, eventName: string, handler: (event: Event) => void): () => void

  /**
   * Like `on`, but does not return an unregister function. Saves one closure
   * allocation per call — the handler reclaims automatically once the element
   * becomes unreachable (handlers live in a per-event WeakMap). Used by the
   * hot mount path through `registerEvent`.
   */
  attach(el: Element, eventName: string, handler: (event: Event) => void): void

  /**
   * Property-based dispatch: store a pure `(event, model) => msg` directly on
   * the element and let the root listener walk up to a row root carrying
   * `__sdom_state`. The codegen uses this to skip allocating a per-row
   * closure that captures `s` — that closure was the bulk of the per-row
   * event registration cost on the 10k-row mount path.
   */
  delegateProp(
    el: Element,
    eventName: string,
    fn: (event: Event, model: unknown) => unknown,
  ): void

  /** Remove all root listeners. */
  teardown(): void
}

/**
 * Create an event delegator rooted at the given element.
 *
 * The delegator lazily registers a single event listener per event type
 * on the root. When an event fires, it walks up the DOM tree from
 * `event.target` looking for a registered handler.
 */
export function createDelegator(root: Element): EventDelegator {
  // event name → bucket carrying the per-event WeakMap + cached handler key
  const buckets = new Map<string, EventBucket>()
  const rootListeners = new Map<string, (e: Event) => void>()

  function ensureBucket(eventName: string): EventBucket {
    let bucket = buckets.get(eventName)
    if (bucket !== undefined) return bucket
    const map: EventMap = new WeakMap()
    const handlerKey = handlerKeyFor(eventName)
    bucket = { map, handlerKey }
    buckets.set(eventName, bucket)

    const eventMap = map
    const listener = (event: Event) => {
      // Single bubble pass that handles both dispatch flavors:
      //   1. Property-based: codegen has stored the pure fn on a clickable
      //      element and `s` on the row root. Walk up tracking the first
      //      pure fn we encounter; on the first row root with `__sdom_state`,
      //      dispatch and stop.
      //   2. Closure-based: handwritten code went through `attach`/`on`,
      //      registering a closure in the per-event WeakMap. Honor those
      //      while we walk so existing users aren't broken.
      let target = event.target as ElementWithDispatch | null
      let propFn: ((event: Event, model: unknown) => unknown) | null = null
      while (target !== null && target !== root) {
        if (propFn === null) {
          const fn = target[handlerKey] as
            | ((event: Event, model: unknown) => unknown)
            | undefined
          if (fn !== undefined) propFn = fn
        }
        const state = target[STATE_KEY]
        if (state !== undefined) {
          if (propFn !== null) {
            const msg = propFn(event, state.evtModel)
            if (msg !== null && msg !== undefined) state.dispatch(msg)
          }
          return
        }
        const handler = eventMap.get(target)
        if (handler !== undefined) {
          handler(event)
          // Don't return — allow bubbling to continue for analytics/logging
          // Handlers that want to stop propagation can call event.stopPropagation()
          return
        }
        target = target.parentElement as ElementWithDispatch | null
      }
      // Also check the root itself
      const rootHandler = eventMap.get(root)
      if (rootHandler) rootHandler(event)
    }

    rootListeners.set(eventName, listener)
    root.addEventListener(eventName, listener)
    return bucket
  }

  return {
    on(el: Element, eventName: string, handler: (event: Event) => void): () => void {
      const map = ensureBucket(eventName).map
      map.set(el, handler)
      return () => map.delete(el)
    },

    attach(el: Element, eventName: string, handler: (event: Event) => void): void {
      ensureBucket(eventName).map.set(el, handler)
    },

    delegateProp(
      el: Element,
      eventName: string,
      fn: (event: Event, model: unknown) => unknown,
    ): void {
      // Single Map lookup pulls both the (possibly-installed) root listener
      // and the cached `__sdom_h_<event>` property name — no per-call string
      // concat, which the bulk-mount path runs N×events times.
      ;(el as ElementWithDispatch)[ensureBucket(eventName).handlerKey] = fn
    },

    teardown() {
      for (const [name, listener] of rootListeners) {
        root.removeEventListener(name, listener)
      }
      rootListeners.clear()
      buckets.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// Ambient delegator
//
// program() installs a delegator at the container, then runs view.attach
// inside withDelegator(d, ...). Constructors that wire DOM events (jsx
// runtime, template, element() constructor, html runtime) call
// registerEvent(el, name, fn), which uses the ambient delegator if one is
// set and otherwise falls back to addEventListener. This keeps the public
// SDOM.attach signature unchanged: delegation is a transport-layer detail,
// not part of the user-facing model.
//
// Reconcilers (createArrayReconciler, the array() reconciler in
// incremental.ts) capture the ambient delegator at factory time and
// reinstall it around every per-item attach so newly-mounted rows also
// register through the program's root listener.
// ---------------------------------------------------------------------------

let currentDelegator: EventDelegator | null = null

/** Read the ambient delegator. Returns null when no program is mounting. */
export function getCurrentDelegator(): EventDelegator | null {
  return currentDelegator
}

/** Run `fn` with `d` installed as the ambient delegator. Restores the prior
 *  delegator on return. Synchronous only — do not await inside `fn`. */
export function withDelegator<T>(d: EventDelegator | null, fn: () => T): T {
  const prev = currentDelegator
  currentDelegator = d
  try {
    return fn()
  } finally {
    currentDelegator = prev
  }
}

/** Register a DOM event handler. Uses the ambient delegator when present
 *  (single root listener), otherwise installs a native listener on the
 *  element. Returns an unregister function for the native-listener path,
 *  or null when delegated — delegated handlers live in a WeakMap keyed by
 *  the element, so they reclaim automatically once the element becomes
 *  unreachable. Skipping the eager `WeakMap.delete()` saves one closure
 *  call + one map mutation per event per row on teardown, which is a
 *  large fraction of script time when clearing thousands of rows. */
export function registerEvent(
  el: Element,
  eventName: string,
  listener: (event: Event) => void,
): (() => void) | null {
  const d = currentDelegator
  if (d !== null) {
    d.attach(el, eventName, listener)
    return null
  }
  el.addEventListener(eventName, listener)
  return () => el.removeEventListener(eventName, listener)
}

/**
 * Property-based event delegation used by sdomCodegen on the bulk-mount
 * hot path. Stores the user's pure `(event, model) => msg` function as
 * a property on the element so the root listener can call it directly
 * without an intermediate per-row closure.
 *
 * Caller sets `s.root.__sdom_state = s` once after building the row
 * state literal so the root listener can find the row's live model and
 * dispatch during a bubble. With a delegator present, this skips the
 * closure allocation and per-element WeakMap.set that `registerEvent`
 * incurs. Returns null in that case (the property reclaims with the
 * element).
 *
 * No-delegator fallback (bare/test usage) builds the closure that
 * `registerEvent` would have built and returns a teardown.
 */
export function delegateEvent(
  el: Element,
  eventName: string,
  fn: (event: Event, model: unknown) => unknown,
  state: { evtModel: unknown; dispatch: (msg: unknown) => void },
): (() => void) | null {
  const d = currentDelegator
  if (d !== null) {
    d.delegateProp(el, eventName, fn)
    return null
  }
  const listener = (event: Event) => {
    const msg = fn(event, state.evtModel)
    if (msg !== null && msg !== undefined) state.dispatch(msg)
  }
  el.addEventListener(eventName, listener)
  return () => el.removeEventListener(eventName, listener)
}
