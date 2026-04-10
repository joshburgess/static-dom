/**
 * dev.ts — Development-mode invariant validation.
 *
 * All functions in this module are no-ops when `__SDOM_DEV__` is false.
 * Bundlers (esbuild, Rollup, webpack) replace `process.env.NODE_ENV`
 * at build time, making the dead code tree-shakeable in production.
 *
 * ─────────────────────────────────────────────────────────────────────
 * INVARIANTS CHECKED
 * ─────────────────────────────────────────────────────────────────────
 *
 *   1. Child list length stability — `element` children must be a fixed
 *      length array. If someone accidentally passes a dynamically-sized
 *      array as children (instead of using `array`), we warn.
 *
 *   2. Model shape stability — when the model changes, we check that
 *      the set of keys hasn't changed. A changed shape usually indicates
 *      a bug where different model types are flowing through the same
 *      SDOM node.
 *
 *   3. Duplicate array keys — the `array` constructor requires unique
 *      keys. Duplicate keys cause silent DOM corruption.
 */

// ---------------------------------------------------------------------------
// Dev flag — checked at call sites for tree shaking
// ---------------------------------------------------------------------------

/**
 * Master dev-mode flag. Defaults to true unless NODE_ENV is "production".
 * Can also be toggled programmatically for testing.
 */
export let __SDOM_DEV__ =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  process.env["NODE_ENV"] !== "production"

/** Override the dev flag (useful in tests). */
export function setDevMode(enabled: boolean): void {
  __SDOM_DEV__ = enabled
}

// ---------------------------------------------------------------------------
// Warning infrastructure
// ---------------------------------------------------------------------------

type WarningHandler = (message: string) => void

let warnHandler: WarningHandler = (msg) => console.warn(`[sdom/dev] ${msg}`)

/**
 * Replace the dev-mode warning handler.
 * Returns a restore function.
 */
export function setDevWarningHandler(handler: WarningHandler): () => void {
  const prev = warnHandler
  warnHandler = handler
  return () => { warnHandler = prev }
}

function warn(msg: string): void {
  warnHandler(msg)
}

// Dedup: only warn once per unique message to avoid flooding the console
const warnedOnce = new Set<string>()

function warnOnce(key: string, msg: string): void {
  if (!warnedOnce.has(key)) {
    warnedOnce.add(key)
    warn(msg)
  }
}

/** Reset the dedup set (for testing). */
export function resetDevWarnings(): void {
  warnedOnce.clear()
}

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

/**
 * Validate that an element's children array length is static.
 * Called once at construction time in `element()`.
 */
export function validateChildrenLength(
  tag: string,
  childrenLength: number
): (nextLength: number) => void {
  if (!__SDOM_DEV__) return () => {}

  const expected = childrenLength
  return (nextLength: number) => {
    if (nextLength !== expected) {
      warn(
        `element<"${tag}"> children length changed from ${expected} to ${nextLength}. ` +
        `SDOM requires static children — use \`array\` for dynamic lists.`
      )
    }
  }
}

/**
 * Validate that a model's top-level keys haven't changed shape.
 * Returns a checker function that should be called on each update.
 */
export function validateModelShape(
  context: string,
  initialModel: unknown
): (nextModel: unknown) => void {
  if (!__SDOM_DEV__) return () => {}

  if (initialModel == null || typeof initialModel !== "object") return () => {}

  const initialKeys = Object.keys(initialModel).sort().join(",")

  return (nextModel: unknown) => {
    if (nextModel == null || typeof nextModel !== "object") {
      warnOnce(
        `shape:${context}:null`,
        `${context}: model changed from object to ${nextModel === null ? "null" : typeof nextModel}. ` +
        `This usually indicates a type mismatch.`
      )
      return
    }

    const nextKeys = Object.keys(nextModel).sort().join(",")
    if (nextKeys !== initialKeys) {
      warnOnce(
        `shape:${context}:${nextKeys}`,
        `${context}: model shape changed. ` +
        `Initial keys: [${initialKeys}], new keys: [${nextKeys}]. ` +
        `This may indicate different model types flowing through the same SDOM node.`
      )
    }
  }
}

/**
 * Validate that array keys are unique.
 * Called on every reconciliation in `array()`.
 */
export function validateUniqueKeys(
  keys: Iterable<string>,
  context: string
): void {
  if (!__SDOM_DEV__) return

  const seen = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) {
      warn(
        `${context}: duplicate key "${key}" in array items. ` +
        `Each item must have a unique key for correct DOM reuse.`
      )
      return // Only warn once per reconciliation
    }
    seen.add(key)
  }
}
