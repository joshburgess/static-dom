import { describe, it, expect, afterEach } from "vitest"
import { optional, element, text } from "../src/constructors"
import { prism } from "../src/optics"
import { attachToCell } from "../src/program"
import { makeVar } from "../src/incremental-graph"
import { mount, cleanup, type TestHarness } from "./helpers"
import type { Teardown } from "../src/types"

interface M { detail: { info: string } | null }

const detailPrism = prism<M, { info: string }>(
  m => m.detail,
  detail => ({ detail })
)

const innerSdom = element<"span", { info: string }, never>("span", {}, [
  text(m => m.info),
])

let h: TestHarness<M, never>
afterEach(() => { if (h) cleanup(h) })

describe("optional", () => {
  it("renders inner when model matches prism", () => {
    h = mount(optional(detailPrism, innerSdom), { detail: { info: "hello" } })
    expect(h.container.querySelector("span")!.textContent).toBe("hello")
  })

  it("renders nothing when model does not match prism", () => {
    h = mount(optional(detailPrism, innerSdom), { detail: null })
    expect(h.container.querySelector("span")).toBeNull()
  })

  it("mounts inner when prism becomes active", () => {
    h = mount(optional(detailPrism, innerSdom), { detail: null })
    h.set({ detail: { info: "appeared" } })
    expect(h.container.querySelector("span")!.textContent).toBe("appeared")
  })

  it("unmounts inner when prism becomes inactive", () => {
    h = mount(optional(detailPrism, innerSdom), { detail: { info: "bye" } })
    h.set({ detail: null })
    expect(h.container.querySelector("span")).toBeNull()
  })

  it("updates inner when sub-model changes", () => {
    h = mount(optional(detailPrism, innerSdom), { detail: { info: "v1" } })
    h.set({ detail: { info: "v2" } })
    expect(h.container.querySelector("span")!.textContent).toBe("v2")
  })

  it("remounts after unmount then mount", () => {
    h = mount(optional(detailPrism, innerSdom), { detail: { info: "first" } })
    h.set({ detail: null })
    h.set({ detail: { info: "second" } })
    expect(h.container.querySelector("span")!.textContent).toBe("second")
  })

  describe("Cell-native path (attachToCell)", () => {
    let container: HTMLElement
    let td: Teardown | null = null
    afterEach(() => {
      td?.teardown()
      td = null
      container?.remove()
    })

    it("mounts/unmounts inner across null transitions and updates while present", () => {
      container = document.createElement("div")
      document.body.appendChild(container)
      const v = makeVar<M>({ detail: null })
      td = attachToCell(container, optional(detailPrism, innerSdom), v, () => {})
      expect(container.querySelector("span")).toBeNull()

      v.set({ detail: { info: "hello" } })
      expect(container.querySelector("span")!.textContent).toBe("hello")

      v.set({ detail: { info: "world" } })
      expect(container.querySelector("span")!.textContent).toBe("world")

      v.set({ detail: null })
      expect(container.querySelector("span")).toBeNull()

      v.set({ detail: { info: "again" } })
      expect(container.querySelector("span")!.textContent).toBe("again")
    })
  })
})
