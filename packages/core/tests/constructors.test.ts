import { describe, it, expect, afterEach } from "vitest"
import { component, compiled, compiledState, fragment, text, element } from "../src/constructors"
import { makeSDOM, type SDOM, type Teardown } from "../src/types"
import { attachToCell } from "../src/program"
import { makeVar } from "../src/incremental-graph"
import { mount, cleanup, type TestHarness } from "./helpers"
import type { UpdateStream } from "../src/observable"

let h: TestHarness<any, any>
afterEach(() => { if (h) cleanup(h) })

// ─────────────────────────────────────────────────────────────────────────────
// component
// ─────────────────────────────────────────────────────────────────────────────

describe("component", () => {
  it("creates a wrapper div and appends to parent", () => {
    const sdom = component<string, never>((el, _model, _dispatch) => {
      el.textContent = "hello"
      return { update: () => {}, teardown: () => {} }
    })
    h = mount(sdom, "init")
    const wrapper = h.container.querySelector("div")
    expect(wrapper).not.toBeNull()
    expect(wrapper!.textContent).toBe("hello")
  })

  it("passes the initial model to setup", () => {
    let receivedModel: string | undefined
    const sdom = component<string, never>((el, model, _dispatch) => {
      receivedModel = model
      el.textContent = model
      return { update: () => {}, teardown: () => {} }
    })
    h = mount(sdom, "initial-value")
    expect(receivedModel).toBe("initial-value")
  })

  it("calls update with the new model on model changes", () => {
    const updates: string[] = []
    const sdom = component<string, never>((el, model, _dispatch) => {
      el.textContent = model
      return {
        update: (next: string) => {
          updates.push(next)
          el.textContent = next
        },
        teardown: () => {},
      }
    })
    h = mount(sdom, "first")
    expect(updates).toEqual([])

    h.set("second")
    expect(updates).toEqual(["second"])

    h.set("third")
    expect(updates).toEqual(["second", "third"])
    expect(h.container.querySelector("div")!.textContent).toBe("third")
  })

  it("passes dispatch to setup for message emission", () => {
    const sdom = component<string, string>((_el, _model, dispatch) => {
      dispatch("hello-msg")
      return { update: () => {}, teardown: () => {} }
    })
    h = mount(sdom, "x")
    expect(h.dispatched).toEqual(["hello-msg"])
  })

  it("cleans up on teardown: unsubscribes, calls user teardown, removes div", () => {
    let tornDown = false
    const updates: string[] = []
    const sdom = component<string, never>((el, _model, _dispatch) => {
      return {
        update: (next: string) => { updates.push(next) },
        teardown: () => { tornDown = true },
      }
    })
    h = mount(sdom, "init")
    expect(h.container.querySelector("div")).not.toBeNull()

    h.teardown.teardown()
    expect(tornDown).toBe(true)
    expect(h.container.querySelector("div")).toBeNull()

    // After teardown, updates should not propagate
    h.set("after-teardown")
    expect(updates).toEqual([])

    // Prevent double-teardown in afterEach
    h.container.remove()
    h = undefined as any
  })

  describe("Cell-native path (attachToCell)", () => {
    let container: HTMLElement
    let td: Teardown | null = null
    afterEach(() => {
      td?.teardown()
      td = null
      container?.remove()
    })

    it("invokes update with each new model and tears down cleanly", () => {
      const updates: string[] = []
      let tornDown = false
      const sdom = component<string, never>((el, model, _dispatch) => {
        el.textContent = model
        return {
          update: (next: string) => {
            updates.push(next)
            el.textContent = next
          },
          teardown: () => { tornDown = true },
        }
      })
      container = document.createElement("div")
      document.body.appendChild(container)
      const v = makeVar("first")
      td = attachToCell(container, sdom, v, () => {})
      expect(container.querySelector("div")!.textContent).toBe("first")

      v.set("second")
      v.set("third")
      expect(updates).toEqual(["second", "third"])
      expect(container.querySelector("div")!.textContent).toBe("third")

      td.teardown()
      td = null
      expect(tornDown).toBe(true)
      expect(container.querySelector("div")).toBeNull()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// compiled
// ─────────────────────────────────────────────────────────────────────────────

describe("compiled", () => {
  it("calls setup with parent and initial model, appending nodes", () => {
    const sdom = compiled<string, never>((parent, model, _dispatch) => {
      const span = document.createElement("span")
      span.textContent = model
      parent.appendChild(span)
      return { update: () => {}, teardown: () => {} }
    })
    h = mount(sdom, "hello")
    expect(h.container.querySelector("span")!.textContent).toBe("hello")
  })

  it("provides prev and next to update callback", () => {
    const received: Array<{ prev: string; next: string }> = []
    const sdom = compiled<string, never>((parent, model, _dispatch) => {
      const span = document.createElement("span")
      span.textContent = model
      parent.appendChild(span)
      return {
        update: (prev, next) => {
          received.push({ prev, next })
          span.textContent = next
        },
        teardown: () => {},
      }
    })
    h = mount(sdom, "a")
    h.set("b")
    h.set("c")
    expect(received).toEqual([
      { prev: "a", next: "b" },
      { prev: "b", next: "c" },
    ])
    expect(h.container.querySelector("span")!.textContent).toBe("c")
  })

  it("registers exactly one subscription on the update stream", () => {
    let subscriptionCount = 0
    const sdom = compiled<string, never>((parent, model, _dispatch) => {
      const node = document.createTextNode(model)
      parent.appendChild(node)
      return {
        update: (_prev, next) => { node.textContent = next },
        teardown: () => { node.remove() },
      }
    })

    // Wrap the SDOM to count subscriptions
    const wrappedSdom = makeSDOM<string, never>((parent, initialModel, updates, dispatch) => {
      const countingUpdates: UpdateStream<string> = {
        subscribe(observer) {
          subscriptionCount++
          return updates.subscribe(observer)
        },
      }
      return sdom.attach(parent, initialModel, countingUpdates, dispatch)
    })

    h = mount(wrappedSdom, "test")
    expect(subscriptionCount).toBe(1)
  })

  it("cleans up on teardown", () => {
    let tornDown = false
    const sdom = compiled<string, never>((parent, model, _dispatch) => {
      const span = document.createElement("span")
      span.textContent = model
      parent.appendChild(span)
      return {
        update: () => {},
        teardown: () => {
          tornDown = true
          span.remove()
        },
      }
    })
    h = mount(sdom, "init")
    expect(h.container.querySelector("span")).not.toBeNull()

    h.teardown.teardown()
    expect(tornDown).toBe(true)
    expect(h.container.querySelector("span")).toBeNull()

    h.container.remove()
    h = undefined as any
  })

  describe("Cell-native path (attachToCell)", () => {
    let container: HTMLElement
    let td: Teardown | null = null
    afterEach(() => {
      td?.teardown()
      td = null
      container?.remove()
    })

    it("invokes update with (prev, next) across cell sets and tears down cleanly", () => {
      const received: Array<{ prev: string; next: string }> = []
      let tornDown = false
      const sdom = compiled<string, never>((parent, model, _dispatch) => {
        const span = document.createElement("span")
        span.textContent = model
        parent.appendChild(span)
        return {
          update: (prev, next) => {
            received.push({ prev, next })
            span.textContent = next
          },
          teardown: () => {
            tornDown = true
            span.remove()
          },
        }
      })

      container = document.createElement("div")
      document.body.appendChild(container)
      const v = makeVar("a")
      td = attachToCell(container, sdom, v, () => {})
      expect(container.querySelector("span")!.textContent).toBe("a")

      v.set("b")
      v.set("c")
      expect(received).toEqual([
        { prev: "a", next: "b" },
        { prev: "b", next: "c" },
      ])
      expect(container.querySelector("span")!.textContent).toBe("c")

      td.teardown()
      td = null
      expect(tornDown).toBe(true)
      expect(container.querySelector("span")).toBeNull()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// compiledState
// ─────────────────────────────────────────────────────────────────────────────

describe("compiledState", () => {
  it("calls setup with parent and initial model, calls update with (prev, next)", () => {
    interface State { node: Text }
    const received: Array<{ prev: string; next: string }> = []
    const sdom = compiledState<string, never, State>({
      setup: (parent, model, _dispatch) => {
        const node = document.createTextNode(model)
        parent.appendChild(node)
        return { node }
      },
      update: (state, prev, next) => {
        received.push({ prev, next })
        state.node.textContent = next
      },
      teardown: (state) => {
        state.node.remove()
      },
    })

    h = mount(sdom, "a")
    expect(h.container.textContent).toBe("a")

    h.set("b")
    h.set("c")
    expect(received).toEqual([
      { prev: "a", next: "b" },
      { prev: "b", next: "c" },
    ])
    expect(h.container.textContent).toBe("c")
  })

  it("cleans up on teardown", () => {
    interface State { node: Text; tornDown: boolean }
    let tornDownState: State | null = null
    const sdom = compiledState<string, never, State>({
      setup: (parent, model, _dispatch) => {
        const node = document.createTextNode(model)
        parent.appendChild(node)
        const s: State = { node, tornDown: false }
        return s
      },
      update: (state, _prev, next) => {
        state.node.textContent = next
      },
      teardown: (state) => {
        state.tornDown = true
        state.node.remove()
        tornDownState = state
      },
    })

    h = mount(sdom, "init")
    expect(h.container.textContent).toBe("init")

    h.teardown.teardown()
    expect(tornDownState).not.toBeNull()
    expect(tornDownState!.tornDown).toBe(true)
    expect(h.container.textContent).toBe("")

    h.container.remove()
    h = undefined as any
  })

  describe("Cell-native path (attachToCell)", () => {
    let container: HTMLElement
    let td: Teardown | null = null
    afterEach(() => {
      td?.teardown()
      td = null
      container?.remove()
    })

    it("threads prev/next through update under a cell mount", () => {
      interface State { node: Text }
      const received: Array<{ prev: string; next: string }> = []
      let tornDown = false
      const sdom = compiledState<string, never, State>({
        setup: (parent, model, _dispatch) => {
          const node = document.createTextNode(model)
          parent.appendChild(node)
          return { node }
        },
        update: (state, prev, next) => {
          received.push({ prev, next })
          state.node.textContent = next
        },
        teardown: (state) => {
          tornDown = true
          state.node.remove()
        },
      })

      container = document.createElement("div")
      document.body.appendChild(container)
      const v = makeVar("a")
      td = attachToCell(container, sdom, v, () => {})
      expect(container.textContent).toBe("a")

      v.set("b")
      v.set("c")
      expect(received).toEqual([
        { prev: "a", next: "b" },
        { prev: "b", next: "c" },
      ])
      expect(container.textContent).toBe("c")

      td.teardown()
      td = null
      expect(tornDown).toBe(true)
      expect(container.textContent).toBe("")
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fragment
// ─────────────────────────────────────────────────────────────────────────────

describe("fragment", () => {
  it("handles empty children array", () => {
    const sdom = fragment<string, never>([])
    h = mount(sdom, "model")
    expect(h.container.childNodes.length).toBe(0)
  })

  it("mounts a single child", () => {
    const sdom = fragment<string, never>([
      text(m => m),
    ])
    h = mount(sdom, "only-child")
    expect(h.container.textContent).toBe("only-child")
  })

  it("mounts multiple children in order", () => {
    const sdom = fragment<string, never>([
      text(m => `first:${m}`),
      text(m => `second:${m}`),
      text(m => `third:${m}`),
    ])
    h = mount(sdom, "x")
    const nodes = h.container.childNodes
    expect(nodes.length).toBe(3)
    expect(nodes[0]!.textContent).toBe("first:x")
    expect(nodes[1]!.textContent).toBe("second:x")
    expect(nodes[2]!.textContent).toBe("third:x")
  })

  it("propagates model updates to all children", () => {
    const sdom = fragment<string, never>([
      text(m => `a:${m}`),
      text(m => `b:${m}`),
    ])
    h = mount(sdom, "v1")
    expect(h.container.childNodes[0]!.textContent).toBe("a:v1")
    expect(h.container.childNodes[1]!.textContent).toBe("b:v1")

    h.set("v2")
    expect(h.container.childNodes[0]!.textContent).toBe("a:v2")
    expect(h.container.childNodes[1]!.textContent).toBe("b:v2")
  })

  it("calls teardown on all children", () => {
    const tornDown: string[] = []

    const child = (label: string): SDOM<string, never> =>
      makeSDOM((parent, model, updates, _dispatch) => {
        const node = document.createTextNode(model)
        parent.appendChild(node)
        return {
          teardown: () => {
            tornDown.push(label)
            node.remove()
          },
        }
      })

    const sdom = fragment<string, never>([child("a"), child("b"), child("c")])
    h = mount(sdom, "x")
    expect(h.container.childNodes.length).toBe(3)

    h.teardown.teardown()
    expect(tornDown).toEqual(["a", "b", "c"])

    h.container.remove()
    h = undefined as any
  })
})

