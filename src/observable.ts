/**
 * observable.ts
 *
 * A minimal typed Observable / Signal abstraction.
 *
 * We deliberately avoid importing RxJS or any signal library so that:
 *   1. The SDOM library has zero dependencies.
 *   2. Adapters can bridge from any external reactive system.
 *
 * The key contract:
 *   - An `Observable<T>` is a cold stream you can subscribe to.
 *   - A `Subject<T>` is both an Observable and a way to push new values.
 *   - A `ReadonlySignal<T>` adds a synchronous `.value` getter (like Preact Signals).
 *
 * Downstream code only ever sees `Observable<T>`; the `Subject` and `Signal`
 * implementations are internal or used at the top-level app boundary.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** A function that receives values and returns a teardown. */
export type Observer<T> = (value: T) => void

/** Unsubscribe handle returned from `.subscribe`. */
export type Unsubscribe = () => void

/**
 * A cold, synchronous-compatible observable.
 * Intentionally simple: no error channel, no completion.
 * SDOM update streams are infinite by design (the UI lives until detached).
 */
export interface Observable<T> {
  subscribe(observer: Observer<T>): Unsubscribe
}

/**
 * An Observable that also exposes the current value synchronously.
 * Used for the model update stream so `attach` can read the initial model
 * without waiting for the first emission.
 */
export interface ReadonlySignal<T> extends Observable<T> {
  readonly value: T
}

/** A mutable signal — the write side of ReadonlySignal. */
export interface Signal<T> extends ReadonlySignal<T> {
  setValue(next: T): void
}

// ---------------------------------------------------------------------------
// Pair type — the update stream always carries (previous, next) so that
// `attach` can do equality checks per-leaf without storing its own last-seen.
// ---------------------------------------------------------------------------

export interface Update<T> {
  readonly prev: T
  readonly next: T
  /**
   * Optional structured delta describing what changed between prev and next.
   * When present, consumers (like `focus`) can inspect it to skip unchanged
   * subtrees without calling `get` on every lens. The type is intentionally
   * `unknown` at this layer — concrete delta types are in patch.ts.
   */
  readonly delta?: unknown
}

/** The stream type that `attach` consumes. */
export type UpdateStream<T> = Observable<Update<T>>

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

/** Create a mutable Signal. */
export function createSignal<T>(initial: T): Signal<T> {
  let current = initial
  const subscribers = new Set<Observer<T>>()

  return {
    get value() {
      return current
    },
    setValue(next: T) {
      current = next
      subscribers.forEach(fn => fn(next))
    },
    subscribe(observer: Observer<T>): Unsubscribe {
      subscribers.add(observer)
      return () => subscribers.delete(observer)
    },
  }
}

/**
 * Derive an UpdateStream from a Signal.
 * Every time the signal changes we emit { prev, next }.
 */
export function toUpdateStream<T>(signal: Signal<T>): UpdateStream<T> {
  return {
    subscribe(observer: Observer<Update<T>>): Unsubscribe {
      let prev = signal.value
      return signal.subscribe(next => {
        observer({ prev, next })
        prev = next
      })
    },
  }
}

/**
 * Map an UpdateStream to a narrower UpdateStream, only emitting when
 * the projected value has changed (by reference equality).
 *
 * This is what powers `focus`: when you zoom into a sub-model, updates
 * to *other* parts of the model are silently dropped for that subtree.
 */
export function mapUpdate<A, B>(
  stream: UpdateStream<A>,
  project: (a: A) => B,
  eq: (x: B, y: B) => boolean = (x, y) => x === y
): UpdateStream<B> {
  return {
    subscribe(observer: Observer<Update<B>>): Unsubscribe {
      return stream.subscribe(({ prev, next, delta }) => {
        const prevB = project(prev)
        const nextB = project(next)
        if (!eq(prevB, nextB)) {
          observer({ prev: prevB, next: nextB, delta })
        }
      })
    },
  }
}

/**
 * Merge multiple UpdateStreams into one.
 * Used internally by `array` to fan-out to item streams.
 */
export function mergeUpdates<T>(
  ...streams: UpdateStream<T>[]
): UpdateStream<T> {
  return {
    subscribe(observer: Observer<Update<T>>): Unsubscribe {
      const unsubs = streams.map(s => s.subscribe(observer))
      return () => unsubs.forEach(u => u())
    },
  }
}

// ---------------------------------------------------------------------------
// Dispatcher — the "Msg" side (events flowing back up)
// ---------------------------------------------------------------------------

/**
 * A typed function for dispatching messages upward.
 * Separating this from Observable makes the data-flow direction explicit:
 *   UpdateStream flows DOWN (model → DOM)
 *   Dispatcher flows UP   (DOM event → model update)
 */
export type Dispatcher<Msg> = (msg: Msg) => void

/**
 * Map a Dispatcher contravariantly.
 * If you have a `Dispatcher<ParentMsg>` and a function `f: ChildMsg -> ParentMsg`,
 * `contramapDispatcher(dispatcher, f)` gives you a `Dispatcher<ChildMsg>`.
 */
export function contramapDispatcher<A, B>(
  dispatcher: Dispatcher<A>,
  f: (b: B) => A
): Dispatcher<B> {
  return (b: B) => dispatcher(f(b))
}
