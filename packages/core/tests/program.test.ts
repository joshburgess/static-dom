import { describe, it, expect, afterEach } from "vitest"
import { element, text } from "../src/constructors"
import { program, programWithEffects, noCmd, type Cmd } from "../src/program"
import type { ProgramHandle } from "../src/program"

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
