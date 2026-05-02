/**
 * ports.ts — Typed JS interop matching Elm's port system
 *
 * Ports provide a typed, decoupled channel between SDOM programs and
 * external JavaScript code. There are two kinds:
 *
 * - **InPort<T, Msg>** — external JS sends data IN to the SDOM runtime.
 *   Used as a subscription in `programWithSub` or `elmProgram`.
 *
 * - **OutPort<T>** — the SDOM runtime sends data OUT to external JS.
 *   Used as a command from `update`.
 *
 * @example
 * ```typescript
 * // --- Define ports ---
 * const notifications = createInPort<{ title: string }, Msg>(
 *   "notifications",
 *   data => ({ type: "notified", title: data.title }),
 * )
 *
 * const analytics = createOutPort<{ event: string; data: unknown }>("analytics")
 *
 * // --- Use in Elm architecture ---
 * elmProgram({
 *   // ...
 *   update(msg, model) {
 *     switch (msg.type) {
 *       case "trackEvent":
 *         return [model, portCmd(analytics, { event: "click", data: msg.target })]
 *       // ...
 *     }
 *   },
 *   subscriptions: () => [portSub(notifications)],
 * })
 *
 * // --- External JS ---
 * notifications.send({ title: "New message!" })
 * analytics.listen(data => gtag("event", data.event, data.data))
 * ```
 */

import type { Cmd } from "./program"
import type { Sub } from "./subscription"
import type { Dispatcher } from "./observable"
import type { Teardown } from "./types"

// ---------------------------------------------------------------------------
// InPort — external JS → SDOM runtime
// ---------------------------------------------------------------------------

/**
 * An incoming port: external JS sends data in, SDOM dispatches a message.
 *
 * Use `portSub(port)` to wire it as a subscription in `programWithSub`
 * or `elmProgram`. External code calls `port.send(value)`.
 */
export interface InPort<T, Msg> {
  /** Port name (used as the subscription key). */
  readonly name: string
  /** Send a value into the SDOM runtime. Called from external JS. */
  send(value: T): void
  /** Listen for values being sent (internal — used by portSub). */
  _listen(handler: (value: T) => void): () => void
  /** @internal Transform value to message. */
  readonly _toMsg: (value: T) => Msg
}

/**
 * Create an incoming port.
 *
 * @param name   Unique port name (also used as subscription key).
 * @param toMsg  Transform incoming values into messages.
 */
export function createInPort<T, Msg>(
  name: string,
  toMsg: (value: T) => Msg,
): InPort<T, Msg> {
  const listeners = new Set<(value: T) => void>()

  return {
    name,
    _toMsg: toMsg,
    send(value: T) {
      for (const listener of listeners) {
        listener(value)
      }
    },
    _listen(handler: (value: T) => void): () => void {
      listeners.add(handler)
      return () => { listeners.delete(handler) }
    },
  }
}

// ---------------------------------------------------------------------------
// OutPort — SDOM runtime → external JS
// ---------------------------------------------------------------------------

/**
 * An outgoing port: SDOM sends data out, external JS listens.
 *
 * Use `portCmd(port, value)` to send from `update`. External code
 * calls `port.listen(handler)`.
 */
export interface OutPort<T> {
  /** Port name (for debugging/identification). */
  readonly name: string
  /** Register a listener for outgoing values. Returns an unsubscribe function. */
  listen(handler: (value: T) => void): () => void
  /** @internal Send a value out. Called by portCmd. */
  _send(value: T): void
}

/**
 * Create an outgoing port.
 *
 * @param name  Unique port name (for debugging/identification).
 */
export function createOutPort<T>(name: string): OutPort<T> {
  const listeners = new Set<(value: T) => void>()

  return {
    name,
    listen(handler: (value: T) => void): () => void {
      listeners.add(handler)
      return () => { listeners.delete(handler) }
    },
    _send(value: T) {
      for (const listener of listeners) {
        listener(value)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Port ↔ Elm architecture adapters
// ---------------------------------------------------------------------------

/**
 * Create a subscription from an incoming port.
 * Wire into `subscriptions()` in `programWithSub` or `elmProgram`.
 */
export function portSub<T, Msg>(port: InPort<T, Msg>): Sub<Msg> {
  return {
    key: `port:${port.name}`,
    start(dispatch: Dispatcher<Msg>): Teardown {
      const unsub = port._listen((value: T) => {
        dispatch(port._toMsg(value))
      })
      return { teardown: unsub }
    },
  }
}

/**
 * Create a command that sends a value through an outgoing port.
 * Use in `update` return value.
 */
export function portCmd<T>(port: OutPort<T>, value: T): Cmd<never> {
  return (_dispatch: Dispatcher<never>) => {
    port._send(value)
  }
}
