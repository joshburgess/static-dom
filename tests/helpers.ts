/**
 * Shared test utilities — create signals, mount SDOM nodes, dispatch updates.
 */

import { createSignal, toUpdateStream, type Signal, type UpdateStream, type Dispatcher } from "../src/observable"
import type { SDOM, Teardown } from "../src/types"

export interface TestHarness<Model, Msg> {
  container: HTMLElement
  signal: Signal<Model>
  updates: UpdateStream<Model>
  dispatched: Msg[]
  dispatch: Dispatcher<Msg>
  teardown: Teardown
  /** Update the model and synchronously flush to DOM. */
  set(model: Model): void
}

/**
 * Mount an SDOM node in a fresh container with a test signal.
 * Returns a harness for driving updates and inspecting results.
 */
export function mount<Model, Msg>(
  sdom: SDOM<Model, Msg>,
  initialModel: Model
): TestHarness<Model, Msg> {
  const container = document.createElement("div")
  document.body.appendChild(container)

  const signal = createSignal(initialModel)
  const updates = toUpdateStream(signal)
  const dispatched: Msg[] = []
  const dispatch: Dispatcher<Msg> = msg => dispatched.push(msg)

  const teardown = sdom.attach(container, initialModel, updates, dispatch)

  return {
    container,
    signal,
    updates,
    dispatched,
    dispatch,
    teardown,
    set(model: Model) {
      signal.setValue(model)
    },
  }
}

/** Clean up a test harness. */
export function cleanup(harness: { teardown: Teardown; container: HTMLElement }): void {
  harness.teardown.teardown()
  harness.container.remove()
}
