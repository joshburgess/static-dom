/**
 * react.ts — React adapter for SDOM
 *
 * Lets you drop SDOM subtrees into existing React apps as a performance
 * optimisation. React manages the component tree above the boundary;
 * SDOM manages everything inside it — no virtual DOM diffing.
 *
 * Two APIs:
 *   - `SDOMBoundary` — a component you render in JSX
 *   - `useSDOMBoundary` — a hook for attaching SDOM to your own ref
 *
 * @example
 * ```tsx
 * import { SDOMBoundary } from "static-dom-core/react"
 * import { myTableView } from "./views"
 *
 * function App({ model, onMsg }) {
 *   return (
 *     <div>
 *       <h1>Dashboard</h1>
 *       <SDOMBoundary sdom={myTableView} model={model} onMsg={onMsg} />
 *     </div>
 *   )
 * }
 * ```
 */

import {
  useRef,
  useEffect,
  createElement,
  memo,
  type ReactElement,
  type Ref,
} from "react"
import type { SDOM, Teardown } from "./types"
import type {
  Observer,
  Update,
  UpdateStream,
  Unsubscribe,
  Dispatcher,
} from "./observable"

// ---------------------------------------------------------------------------
// Bridge: converts React prop changes into SDOM's UpdateStream
// ---------------------------------------------------------------------------

interface Bridge<Model> {
  updates: UpdateStream<Model>
  push(prev: Model, next: Model): void
}

function createBridge<Model>(): Bridge<Model> {
  let observer: Observer<Update<Model>> | null = null

  // Reusable mutable update object — safe because SDOM observers
  // consume synchronously within the same call stack.
  const update = { prev: undefined, next: undefined } as unknown as {
    prev: Model
    next: Model
    delta?: unknown
  }

  return {
    updates: {
      subscribe(obs: Observer<Update<Model>>): Unsubscribe {
        observer = obs
        return () => {
          if (observer === obs) observer = null
        }
      },
    },
    push(prev: Model, next: Model) {
      if (observer) {
        update.prev = prev
        update.next = next
        update.delta = undefined
        observer(update as Update<Model>)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// useSDOMBoundary — hook API
// ---------------------------------------------------------------------------

/**
 * Low-level hook that manages the SDOM lifecycle.
 *
 * Returns a ref callback to attach to your container element. SDOM mounts
 * into that element on first render, pushes model updates when props change,
 * and tears down on unmount.
 *
 * @example
 * ```tsx
 * function MyComponent({ model, onMsg }) {
 *   const ref = useSDOMBoundary(myView, model, onMsg)
 *   return <div ref={ref} />
 * }
 * ```
 */
export function useSDOMBoundary<Model, Msg>(
  sdom: SDOM<Model, Msg>,
  model: Model,
  onMsg?: (msg: Msg) => void
): Ref<HTMLElement> {
  const stateRef = useRef<{
    bridge: Bridge<Model>
    teardown: Teardown | null
    model: Model
    sdom: SDOM<Model, Msg>
    onMsg: ((msg: Msg) => void) | undefined
    container: HTMLElement | null
  } | null>(null)

  // Initialize on first call
  if (stateRef.current === null) {
    stateRef.current = {
      bridge: createBridge<Model>(),
      teardown: null,
      model,
      sdom,
      onMsg,
      container: null,
    }
  }

  const state = stateRef.current

  // Keep onMsg fresh (avoids stale closures in dispatch)
  state.onMsg = onMsg

  // Push model updates synchronously during render
  if (state.model !== model && state.teardown !== null) {
    state.bridge.push(state.model, model)
    state.model = model
  }

  // Ref callback — called when the container element mounts/unmounts.
  const refCallback = useRef((el: HTMLElement | null) => {
    const s = stateRef.current!
    if (el && !s.teardown) {
      s.container = el
      const dispatch: Dispatcher<Msg> = (msg) => {
        s.onMsg?.(msg)
      }
      s.teardown = s.sdom.attach(el, s.model, s.bridge.updates, dispatch)
    }
  })

  // Teardown on unmount
  useEffect(() => {
    return () => {
      stateRef.current?.teardown?.teardown()
      if (stateRef.current) {
        stateRef.current.teardown = null
        stateRef.current.container = null
      }
    }
  }, [])

  // Handle sdom prop change — teardown and remount
  useEffect(() => {
    if (!state.container || state.sdom === sdom) return
    if (state.teardown) {
      state.teardown.teardown()
      state.container.textContent = ""
    }
    state.sdom = sdom
    state.bridge = createBridge<Model>()
    const dispatch: Dispatcher<Msg> = (msg) => {
      state.onMsg?.(msg)
    }
    state.teardown = sdom.attach(
      state.container,
      state.model,
      state.bridge.updates,
      dispatch
    )
  }, [sdom]) // eslint-disable-line react-hooks/exhaustive-deps

  return refCallback.current as unknown as Ref<HTMLElement>
}

// ---------------------------------------------------------------------------
// SDOMBoundary — component API
// ---------------------------------------------------------------------------

export interface SDOMBoundaryProps<Model, Msg> {
  /** The SDOM component tree to mount inside this boundary. */
  sdom: SDOM<Model, Msg>
  /** Current model state. When this changes, SDOM patches the DOM directly. */
  model: Model
  /** Called when the SDOM view dispatches a message. */
  onMsg?: (msg: Msg) => void
  /**
   * HTML tag for the container element.
   * @default "div"
   */
  as?: keyof HTMLElementTagNameMap
}

/**
 * React component that mounts an SDOM view inside a boundary element.
 *
 * React manages everything above this component. SDOM manages everything
 * inside it — no React diffing occurs within the boundary.
 *
 * When `model` changes, the update flows directly to SDOM's subscription
 * system, bypassing React's reconciler entirely.
 *
 * @example
 * ```tsx
 * <SDOMBoundary
 *   sdom={myExpensiveTable}
 *   model={tableModel}
 *   onMsg={handleTableMsg}
 * />
 * ```
 */
function SDOMBoundaryInner<Model, Msg>({
  sdom,
  model,
  onMsg,
  as: tag = "div",
}: SDOMBoundaryProps<Model, Msg>): ReactElement {
  const containerRef = useRef<HTMLElement | null>(null)
  const stateRef = useRef<{
    bridge: Bridge<Model>
    teardown: Teardown | null
    model: Model
    sdom: SDOM<Model, Msg>
    onMsg: ((msg: Msg) => void) | undefined
    container: HTMLElement | null
  } | null>(null)

  // Initialize state on first call
  if (stateRef.current === null) {
    stateRef.current = {
      bridge: createBridge<Model>(),
      teardown: null,
      model,
      sdom,
      onMsg,
      container: null,
    }
  }

  const state = stateRef.current

  // Keep onMsg fresh
  state.onMsg = onMsg

  // Push model updates synchronously during render
  if (state.model !== model && state.teardown !== null) {
    state.bridge.push(state.model, model)
    state.model = model
  }

  // Mount SDOM after first render
  useEffect(() => {
    const el = containerRef.current
    if (!el || state.teardown) return

    state.container = el
    const dispatch: Dispatcher<Msg> = (msg) => {
      state.onMsg?.(msg)
    }
    state.teardown = state.sdom.attach(
      el,
      state.model,
      state.bridge.updates,
      dispatch
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle sdom prop change — teardown and remount
  useEffect(() => {
    if (state.sdom === sdom) return
    const el = state.container
    if (!el || !state.teardown) {
      state.sdom = sdom
      return
    }

    // Teardown old
    state.teardown.teardown()
    // Clear the container — SDOM appended children during attach
    el.textContent = ""

    // Remount with new sdom
    state.sdom = sdom
    state.bridge = createBridge<Model>()
    const dispatch: Dispatcher<Msg> = (msg) => {
      state.onMsg?.(msg)
    }
    state.teardown = sdom.attach(
      el,
      state.model,
      state.bridge.updates,
      dispatch
    )
  }, [sdom]) // eslint-disable-line react-hooks/exhaustive-deps

  // Teardown on unmount
  useEffect(() => {
    return () => {
      state.teardown?.teardown()
      state.teardown = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return createElement(tag, { ref: containerRef })
}

/**
 * Memoized SDOMBoundary. React.memo prevents re-renders from parent
 * components that don't change the props we care about.
 *
 * Note: typed as a generic function via cast since React.memo loses
 * generic type parameters.
 */
export const SDOMBoundary = memo(SDOMBoundaryInner) as typeof SDOMBoundaryInner
