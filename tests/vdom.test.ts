import { describe, it, expect, afterEach } from "vitest"
import { h } from "tachys/sync"
import { vdom, vdomWith } from "../src/vdom"
import { mount, cleanup, type TestHarness } from "./helpers"

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

interface Model {
  items: Array<{ id: string; label: string }>
  title: string
}

type Msg = { type: "clicked"; id: string }

// ---------------------------------------------------------------------------
// vdom tests
// ---------------------------------------------------------------------------

describe("vdom", () => {
  let harn: TestHarness<Model, Msg>
  afterEach(() => { if (harn) cleanup(harn) })

  const view = vdom<Model, Msg>((model, dispatch) =>
    h("div", null,
      h("h1", null, model.title),
      h("ul", null,
        model.items.map(item =>
          h("li", {
            key: item.id,
            onClick: () => dispatch({ type: "clicked", id: item.id }),
          }, item.label)
        )
      )
    )
  )

  it("renders the initial Tachys VNode tree", () => {
    harn = mount(view, {
      title: "Hello",
      items: [{ id: "1", label: "first" }, { id: "2", label: "second" }],
    })

    expect(harn.container.querySelector("h1")!.textContent).toBe("Hello")
    const lis = harn.container.querySelectorAll("li")
    expect(lis.length).toBe(2)
    expect(lis[0]!.textContent).toBe("first")
    expect(lis[1]!.textContent).toBe("second")
  })

  it("updates when model changes", () => {
    harn = mount(view, {
      title: "v1",
      items: [{ id: "1", label: "a" }],
    })

    harn.set({
      title: "v2",
      items: [{ id: "1", label: "a" }, { id: "2", label: "b" }],
    })

    expect(harn.container.querySelector("h1")!.textContent).toBe("v2")
    expect(harn.container.querySelectorAll("li").length).toBe(2)
  })

  it("dispatches messages from Tachys event handlers", () => {
    harn = mount(view, {
      title: "test",
      items: [{ id: "42", label: "click me" }],
    })

    harn.container.querySelector("li")!.click()
    expect(harn.dispatched).toEqual([{ type: "clicked", id: "42" }])
  })

  it("cleans up on teardown", () => {
    harn = mount(view, {
      title: "bye",
      items: [],
    })

    expect(harn.container.querySelector("h1")).not.toBeNull()
    harn.teardown.teardown()
    expect(harn.container.querySelector("h1")).toBeNull()
    harn.container.remove()
    harn = null!
  })

  it("handles structural changes (items added/removed)", () => {
    harn = mount(view, {
      title: "list",
      items: [{ id: "1", label: "one" }, { id: "2", label: "two" }, { id: "3", label: "three" }],
    })

    expect(harn.container.querySelectorAll("li").length).toBe(3)

    // Remove middle item
    harn.set({
      title: "list",
      items: [{ id: "1", label: "one" }, { id: "3", label: "three" }],
    })

    expect(harn.container.querySelectorAll("li").length).toBe(2)
    const lis = harn.container.querySelectorAll("li")
    expect(lis[0]!.textContent).toBe("one")
    expect(lis[1]!.textContent).toBe("three")
  })
})

// ---------------------------------------------------------------------------
// vdomWith tests
// ---------------------------------------------------------------------------

describe("vdomWith", () => {
  let harn: TestHarness<{ value: string }, never>
  afterEach(() => { if (harn) cleanup(harn) })

  let teardownCalled = false

  const view = vdomWith<{ value: string }, never>({
    render(container, model) {
      container.innerHTML = `<p>${model.value}</p>`
    },
    teardown() {
      teardownCalled = true
    },
  })

  it("renders initial content via the custom render function", () => {
    harn = mount(view, { value: "hello" })
    expect(harn.container.querySelector("p")!.textContent).toBe("hello")
  })

  it("updates when model changes", () => {
    harn = mount(view, { value: "v1" })
    harn.set({ value: "v2" })
    expect(harn.container.querySelector("p")!.textContent).toBe("v2")
  })

  it("calls custom teardown on cleanup", () => {
    teardownCalled = false
    harn = mount(view, { value: "bye" })
    harn.teardown.teardown()
    expect(teardownCalled).toBe(true)
    harn.container.remove()
    harn = null!
  })
})
