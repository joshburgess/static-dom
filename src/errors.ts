/**
 * errors.ts — Error boundary infrastructure.
 *
 * SDOM wraps all user-provided callbacks (derive functions, event handlers,
 * subscription observers) in try/catch. Caught errors are routed to a
 * configurable handler rather than crashing the whole component tree.
 *
 * The default handler logs to console.error. Replace it with
 * `setErrorHandler` for custom reporting (Sentry, toast UI, etc.).
 *
 * ─────────────────────────────────────────────────────────────────────
 * DESIGN
 * ─────────────────────────────────────────────────────────────────────
 *
 * We deliberately keep this simple:
 *   - One global handler (not per-component). Per-component boundaries
 *     add complexity for minimal gain in a static-DOM library where
 *     the tree structure is fixed.
 *   - The handler receives the error and a string `phase` tag so you
 *     can distinguish mount-time vs. update-time failures.
 *   - `guardFn` wraps a function so it never throws. Used internally
 *     by constructors to wrap derive functions and event handlers.
 */

// ---------------------------------------------------------------------------
// Error handler type
// ---------------------------------------------------------------------------

export type ErrorPhase = "attach" | "update" | "event" | "teardown"

export interface SDOMError {
  /** The original error. */
  readonly error: unknown
  /** Which phase of the SDOM lifecycle the error occurred in. */
  readonly phase: ErrorPhase
  /** Human-readable context (e.g. "text derive", "element onClick"). */
  readonly context: string
}

export type ErrorHandler = (err: SDOMError) => void

// ---------------------------------------------------------------------------
// Global handler
// ---------------------------------------------------------------------------

let currentHandler: ErrorHandler = defaultErrorHandler

function defaultErrorHandler(err: SDOMError): void {
  console.error(`[sdom] Error during ${err.phase} (${err.context}):`, err.error)
}

/**
 * Replace the global error handler.
 * Returns a restore function that puts back the previous handler.
 */
export function setErrorHandler(handler: ErrorHandler): () => void {
  const prev = currentHandler
  currentHandler = handler
  return () => { currentHandler = prev }
}

/** Get the current error handler (used internally). */
export function getErrorHandler(): ErrorHandler {
  return currentHandler
}

// ---------------------------------------------------------------------------
// Guard utilities — wrap user-provided functions so they never throw
// ---------------------------------------------------------------------------

/**
 * Whether error boundaries are active. When false, guard/guardFn/guardFn2
 * skip try/catch entirely — zero overhead on the hot path.
 *
 * Defaults to true. Set to false in production for maximum performance
 * when you trust your derive functions won't throw.
 */
export let __SDOM_GUARD__ = true

/** Enable or disable error boundary guards at runtime. */
export function setGuardEnabled(enabled: boolean): void {
  __SDOM_GUARD__ = enabled
}

/**
 * Call `fn` inside a try/catch. If it throws, report via the error handler
 * and return `fallback`. When `__SDOM_GUARD__` is false, calls `fn` directly.
 */
export function guard<T>(
  phase: ErrorPhase,
  context: string,
  fn: () => T,
  fallback: T
): T {
  if (!__SDOM_GUARD__) return fn()
  try {
    return fn()
  } catch (error) {
    currentHandler({ error, phase, context })
    return fallback
  }
}

/**
 * Like `guard`, but takes a unary function and its argument separately.
 * Avoids allocating a closure just to call `fn(arg)`.
 */
export function guardApply<A, R>(
  phase: ErrorPhase,
  context: string,
  fn: (a: A) => R,
  arg: A,
  fallback: R
): R {
  if (!__SDOM_GUARD__) return fn(arg)
  try {
    return fn(arg)
  } catch (error) {
    currentHandler({ error, phase, context })
    return fallback
  }
}

/**
 * Wrap a unary function so it catches and reports errors, returning `fallback`.
 * When `__SDOM_GUARD__` is false, returns `fn` directly (zero wrapper overhead).
 */
export function guardFn<A, R>(
  phase: ErrorPhase,
  context: string,
  fn: (a: A) => R,
  fallback: R
): (a: A) => R {
  if (!__SDOM_GUARD__) return fn
  return (a: A): R => {
    try {
      return fn(a)
    } catch (error) {
      currentHandler({ error, phase, context })
      return fallback
    }
  }
}

/**
 * Wrap a binary function so it catches and reports errors.
 * When `__SDOM_GUARD__` is false, returns `fn` directly.
 */
export function guardFn2<A, B, R>(
  phase: ErrorPhase,
  context: string,
  fn: (a: A, b: B) => R,
  fallback: R
): (a: A, b: B) => R {
  if (!__SDOM_GUARD__) return fn
  return (a: A, b: B): R => {
    try {
      return fn(a, b)
    } catch (error) {
      currentHandler({ error, phase, context })
      return fallback
    }
  }
}
