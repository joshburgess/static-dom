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

// Handler map: element → event name → handler function
// WeakMap ensures elements can be GC'd when removed from the DOM.
type HandlerMap = WeakMap<EventTarget, Map<string, (event: Event) => void>>

export interface EventDelegator {
  /**
   * Register an event handler for a specific element.
   * Returns an unregister function.
   */
  on(el: Element, eventName: string, handler: (event: Event) => void): () => void

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
  const handlers: HandlerMap = new WeakMap()
  const rootListeners = new Map<string, (e: Event) => void>()

  function ensureRootListener(eventName: string): void {
    if (rootListeners.has(eventName)) return

    const listener = (event: Event) => {
      let target = event.target as Element | null
      while (target !== null && target !== root) {
        const elMap = handlers.get(target)
        if (elMap) {
          const handler = elMap.get(eventName)
          if (handler) {
            handler(event)
            // Don't return — allow bubbling to continue for analytics/logging
            // Handlers that want to stop propagation can call event.stopPropagation()
            return
          }
        }
        target = target.parentElement
      }
      // Also check the root itself
      const rootMap = handlers.get(root)
      if (rootMap) {
        const handler = rootMap.get(eventName)
        if (handler) handler(event)
      }
    }

    rootListeners.set(eventName, listener)
    root.addEventListener(eventName, listener)
  }

  return {
    on(el: Element, eventName: string, handler: (event: Event) => void): () => void {
      ensureRootListener(eventName)

      let elMap = handlers.get(el)
      if (!elMap) {
        elMap = new Map()
        handlers.set(el, elMap)
      }
      elMap.set(eventName, handler)

      return () => {
        elMap!.delete(eventName)
        // WeakMap entry stays — GC handles cleanup when element is removed
      }
    },

    teardown() {
      for (const [name, listener] of rootListeners) {
        root.removeEventListener(name, listener)
      }
      rootListeners.clear()
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
 *  element. Returns an unregister function suitable for an event-cleanup
 *  array. */
export function registerEvent(
  el: Element,
  eventName: string,
  listener: (event: Event) => void,
): () => void {
  const d = currentDelegator
  if (d !== null) {
    return d.on(el, eventName, listener)
  }
  el.addEventListener(eventName, listener)
  return () => el.removeEventListener(eventName, listener)
}
