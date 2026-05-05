import { describe, expect, it, vi } from "vitest"
import { makeVar } from "../src/incremental-graph"
import {
  focusVar,
  liftFold,
  liftGetter,
  liftLens,
} from "../src/incremental-optics"
import { foldOf, getterOf, prop } from "../src/optics"

interface User {
  id: number
  name: string
  email: string
}

describe("incremental-optics", () => {
  it("liftLens projects a Cell through a Lens", () => {
    const v = makeVar<User>({ id: 1, name: "alice", email: "a@x" })
    const nameCell = liftLens(prop<User>()("name"), v)
    expect(nameCell.value).toBe("alice")
    v.set({ id: 1, name: "bob", email: "a@x" })
    expect(nameCell.value).toBe("bob")
  })

  it("liftLens cutoff suppresses observers when the focused field is unchanged", () => {
    const v = makeVar<User>({ id: 1, name: "alice", email: "a@x" })
    const nameCell = liftLens(prop<User>()("name"), v)
    const obs = vi.fn()
    nameCell.observe(obs)
    v.set({ id: 1, name: "alice", email: "a@y" })
    expect(obs).not.toHaveBeenCalled()
    v.set({ id: 1, name: "bob", email: "a@y" })
    expect(obs).toHaveBeenCalledTimes(1)
    expect(obs).toHaveBeenCalledWith("bob")
  })

  it("liftGetter projects through a Getter", () => {
    const v = makeVar<User>({ id: 1, name: "alice", email: "a@x" })
    const upperName = liftGetter(getterOf<User, string>((u) => u.name.toUpperCase()), v)
    expect(upperName.value).toBe("ALICE")
    v.set({ id: 1, name: "bob", email: "a@x" })
    expect(upperName.value).toBe("BOB")
  })

  it("focusVar reads via the lens and writes back through it", () => {
    const v = makeVar<User>({ id: 1, name: "alice", email: "a@x" })
    const nameVar = focusVar(prop<User>()("name"), v)
    expect(nameVar.value).toBe("alice")
    nameVar.set("bob")
    expect(v.value).toEqual({ id: 1, name: "bob", email: "a@x" })
    expect(nameVar.value).toBe("bob")
  })

  it("focusVar observers fire only when the focused field changes", () => {
    const v = makeVar<User>({ id: 1, name: "alice", email: "a@x" })
    const nameVar = focusVar(prop<User>()("name"), v)
    const obs = vi.fn()
    nameVar.observe(obs)
    v.set({ id: 2, name: "alice", email: "a@x" })
    expect(obs).not.toHaveBeenCalled()
    nameVar.set("bob")
    expect(obs).toHaveBeenCalledTimes(1)
    expect(obs).toHaveBeenCalledWith("bob")
  })

  it("focusVar.set with the same focused value is a no-op for observers", () => {
    const v = makeVar<User>({ id: 1, name: "alice", email: "a@x" })
    const nameVar = focusVar(prop<User>()("name"), v)
    const obs = vi.fn()
    nameVar.observe(obs)
    nameVar.set("alice")
    expect(obs).not.toHaveBeenCalled()
  })

  it("liftFold uses structural cutoff so same elements do not propagate", () => {
    const a = { id: 1 }
    const b = { id: 2 }
    const v = makeVar<{ items: ReadonlyArray<{ id: number }> }>({ items: [a, b] })
    const items = liftFold(
      foldOf<{ items: ReadonlyArray<{ id: number }> }, { id: number }>((s) => s.items),
      v,
    )
    const obs = vi.fn()
    items.observe(obs)
    v.set({ items: [a, b] }) // same elements, new wrapper — structural cutoff suppresses
    expect(obs).not.toHaveBeenCalled()
    v.set({ items: [a] })
    expect(obs).toHaveBeenCalledTimes(1)
  })
})
