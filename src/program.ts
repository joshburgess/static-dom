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

import { createSignal, toUpdateStream, type Dispatcher, type Observer, type Update, type Unsubscribe, type UpdateStream } from "./observable"
import type { SDOM, Teardown } from "./types"
import { _tryFastPatch } from "./incremental"

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

// ---------------------------------------------------------------------------
// programWithDelta
// ---------------------------------------------------------------------------

export interface DeltaProgramConfig<Model, Msg> {
  container: Element
  init: Model
  /**
   * Like a normal update, but also returns a structured delta describing
   * what changed. The delta is threaded through the UpdateStream so that
   * `focus` (via lens.getDelta) can skip unchanged subtrees in O(1).
   *
   * Return `undefined` as the delta to fall back to reference-equality checks.
   */
  update: (msg: Msg, model: Model) => [Model, unknown | undefined]
  view: SDOM<Model, Msg>
  onUpdate?: (msg: Msg, prev: Model, next: Model, delta: unknown | undefined) => void
}

/**
 * Like `program`, but the update function returns `[Model, Delta?]`.
 *
 * The delta is attached to each Update emission so that `focus` can
 * use `lens.getDelta(delta)` to decide whether a subtree needs updating
 * without running `lens.get()`. This is the glue that makes the
 * incremental lambda calculus layer pay off end-to-end.
 */
export function programWithDelta<Model, Msg>(
  config: DeltaProgramConfig<Model, Msg>
): ProgramHandle<Model, Msg> {
  const { container, init, update, view, onUpdate } = config

  // Custom UpdateStream that carries deltas.
  // Single-observer fast path + reusable mutable Update object.
  let current = init
  let observer: Observer<Update<Model>> | null = null
  let observers: Set<Observer<Update<Model>>> | null = null

  // Reusable mutable update — safe because observers consume synchronously
  const updateObj = { prev: init, next: init } as { prev: Model; next: Model; delta?: unknown }

  const deltaUpdates: UpdateStream<Model> = {
    subscribe(obs: Observer<Update<Model>>): Unsubscribe {
      if (observer === null && observers === null) {
        observer = obs
      } else {
        if (observers === null) {
          observers = new Set()
          if (observer) { observers.add(observer); observer = null }
        }
        observers.add(obs)
      }
      return () => {
        if (observer === obs) { observer = null }
        else if (observers) { observers.delete(obs) }
      }
    },
  }

  let viewTeardown: Teardown | null = null

  const dispatch: Dispatcher<Msg> = (msg: Msg) => {
    const prev = current
    const [next, delta] = update(msg, prev)
    onUpdate?.(msg, prev, next, delta)
    current = next

    // Fast path: single keyedPatch delta → bypass subscription chain entirely.
    // This is the "compiled dispatch" optimization: delta → item updater, no observers.
    if (delta != null && typeof delta === "object") {
      const d = delta as { kind?: string; ops?: readonly { kind?: string; key?: string; value?: unknown }[] }
      if (d.kind === "ops" && d.ops !== undefined && d.ops.length === 1) {
        const op = d.ops[0]!
        if (op.kind === "patch" && op.key !== undefined && _tryFastPatch(op.key, op.value)) {
          return // Handled — skip normal subscription chain
        }
      }
    }

    // Normal path: fire all observers
    updateObj.prev = prev
    updateObj.next = next
    updateObj.delta = delta
    if (observer) {
      observer(updateObj as Update<Model>)
    } else if (observers) {
      observers.forEach(obs => obs(updateObj as Update<Model>))
    }
  }

  viewTeardown = view.attach(container, init, deltaUpdates, dispatch)

  return {
    dispatch,
    getModel: () => current,
    teardown() {
      viewTeardown?.teardown()
      viewTeardown = null
    },
  }
}
