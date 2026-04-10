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
 * Call `fn` inside a try/catch. If it throws, report via the error handler
 * and return `fallback`.
 */
export function guard<T>(
  phase: ErrorPhase,
  context: string,
  fn: () => T,
  fallback: T
): T {
  try {
    return fn()
  } catch (error) {
    currentHandler({ error, phase, context })
    return fallback
  }
}

/**
 * Wrap a unary function so it catches and reports errors, returning `fallback`.
 * Used to wrap derive functions like `(model: M) => string`.
 */
export function guardFn<A, R>(
  phase: ErrorPhase,
  context: string,
  fn: (a: A) => R,
  fallback: R
): (a: A) => R {
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
 * Used for event handlers `(event, model) => Msg | null`.
 */
export function guardFn2<A, B, R>(
  phase: ErrorPhase,
  context: string,
  fn: (a: A, b: B) => R,
  fallback: R
): (a: A, b: B) => R {
  return (a: A, b: B): R => {
    try {
      return fn(a, b)
    } catch (error) {
      currentHandler({ error, phase, context })
      return fallback
    }
  }
}
