/**
 * index.ts — Public API
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SDOM — Static DOM
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A UI library that eliminates virtual DOM diffing by encoding the
 * guarantee that DOM structure never changes after initial mount.
 * Only leaf values (text content, attributes) are updated in place.
 *
 * Core idea from Phil Freeman's purescript-sdom (2018):
 *   https://github.com/paf31/purescript-sdom
 *   https://blog.functorial.com/posts/2018-03-12-You-Might-Not-Need-The-Virtual-DOM.html
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUICK START
 * ─────────────────────────────────────────────────────────────────────────
 *
 * @example
 * ```typescript
 * import { element, text, array, program } from "@your-org/sdom"
 * import { prop } from "@your-org/sdom/optics"
 *
 * // ── Model ──────────────────────────────────────────────────────────
 * interface Todo { id: string; text: string; done: boolean }
 * interface Model { todos: Todo[]; input: string }
 *
 * // ── Messages ───────────────────────────────────────────────────────
 * type Msg =
 *   | { type: "inputChanged"; value: string }
 *   | { type: "addTodo" }
 *   | { type: "toggleTodo"; id: string }
 *
 * // ── Update ─────────────────────────────────────────────────────────
 * function update(msg: Msg, model: Model): Model {
 *   switch (msg.type) {
 *     case "inputChanged":
 *       return { ...model, input: msg.value }
 *     case "addTodo":
 *       return {
 *         todos: [...model.todos, { id: crypto.randomUUID(), text: model.input, done: false }],
 *         input: "",
 *       }
 *     case "toggleTodo":
 *       return {
 *         ...model,
 *         todos: model.todos.map(t => t.id === msg.id ? { ...t, done: !t.done } : t),
 *       }
 *   }
 * }
 *
 * // ── View ───────────────────────────────────────────────────────────
 * const todoItem = element("li", {
 *   classes: m => ({ done: m.done }),
 *   on: { click: (_e, m) => ({ type: "toggleTodo", id: m.id }) },
 * }, [
 *   text(m => m.text),
 * ])
 *
 * const view = element("div", {}, [
 *   element("input", {
 *     attrs: { value: m => m.input, placeholder: () => "New todo..." },
 *     on: {
 *       input: (e, _m) => ({
 *         type: "inputChanged",
 *         value: (e.target as HTMLInputElement).value,
 *       }),
 *     },
 *   }, []),
 *   element("button", {
 *     on: { click: (_e, _m) => ({ type: "addTodo" }) },
 *   }, [text(() => "Add")]),
 *   array(
 *     "ul",
 *     m => m.todos.map(t => ({ key: t.id, model: t })),
 *     todoItem
 *   ),
 * ])
 *
 * // ── Mount ──────────────────────────────────────────────────────────
 * program({
 *   container: document.getElementById("app")!,
 *   init: { todos: [], input: "" },
 *   update,
 *   view,
 * })
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE LENS PATTERN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Use `focus` to reuse components that operate on a sub-model:
 *
 * @example
 * ```typescript
 * import { prop } from "@your-org/sdom/optics"
 *
 * // A reusable input component that only knows about `string`:
 * const stringInput = element("input", {
 *   attrs: { value: m => m },
 *   on: { input: (e, _m) => (e.target as HTMLInputElement).value },
 * }, [])
 * // ^ SDOM<string, string>
 *
 * // Focus it onto the `name` field of a larger model:
 * const nameInput = stringInput
 *   .focus(prop<User>()("name"))
 *   .mapMsg(newName => ({ type: "nameChanged", newName } as const))
 * // ^ SDOM<User, { type: "nameChanged"; newName: string }>
 * ```
 */

// Error boundaries
export type { SDOMError, ErrorHandler, ErrorPhase } from "./errors"
export { setErrorHandler, setGuardEnabled } from "./errors"

// Dev mode
export { setDevMode, setDevWarningHandler, resetDevWarnings } from "./dev"

// Core types
export type { SDOM, Teardown, AttrInput, KeyedItem, ArrayContext, Focusable } from "./types"

// Optics
export type {
  OpticTypeLambda, Kind, IsoTypeLambda, LensTypeLambda, PrismTypeLambda, AffineTypeLambda,
  ComposeOptics, ComposeWithGetter,
  OpticBase, Iso, Lens, Prism, Affine, Traversal,
  Getter, Fold, Setter, Review,
  // Backward compat
  OpticKind, ComposeKinds, KindToLambda, ResolveOptic, Optic,
} from "./optics"
export {
  isoOf, lensOf, prismOf, affineOf, traversal,
  iso, lens, prism,
  getterOf, foldOf, setterOf, reviewOf,
  toGetter, toFold, toSetter, toReview,
  prop, at, composeLenses,
  unionMember, nullablePrism, indexLens,
  each, values, filtered,
} from "./optics"

// Observable primitives (useful for building adapters)
export type { Observable, UpdateStream, Dispatcher, Update, Signal, Observer, Unsubscribe } from "./observable"
export { createSignal, toUpdateStream, mapUpdate, contramapDispatcher } from "./observable"

// Incremental computation graph (OCaml-Incremental flavor).
// `Var` is a writable leaf cell; `Cell` is a read-only derived cell.
// `mapCell` / `mapCell2` build derivations with diamond-correct cutoff;
// `batch` collapses multiple sets into one stabilize sweep;
// `cellToUpdateStream` bridges into the existing UpdateStream surface.
export type { Cell, Var } from "./incremental-graph"
export {
  makeVar,
  mapCell,
  mapCell2,
  mapCell3,
  bindCell,
  batch,
  stabilize,
  disposeCell,
  cellToUpdateStream,
} from "./incremental-graph"

// Optic lifts over the graph. The optic's equality becomes the derived
// cell's cutoff: fields the optic does not read never propagate, fields
// whose lens-equality says "unchanged" never fire observers. `focusVar`
// turns a `Var<S>` plus a `Lens<S, A>` into a `Var<A>` with write-back.
export { liftGetter, liftLens, liftPrism, liftAffine, liftFold, focusVar, bindPrism } from "./incremental-optics"

// Constructors
export { text, staticText, element, array, arrayBy, indexedArray, optional, match, dynamic, component, compiled, compiledState, fragment, wrapChannel, lis } from "./constructors"

// Program runners
export type { ProgramConfig, ProgramHandle, EffectProgramConfig, DeltaProgramConfig, SubProgramConfig, ElmProgramConfig, Cmd } from "./program"
export { program, programWithEffects, programWithDelta, programWithSub, elmProgram, noCmd, batchCmd } from "./program"

// Subscriptions (Elm-style)
export type { Sub } from "./subscription"
export { noneSub, batchSub, interval, animationFrame, onWindow, onDocument } from "./subscription"

// Incremental (delta-based updates)
export { incrementalArray } from "./incremental"
export type {
  AtomDelta, ArrayOp, ArrayDelta, ArrayInsert, ArrayRemove, ArrayMove, ArrayPatch,
  KeyedOp, KeyedArrayDelta, KeyedInsert, KeyedRemove, KeyedMove, KeyedPatch,
  RecordDelta, FieldDeltas,
} from "./patch"
export {
  noop, replace, applyAtom, applyArrayOp, applyArrayDelta,
  insert, remove, move, patch,
  keyedInsert, keyedRemove, keyedMove, keyedPatch, keyedOps, keyedOp1,
  pooledKeyedPatch, pooledKeyedRemove, pooledKeyedInsert,
  ops, diffKeyed, diffRecord, autoDelta,
  fields, applyRecord, fieldDelta, produce,
} from "./patch"

// Event delegation (from Inferno)
export type { EventDelegator } from "./delegation"
export { createDelegator, registerEvent, delegateEvent } from "./delegation"

// JSX utilities
export { typed } from "./jsx-runtime"

// Cmd constructors (Elm-style commands)
export type { HttpRequest } from "./cmd"
export { mapCmd, httpRequest, httpGetJson, httpPostJson, randomInt, randomFloat, delay, nextTick } from "./cmd"

// Navigation (URL-based routing)
export type { UrlLocation } from "./navigation"
export { currentUrl, pushUrl, replaceUrl, back, forward, onUrlChange, onHashChange } from "./navigation"

// Ports (typed JS interop)
export type { InPort, OutPort } from "./ports"
export { createInPort, createOutPort, portSub, portCmd } from "./ports"
