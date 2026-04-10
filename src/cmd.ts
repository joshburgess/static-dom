/**
 * cmd.ts — Built-in command constructors for the Elm architecture
 *
 * Commands are async side-effects that eventually dispatch messages
 * back into the update loop. The base `Cmd<Msg>` type is defined in
 * program.ts; this module provides ready-made constructors for common
 * effects: HTTP requests, random values, delays, and port sends.
 *
 * @example
 * ```typescript
 * import { httpGetJson, delay, randomInt, mapCmd } from "static-dom"
 *
 * function update(msg: Msg, model: Model): [Model, Cmd<Msg>] {
 *   switch (msg.type) {
 *     case "fetchUsers":
 *       return [
 *         { ...model, loading: true },
 *         httpGetJson("/api/users", data => ({ type: "gotUsers", users: data as User[] }),
 *                     err => ({ type: "fetchFailed", error: err.message })),
 *       ]
 *     case "roll":
 *       return [model, randomInt(1, 6, n => ({ type: "rolled", value: n }))]
 *     case "showToast":
 *       return [{ ...model, toast: msg.text }, delay(3000, { type: "hideToast" })]
 *   }
 * }
 * ```
 */

import type { Cmd } from "./program"
import type { Dispatcher } from "./observable"

// ---------------------------------------------------------------------------
// Cmd combinators
// ---------------------------------------------------------------------------

/** Transform the messages produced by a command. */
export function mapCmd<A, B>(cmd: Cmd<A>, f: (a: A) => B): Cmd<B> {
  return (dispatch: Dispatcher<B>) => cmd((a: A) => dispatch(f(a)))
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * Configuration for an HTTP request command.
 */
export interface HttpRequest<Msg> {
  readonly url: string
  readonly method?: string
  readonly headers?: Record<string, string>
  readonly body?: BodyInit | null
  /** Parse the response and produce a message. */
  readonly expect: (response: Response) => Promise<Msg>
  /** Produce a message from a network/parse error. */
  readonly onError: (error: Error) => Msg
}

/**
 * General HTTP request command.
 *
 * Uses the Fetch API. The `expect` callback receives the raw Response
 * and must parse it (e.g., `r => r.json()`). If fetch or expect throws,
 * `onError` is called with the error.
 */
export function httpRequest<Msg>(config: HttpRequest<Msg>): Cmd<Msg> {
  return (dispatch: Dispatcher<Msg>) => {
    const { url, method, headers, body, expect, onError } = config
    const init: RequestInit = { method: method ?? "GET", body: body ?? null }
    if (headers) init.headers = headers
    fetch(url, init)
      .then(expect)
      .then(msg => dispatch(msg))
      .catch((err: unknown) =>
        dispatch(onError(err instanceof Error ? err : new Error(String(err)))),
      )
  }
}

/**
 * GET request that parses the response as JSON.
 *
 * @param url       Request URL.
 * @param toMsg     Transform the parsed JSON into a message.
 * @param onError   Transform a fetch/parse error into a message.
 */
export function httpGetJson<Msg>(
  url: string,
  toMsg: (json: unknown) => Msg,
  onError: (error: Error) => Msg,
): Cmd<Msg> {
  return httpRequest({
    url,
    expect: async (r) => toMsg(await r.json()),
    onError,
  })
}

/**
 * POST request that sends and receives JSON.
 *
 * @param url       Request URL.
 * @param body      Object to JSON.stringify as the request body.
 * @param toMsg     Transform the parsed JSON response into a message.
 * @param onError   Transform a fetch/parse error into a message.
 */
export function httpPostJson<Msg>(
  url: string,
  body: unknown,
  toMsg: (json: unknown) => Msg,
  onError: (error: Error) => Msg,
): Cmd<Msg> {
  return httpRequest({
    url,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    expect: async (r) => toMsg(await r.json()),
    onError,
  })
}

// ---------------------------------------------------------------------------
// Random
// ---------------------------------------------------------------------------

/**
 * Generate a random integer in [min, max] (inclusive).
 *
 * Uses `Math.random()` for simplicity. For cryptographic randomness,
 * use `httpRequest` with a server-side source or build a custom Cmd
 * around `crypto.getRandomValues`.
 */
export function randomInt<Msg>(
  min: number,
  max: number,
  toMsg: (n: number) => Msg,
): Cmd<Msg> {
  return (dispatch: Dispatcher<Msg>) => {
    const n = Math.floor(Math.random() * (max - min + 1)) + min
    dispatch(toMsg(n))
  }
}

/**
 * Generate a random float in [0, 1).
 */
export function randomFloat<Msg>(toMsg: (n: number) => Msg): Cmd<Msg> {
  return (dispatch: Dispatcher<Msg>) => {
    dispatch(toMsg(Math.random()))
  }
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Dispatch a message after a delay.
 *
 * Note: the delay is "fire and forget" — there's no way to cancel it
 * from within the Elm architecture. If you need cancellation, use a
 * subscription (e.g., `interval` with a conditional).
 */
export function delay<Msg>(ms: number, msg: Msg): Cmd<Msg> {
  return (dispatch: Dispatcher<Msg>) => {
    setTimeout(() => dispatch(msg), ms)
  }
}

/**
 * Dispatch a message on the next microtask (Promise.resolve).
 * Useful for deferring work without a visible delay.
 */
export function nextTick<Msg>(msg: Msg): Cmd<Msg> {
  return (dispatch: Dispatcher<Msg>) => {
    Promise.resolve().then(() => dispatch(msg))
  }
}
