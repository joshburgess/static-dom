import { describe, it, expect, afterEach } from "vitest"
import { element, text } from "../src/constructors"
import {
  attachToCell,
  noCmd,
  program,
  programFromVar,
  programWithEffects,
  type Cmd,
} from "../src/program"
import type { ProgramHandle } from "../src/program"
import { makeVar, mapCell } from "../src/incremental-graph"
import { focusVar } from "../src/incremental-optics"
import { prop } from "../src/optics"
import type { Teardown } from "../src/types"

let handle: ProgramHandle<any, any> | null = null
let container: HTMLElement

function freshContainer(): HTMLElement {
  container = document.createElement("div")
  document.body.appendChild(container)
  return container
}

afterEach(() => {
  handle?.teardown()
  handle = null
  container?.remove()
})

describe("program", () => {
  it("mounts the view with initial model", () => {
    handle = program({
      container: freshContainer(),
      init: { text: "hello" },
      update: (_msg: never, model) => model,
      view: element<"div", { text: string }, never>("div", {}, [
        text(m => m.text),
      ]),
    })
    expect(container.querySelector("div")!.textContent).toBe("hello")
  })

  it("updates DOM when message is dispatched", () => {
    type M = { count: number }
    type Msg = "inc" | "dec"
    handle = program({
      container: freshContainer(),
      init: { count: 0 },
      update: (msg: Msg, model: M) => ({
        count: msg === "inc" ? model.count + 1 : model.count - 1,
      }),
      view: element<"div", M, Msg>("div", {}, [
        text(m => String(m.count)),
        element("button", {
          on: { click: () => "inc" as const },
        }, []),
      ]),
    })
    expect(container.querySelector("div")!.childNodes[0]!.textContent).toBe("0")

    handle.dispatch("inc")
    expect(container.querySelector("div")!.childNodes[0]!.textContent).toBe("1")

    handle.dispatch("dec")
    expect(container.querySelector("div")!.childNodes[0]!.textContent).toBe("0")
  })

  it("calls onUpdate middleware", () => {
    const log: Array<{ msg: string; prev: number; next: number }> = []
    type M = { n: number }
    handle = program({
      container: freshContainer(),
      init: { n: 0 },
      update: (_msg: string, model: M) => ({ n: model.n + 1 }),
      view: element<"div", M, string>("div", {}, [text(m => String(m.n))]),
      onUpdate: (msg, prev, next) => log.push({ msg, prev: prev.n, next: next.n }),
    })
    handle.dispatch("go")
    handle.dispatch("go")
    expect(log).toEqual([
      { msg: "go", prev: 0, next: 1 },
      { msg: "go", prev: 1, next: 2 },
    ])
  })

  it("getModel returns current model", () => {
    handle = program({
      container: freshContainer(),
      init: { n: 0 },
      update: (_msg: string, model: { n: number }) => ({ n: model.n + 1 }),
      view: element<"div", { n: number }, string>("div", {}, []),
    })
    expect(handle.getModel()).toEqual({ n: 0 })
    handle.dispatch("x")
    expect(handle.getModel()).toEqual({ n: 1 })
  })
})

describe("programWithEffects", () => {
  it("runs init command", () => {
    const dispatched: string[] = []
    handle = programWithEffects({
      container: freshContainer(),
      init: [{ n: 0 }, (dispatch) => dispatch("from-init")],
      update: (msg: string, model: { n: number }) => [
        { n: model.n + 1 },
        noCmd(),
      ],
      view: element<"div", { n: number }, string>("div", {}, [
        text(m => String(m.n)),
      ]),
      onUpdate: (msg) => dispatched.push(msg),
    })
    // Init command dispatched "from-init", which triggered update
    expect(dispatched).toContain("from-init")
    expect(handle.getModel().n).toBe(1)
  })

  it("runs commands returned from update", () => {
    const effects: string[] = []
    handle = programWithEffects({
      container: freshContainer(),
      init: [{ n: 0 }, noCmd()],
      update: (msg: string, model: { n: number }): [{ n: number }, Cmd<string>] => {
        if (msg === "trigger") {
          return [{ n: model.n + 1 }, (dispatch) => {
            effects.push("effect-ran")
            dispatch("from-effect")
          }]
        }
        return [{ n: model.n + 10 }, noCmd()]
      },
      view: element<"div", { n: number }, string>("div", {}, []),
    })
    handle.dispatch("trigger")
    expect(effects).toEqual(["effect-ran"])
    // update ran twice: "trigger" → n=1, "from-effect" → n=11
    expect(handle.getModel().n).toBe(11)
  })
})

describe("attachToCell", () => {
  let teardown: Teardown | null = null
  afterEach(() => {
    teardown?.teardown()
    teardown = null
    container?.remove()
  })

  it("renders a view driven directly by a Var", () => {
    const c = freshContainer()
    const v = makeVar({ count: 0 })
    teardown = attachToCell(
      c,
      element<"div", { count: number }, never>("div", {}, [
        text(m => String(m.count)),
      ]),
      v,
      () => {},
    )
    expect(c.querySelector("div")!.textContent).toBe("0")
    v.set({ count: 7 })
    expect(c.querySelector("div")!.textContent).toBe("7")
  })

  it("re-renders when a derived Cell upstream changes", () => {
    const c = freshContainer()
    const v = makeVar(3)
    const doubled = mapCell(v, (x) => ({ value: x * 2 }))
    teardown = attachToCell(
      c,
      element<"div", { value: number }, never>("div", {}, [
        text(m => String(m.value)),
      ]),
      doubled,
      () => {},
    )
    expect(c.querySelector("div")!.textContent).toBe("6")
    v.set(10)
    expect(c.querySelector("div")!.textContent).toBe("20")
  })

  it("dispatch is wired to the caller-provided handler", () => {
    const c = freshContainer()
    const v = makeVar({ count: 0 })
    const seen: string[] = []
    teardown = attachToCell(
      c,
      element<"div", { count: number }, string>("div", {}, [
        element("button", {
          on: { click: () => "ping" as const },
        }, []),
      ]),
      v,
      (msg: string) => seen.push(msg),
    )
    c.querySelector("button")!.dispatchEvent(new Event("click", { bubbles: true }))
    expect(seen).toEqual(["ping"])
  })
})

describe("programFromVar", () => {
  it("uses a caller-supplied Var as the model source", () => {
    const v = makeVar({ count: 0 })
    handle = programFromVar({
      container: freshContainer(),
      modelVar: v,
      update: (_msg: "inc", m) => ({ count: m.count + 1 }),
      view: element<"div", { count: number }, "inc">("div", {}, [
        text(m => String(m.count)),
      ]),
    })
    expect(container.querySelector("div")!.textContent).toBe("0")
    handle.dispatch("inc")
    expect(container.querySelector("div")!.textContent).toBe("1")
    expect(v.value).toEqual({ count: 1 })
    // External writes to the Var also flow through.
    v.set({ count: 99 })
    expect(container.querySelector("div")!.textContent).toBe("99")
  })

  it("supports mounting two views against focused slices of one Var", () => {
    interface Form { name: string; email: string }
    const formVar = makeVar<Form>({ name: "alice", email: "a@x" })
    const nameVar = focusVar(prop<Form>()("name"), formVar)
    const emailVar = focusVar(prop<Form>()("email"), formVar)

    const c1 = document.createElement("div")
    const c2 = document.createElement("div")
    document.body.appendChild(c1)
    document.body.appendChild(c2)

    const t1 = attachToCell(
      c1,
      element<"div", string, string>("div", {}, [text(m => m)]),
      nameVar,
      () => {},
    )
    const t2 = attachToCell(
      c2,
      element<"div", string, string>("div", {}, [text(m => m)]),
      emailVar,
      () => {},
    )

    expect(c1.textContent).toBe("alice")
    expect(c2.textContent).toBe("a@x")

    nameVar.set("bob")
    expect(c1.textContent).toBe("bob")
    expect(c2.textContent).toBe("a@x") // untouched
    expect(formVar.value).toEqual({ name: "bob", email: "a@x" })

    t1.teardown()
    t2.teardown()
    c1.remove()
    c2.remove()
  })
})

