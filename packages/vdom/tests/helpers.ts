/**
 * Test utilities: create a signal, mount an SDOM node, dispatch updates.
 * Uses only the public @static-dom/core API.
 */

import {
  createSignal,
  toUpdateStream,
  type SDOM,
  type Signal,
  type Teardown,
  type UpdateStream,
  type Dispatcher,
} from "@static-dom/core"

export interface TestHarness<Model, Msg> {
  container: HTMLElement
  signal: Signal<Model>
  updates: UpdateStream<Model>
  dispatched: Msg[]
  dispatch: Dispatcher<Msg>
  teardown: Teardown
  set(model: Model): void
}

export function mount<Model, Msg>(
  sdom: SDOM<Model, Msg>,
  initialModel: Model,
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

export function cleanup(harness: { teardown: Teardown; container: HTMLElement }): void {
  harness.teardown.teardown()
  harness.container.remove()
}
