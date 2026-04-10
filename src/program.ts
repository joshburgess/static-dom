/**
 * program.ts
 *
 * The top-level "tie the knot" function: takes an SDOM component and an
 * update loop, mounts everything, and returns a handle for teardown.
 *
 * This is the equivalent of PureScript's `attach` function that feeds
 * the event stream back into itself.
 *
 * Design:
 *   - `program` is the simple synchronous version (all updates are sync).
 *   - `programWithEffects` adds async Cmd support (mirrors the Elm runtime).
 *
 * The separation of `program` from the constructors is intentional:
 * it makes the constructors testable in isolation (just call `.attach`
 * directly with a fake UpdateStream), and it keeps the runtime concern
 * separate from the UI description concern.
 */

import { createSignal, toUpdateStream, type Dispatcher } from "./observable"
import type { SDOM, Teardown } from "./types"

// ---------------------------------------------------------------------------
// Program types
// ---------------------------------------------------------------------------

export interface ProgramConfig<Model, Msg> {
  /** The root DOM node to mount into. */
  container: Element
  /** Initial application state. */
  init: Model
  /** Pure state transition function. */
  update: (msg: Msg, model: Model) => Model
  /** The SDOM component tree. */
  view: SDOM<Model, Msg>
  /**
   * Optional middleware called after every update.
   * Use for logging, persistence, analytics, etc.
   */
  onUpdate?: (msg: Msg, prev: Model, next: Model) => void
}

export interface ProgramHandle<Model, Msg> {
  /** Programmatically dispatch a message (e.g. from tests or external events). */
  dispatch: Dispatcher<Msg>
  /** Get the current model. */
  getModel: () => Model
  /** Tear down the entire program (remove DOM nodes, cancel subscriptions). */
  teardown: () => void
}

// ---------------------------------------------------------------------------
// program
// ---------------------------------------------------------------------------

/**
 * Mount an SDOM program.
 *
 * This is the function that "ties the knot":
 *   1. Creates a mutable Signal for the model.
 *   2. Derives an UpdateStream from it.
 *   3. Creates a Dispatcher that runs `update` and pushes to the signal.
 *   4. Calls `view.attach` once to create the initial DOM and wire subscriptions.
 *
 * After this call, the DOM is live: dispatching messages will synchronously
 * update the model signal, which fires the update stream, which directly
 * patches the DOM leaves — no diffing, no virtual DOM.
 */
export function program<Model, Msg>(
  config: ProgramConfig<Model, Msg>
): ProgramHandle<Model, Msg> {
  const { container, init, update, view, onUpdate } = config

  const modelSignal = createSignal(init)
  const updates = toUpdateStream(modelSignal)

  let viewTeardown: Teardown | null = null

  const dispatch: Dispatcher<Msg> = (msg: Msg) => {
    const prev = modelSignal.value
    const next = update(msg, prev)
    onUpdate?.(msg, prev, next)
    modelSignal.setValue(next)
  }

  // Mount the view once. This is the ONLY time DOM structure is created.
  viewTeardown = view.attach(container, init, updates, dispatch)

  return {
    dispatch,
    getModel: () => modelSignal.value,
    teardown() {
      viewTeardown?.teardown()
      viewTeardown = null
    },
  }
}

// ---------------------------------------------------------------------------
// programWithEffects
// ---------------------------------------------------------------------------

/**
 * A Cmd is an async side-effect that eventually produces a Msg.
 * This mirrors the Elm runtime's Cmd type.
 *
 * A Cmd is just a function that takes a dispatch callback and
 * does async work, dispatching zero or more messages when done.
 */
export type Cmd<Msg> = (dispatch: Dispatcher<Msg>) => void

/** No-op command. */
export const noCmd = <Msg>(): Cmd<Msg> => (_dispatch) => {}

/** Batch multiple commands. */
export const batchCmd =
  <Msg>(...cmds: Cmd<Msg>[]): Cmd<Msg> =>
  dispatch =>
    cmds.forEach(cmd => cmd(dispatch))

export interface EffectProgramConfig<Model, Msg> {
  container: Element
  init: [Model, Cmd<Msg>]
  update: (msg: Msg, model: Model) => [Model, Cmd<Msg>]
  view: SDOM<Model, Msg>
  onUpdate?: (msg: Msg, prev: Model, next: Model) => void
}

/**
 * Like `program`, but `update` also returns a `Cmd<Msg>` for async effects.
 *
 * This is the pattern that makes the library usable as an Elm-style runtime,
 * enabling the "Elm adapter" step described in the roadmap.
 */
export function programWithEffects<Model, Msg>(
  config: EffectProgramConfig<Model, Msg>
): ProgramHandle<Model, Msg> {
  const { container, init: [initModel, initCmd], update, view, onUpdate } = config

  const modelSignal = createSignal(initModel)
  const updates = toUpdateStream(modelSignal)

  let viewTeardown: Teardown | null = null

  // dispatch is defined before mount because event handlers close over it
  const dispatch: Dispatcher<Msg> = (msg: Msg) => {
    const prev = modelSignal.value
    const [next, cmd] = update(msg, prev)
    onUpdate?.(msg, prev, next)
    modelSignal.setValue(next)
    // Execute the command — async, will dispatch more messages later
    cmd(dispatch)
  }

  viewTeardown = view.attach(container, initModel, updates, dispatch)

  // Run the init command
  initCmd(dispatch)

  return {
    dispatch,
    getModel: () => modelSignal.value,
    teardown() {
      viewTeardown?.teardown()
      viewTeardown = null
    },
  }
}
