/**
 * Tests for the Focusable protocol — verifies that .focus() works with
 * third-party optics that satisfy the structural interface.
 */
import { describe, it, expect } from "vitest"
import { element, text, program, prop } from "../src/index"
import type { Focusable } from "../src/index"

// ---------------------------------------------------------------------------
// Mock "third-party" optics — simulates fp-ts, Effect, monocle-ts, etc.
// ---------------------------------------------------------------------------

/** Minimal lens with only `get` — no compose, no getDelta. */
function minimalLens<S, A>(getter: (s: S) => A): Focusable<S, A> {
  return { get: getter }
}

/** Lens with get + compose — enables focus fusion. */
function composableLens<S, A>(
  getter: (s: S) => A,
): Focusable<S, A> & { compose: <B>(that: Focusable<A, B>) => Focusable<S, B> } {
  return {
    get: getter,
    compose<B>(that: Focusable<A, B>): Focusable<S, B> {
      const self = this
      return composableLens<S, B>((s: S) => that.get(self.get(s)))
    },
  }
}

/**
 * Simulates an fp-ts style lens.
 * fp-ts Lens has: { get: (s: S) => A, set: (a: A) => (s: S) => S }
 * and a compose method.
 */
function fptsStyleLens<S, A>(
  getter: (s: S) => A,
  setter: (a: A) => (s: S) => S,
) {
  return {
    get: getter,
    set: setter,
    compose<B>(that: { get: (a: A) => B; set: (b: B) => (a: A) => A }) {
      return fptsStyleLens<S, B>(
        (s: S) => that.get(getter(s)),
        (b: B) => (s: S) => setter(that.set(b)(getter(s)))(s),
      )
    },
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

interface User { name: string; age: number }
interface Model { user: User }

const testModel: Model = { user: { name: "Alice", age: 30 } }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Focusable protocol", () => {
  it("minimal lens (get only) works with .focus()", () => {
    const view = element<"div", User, never>("div", {}, [
      text(u => u.name),
    ])

    const lens = minimalLens<Model, User>(m => m.user)
    const focused = view.focus(lens)

    const container = document.createElement("div")
    focused.attach(
      container,
      testModel,
      { subscribe: () => ({ unsubscribe() {} }) },
      () => {},
    )
    expect(container.textContent).toBe("Alice")
  })

  it("composable lens enables focus fusion", () => {
    const innerView = element<"span", string, never>("span", {}, [
      text(s => s),
    ])

    const userLens = composableLens<Model, User>(m => m.user)
    const nameLens = composableLens<User, string>(u => u.name)

    // Two consecutive .focus() calls — should fuse into one
    const focused = innerView.focus(nameLens).focus(userLens)

    const container = document.createElement("div")
    focused.attach(
      container,
      testModel,
      { subscribe: () => ({ unsubscribe() {} }) },
      () => {},
    )
    expect(container.textContent).toBe("Alice")
  })

  it("fp-ts style lens works with .focus()", () => {
    const view = element<"div", User, never>("div", {}, [
      text(u => `${u.name}, ${u.age}`),
    ])

    const lens = fptsStyleLens<Model, User>(
      m => m.user,
      user => m => ({ ...m, user }),
    )
    const focused = view.focus(lens)

    const container = document.createElement("div")
    focused.attach(
      container,
      testModel,
      { subscribe: () => ({ unsubscribe() {} }) },
      () => {},
    )
    expect(container.textContent).toBe("Alice, 30")
  })

  it("static-dom's own Lens still works (backward compat)", () => {
    const view = element<"div", User, never>("div", {}, [
      text(u => u.name),
    ])

    const lens = prop<Model>()("user")
    const focused = view.focus(lens)

    const container = document.createElement("div")
    focused.attach(
      container,
      testModel,
      { subscribe: () => ({ unsubscribe() {} }) },
      () => {},
    )
    expect(container.textContent).toBe("Alice")
  })

  it("minimal lens without compose skips fusion gracefully", () => {
    const innerView = element<"span", string, never>("span", {}, [
      text(s => s),
    ])

    // Two .focus() calls with minimal lenses (no compose) — no fusion,
    // but still works correctly via intermediate subscription layers.
    const userLens = minimalLens<Model, User>(m => m.user)
    const nameLens = minimalLens<User, string>(u => u.name)

    const focused = innerView.focus(nameLens).focus(userLens)

    const container = document.createElement("div")
    focused.attach(
      container,
      testModel,
      { subscribe: () => ({ unsubscribe() {} }) },
      () => {},
    )
    expect(container.textContent).toBe("Alice")
  })
})
