/**
 * subscription.ts — Elm-style subscriptions for SDOM
 *
 * Subscriptions are long-lived effects (timers, event listeners, websockets)
 * that dispatch messages into the update loop. The runtime diffs
 * subscriptions by key after each model update, starting new ones and
 * stopping removed ones.
 *
 * @example
 * ```typescript
 * import { interval, onWindow, programWithSub } from "@static-dom/core"
 *
 * type Msg = { type: "tick"; time: number } | { type: "resize"; w: number; h: number }
 *
 * programWithSub({
 *   container: document.getElementById("app")!,
 *   init: { count: 0, width: window.innerWidth },
 *   update(msg, model) { ... },
 *   view: myView,
 *   subscriptions(model) {
 *     return model.count > 0
 *       ? [interval("tick", 1000, t => ({ type: "tick", time: t }))]
 *       : []
 *   },
 * })
 * ```
 */

import type { Dispatcher } from "./observable"
import type { Teardown } from "./types"

// ---------------------------------------------------------------------------
// Sub type
// ---------------------------------------------------------------------------

/**
 * A subscription that, when started, produces messages over time.
 * Subscriptions are identified by key for diffing — subs with the
 * same key are considered the same subscription and won't be restarted.
 */
export interface Sub<Msg> {
  readonly key: string
  start(dispatch: Dispatcher<Msg>): Teardown
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/** No subscriptions. */
export function noneSub<Msg>(): Sub<Msg>[] {
  return []
}

/** Flatten multiple subscription arrays into one. */
export function batchSub<Msg>(...groups: Sub<Msg>[][]): Sub<Msg>[] {
  return groups.flat()
}

// ---------------------------------------------------------------------------
// Built-in subscriptions
// ---------------------------------------------------------------------------

/**
 * Dispatch a message at a fixed interval.
 *
 * @param key    Unique key for diffing.
 * @param ms     Interval in milliseconds.
 * @param toMsg  Message or function from timestamp to message.
 */
export function interval<Msg>(
  key: string,
  ms: number,
  toMsg: Msg | ((time: number) => Msg),
): Sub<Msg> {
  return {
    key,
    start(dispatch) {
      const id = setInterval(() => {
        dispatch(typeof toMsg === "function" ? (toMsg as (t: number) => Msg)(Date.now()) : toMsg)
      }, ms)
      return { teardown: () => clearInterval(id) }
    },
  }
}

/**
 * Dispatch a message on each animation frame.
 *
 * @param key    Unique key for diffing.
 * @param toMsg  Function from DOMHighResTimeStamp to message.
 */
export function animationFrame<Msg>(
  key: string,
  toMsg: (time: number) => Msg,
): Sub<Msg> {
  return {
    key,
    start(dispatch) {
      let active = true
      let id: number
      const tick = (time: number) => {
        if (!active) return
        dispatch(toMsg(time))
        id = requestAnimationFrame(tick)
      }
      id = requestAnimationFrame(tick)
      return {
        teardown() {
          active = false
          cancelAnimationFrame(id)
        },
      }
    },
  }
}

/**
 * Listen for a window-level event.
 *
 * @param key      Unique key for diffing.
 * @param event    Event name (keydown, resize, etc.).
 * @param handler  Maps event to message, or null to suppress.
 */
export function onWindow<Msg, K extends keyof WindowEventMap>(
  key: string,
  event: K,
  handler: (e: WindowEventMap[K]) => Msg | null,
): Sub<Msg> {
  return {
    key,
    start(dispatch) {
      const listener = ((e: WindowEventMap[K]) => {
        const msg = handler(e)
        if (msg !== null) dispatch(msg)
      }) as EventListener
      window.addEventListener(event, listener)
      return { teardown: () => window.removeEventListener(event, listener) }
    },
  }
}

/**
 * Listen for a document-level event.
 *
 * @param key      Unique key for diffing.
 * @param event    Event name.
 * @param handler  Maps event to message, or null to suppress.
 */
export function onDocument<Msg, K extends keyof DocumentEventMap>(
  key: string,
  event: K,
  handler: (e: DocumentEventMap[K]) => Msg | null,
): Sub<Msg> {
  return {
    key,
    start(dispatch) {
      const listener = ((e: DocumentEventMap[K]) => {
        const msg = handler(e)
        if (msg !== null) dispatch(msg)
      }) as EventListener
      document.addEventListener(event, listener)
      return { teardown: () => document.removeEventListener(event, listener) }
    },
  }
}

// ---------------------------------------------------------------------------
// Subscription diffing
// ---------------------------------------------------------------------------

/**
 * Diff active subscriptions against the desired list.
 * Stops removed subs, starts new ones.
 * @internal Used by programWithSub and elmProgram.
 */
export function diffSubs<Msg>(
  active: Map<string, Teardown>,
  nextSubs: Sub<Msg>[],
  dispatch: Dispatcher<Msg>,
): void {
  const nextKeys = new Set<string>()
  for (const sub of nextSubs) nextKeys.add(sub.key)

  // Stop removed subs
  for (const [key, teardown] of active) {
    if (!nextKeys.has(key)) {
      teardown.teardown()
      active.delete(key)
    }
  }

  // Start new subs
  for (const sub of nextSubs) {
    if (!active.has(sub.key)) {
      active.set(sub.key, sub.start(dispatch))
    }
  }
}
