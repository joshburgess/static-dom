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

// Core types
export type { SDOM, Teardown, AttrInput, KeyedItem, ArrayContext } from "./types"

// Optics
export type { Lens, Prism, Iso } from "./optics"
export { lens, prop, composeLenses, prism, unionMember, nullablePrism, iso, indexLens } from "./optics"

// Observable primitives (useful for building adapters)
export type { Observable, UpdateStream, Dispatcher, Update, Signal } from "./observable"
export { createSignal, toUpdateStream, mapUpdate, contramapDispatcher } from "./observable"

// Constructors
export { text, staticText, element, array, optional, component, fragment, wrapChannel } from "./constructors"

// Program runners
export type { ProgramConfig, ProgramHandle, EffectProgramConfig, DeltaProgramConfig, Cmd } from "./program"
export { program, programWithEffects, programWithDelta, noCmd, batchCmd } from "./program"

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
  keyedInsert, keyedRemove, keyedMove, keyedPatch, keyedOps,
  ops, diffKeyed,
  fields, applyRecord, fieldDelta, produce,
} from "./patch"
