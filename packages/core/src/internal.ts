/**
 * internal.ts: Re-exports of low-level building blocks intended for use by
 * adjacent @static-dom packages (vdom, react). Not part of the stable public
 * API and not re-exported from the package root.
 */

export { makeSDOM } from "./types"
export { guard } from "./errors"
