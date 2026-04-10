/**
 * navigation.ts — URL-based routing for the Elm architecture
 *
 * Provides commands to navigate (pushUrl, replaceUrl, back, forward)
 * and a subscription to watch for URL changes (onUrlChange).
 *
 * @example
 * ```typescript
 * import { onUrlChange, pushUrl, currentUrl, elmProgram } from "static-dom-core"
 *
 * type Msg = { type: "urlChanged"; url: UrlLocation } | { type: "navigate"; path: string }
 *
 * elmProgram({
 *   container: document.getElementById("app")!,
 *   init: [{ url: currentUrl() }, noCmd()],
 *   update(msg, model) {
 *     switch (msg.type) {
 *       case "urlChanged":
 *         return [{ url: msg.url }, noCmd()]
 *       case "navigate":
 *         return [model, pushUrl(msg.path)]
 *     }
 *   },
 *   view: myView,
 *   subscriptions: () => [onUrlChange("url", url => ({ type: "urlChanged", url }))],
 * })
 * ```
 */

import type { Cmd } from "./program"
import type { Sub } from "./subscription"
import type { Dispatcher } from "./observable"

// ---------------------------------------------------------------------------
// URL location type
// ---------------------------------------------------------------------------

/**
 * A snapshot of the current URL, matching the shape of `window.location`
 * but as a plain serializable object.
 */
export interface UrlLocation {
  readonly pathname: string
  readonly search: string
  readonly hash: string
  readonly href: string
}

/**
 * Read the current URL as a UrlLocation.
 * Safe to call during init — does not require the DOM to be mounted.
 */
export function currentUrl(): UrlLocation {
  const loc = window.location
  return {
    pathname: loc.pathname,
    search: loc.search,
    hash: loc.hash,
    href: loc.href,
  }
}

// ---------------------------------------------------------------------------
// Navigation commands
// ---------------------------------------------------------------------------

/**
 * Push a new URL onto the history stack.
 * Dispatches no message — use `onUrlChange` to react to the change.
 */
export function pushUrl<Msg>(url: string): Cmd<Msg> {
  return (_dispatch: Dispatcher<Msg>) => {
    window.history.pushState(null, "", url)
    // pushState doesn't fire popstate, so we dispatch a synthetic event
    // that onUrlChange listeners can pick up.
    window.dispatchEvent(new PopStateEvent("popstate"))
  }
}

/**
 * Replace the current URL without adding a history entry.
 */
export function replaceUrl<Msg>(url: string): Cmd<Msg> {
  return (_dispatch: Dispatcher<Msg>) => {
    window.history.replaceState(null, "", url)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }
}

/**
 * Go back N entries in the history stack. Defaults to 1.
 */
export function back<Msg>(n: number = 1): Cmd<Msg> {
  return (_dispatch: Dispatcher<Msg>) => {
    window.history.go(-n)
  }
}

/**
 * Go forward N entries in the history stack. Defaults to 1.
 */
export function forward<Msg>(n: number = 1): Cmd<Msg> {
  return (_dispatch: Dispatcher<Msg>) => {
    window.history.go(n)
  }
}

// ---------------------------------------------------------------------------
// Navigation subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to URL changes (popstate events and programmatic navigation).
 *
 * Fires whenever the URL changes due to:
 * - Browser back/forward
 * - `pushUrl` / `replaceUrl` commands
 * - External `history.pushState()` / `history.replaceState()` calls
 *   (if they dispatch popstate)
 *
 * @param key    Unique subscription key for diffing.
 * @param toMsg  Transform the new URL location into a message.
 */
export function onUrlChange<Msg>(
  key: string,
  toMsg: (location: UrlLocation) => Msg,
): Sub<Msg> {
  return {
    key,
    start(dispatch) {
      const handler = () => {
        dispatch(toMsg(currentUrl()))
      }
      window.addEventListener("popstate", handler)
      return {
        teardown() {
          window.removeEventListener("popstate", handler)
        },
      }
    },
  }
}

/**
 * Subscribe to hash changes specifically.
 * More targeted than `onUrlChange` if you only care about hash routing.
 *
 * @param key    Unique subscription key for diffing.
 * @param toMsg  Transform the new hash (including the # prefix) into a message.
 */
export function onHashChange<Msg>(
  key: string,
  toMsg: (hash: string) => Msg,
): Sub<Msg> {
  return {
    key,
    start(dispatch) {
      const handler = () => {
        dispatch(toMsg(window.location.hash))
      }
      window.addEventListener("hashchange", handler)
      return {
        teardown() {
          window.removeEventListener("hashchange", handler)
        },
      }
    },
  }
}
