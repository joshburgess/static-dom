import { describe, expect, it, vi } from "vitest"
import { makeVar, mapCell } from "../src/incremental-graph"
import {
  bindPrism,
  focusVar,
  liftAffine,
  liftFold,
  liftGetter,
  liftLens,
  liftPrism,
} from "../src/incremental-optics"
import { foldOf, getterOf, nullablePrism, prop, unionMember } from "../src/optics"

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

  it("liftPrism reads through preview and yields null when unmatched", () => {
    type State =
      | { tag: "loaded"; data: number }
      | { tag: "loading" }
    const loadedPrism = unionMember<State, { tag: "loaded"; data: number }>(
      (s): s is { tag: "loaded"; data: number } => s.tag === "loaded",
    )
    const v = makeVar<State>({ tag: "loading" })
    const loaded = liftPrism(loadedPrism, v)
    expect(loaded.value).toBeNull()
    v.set({ tag: "loaded", data: 42 })
    expect(loaded.value).toEqual({ tag: "loaded", data: 42 })
  })

  it("liftPrism cutoff suppresses propagation across same-state transitions", () => {
    type State =
      | { tag: "loaded"; data: number }
      | { tag: "loading" }
    const loadedPrism = unionMember<State, { tag: "loaded"; data: number }>(
      (s): s is { tag: "loaded"; data: number } => s.tag === "loaded",
    )
    const v = makeVar<State>({ tag: "loading" })
    const loaded = liftPrism(loadedPrism, v)
    const obs = vi.fn()
    loaded.observe(obs)
    v.set({ tag: "loading" })
    expect(obs).not.toHaveBeenCalled()
    v.set({ tag: "loaded", data: 1 })
    expect(obs).toHaveBeenCalledTimes(1)
    expect(obs).toHaveBeenCalledWith({ tag: "loaded", data: 1 })
  })

  it("liftAffine reads a nullable field as Cell<A | null>", () => {
    interface Profile { nickname: string | null }
    const nicknameAff = nullablePrism<Profile>()("nickname")
    const v = makeVar<Profile>({ nickname: null })
    const nickname = liftAffine(nicknameAff, v)
    expect(nickname.value).toBeNull()
    v.set({ nickname: "ada" })
    expect(nickname.value).toBe("ada")
    v.set({ nickname: null })
    expect(nickname.value).toBeNull()
  })

  it("bindPrism swaps the inner cell when the prism's match status flips", () => {
    type State =
      | { tag: "loaded"; data: number }
      | { tag: "loading" }
    const loadedPrism = unionMember<State, { tag: "loaded"; data: number }>(
      (s): s is { tag: "loaded"; data: number } => s.tag === "loaded",
    )
    const loadingLabel = makeVar("loading...")
    const loadedPrefix = makeVar("data: ")
    const v = makeVar<State>({ tag: "loading" })
    const view = bindPrism(loadedPrism, v, (matched) =>
      matched === null
        ? loadingLabel
        : mapCell(loadedPrefix, (p) => p + String(matched.data)),
    )
    expect(view.value).toBe("loading...")
    loadingLabel.set("still loading")
    expect(view.value).toBe("still loading")
    v.set({ tag: "loaded", data: 7 })
    expect(view.value).toBe("data: 7")
    loadedPrefix.set("value: ")
    expect(view.value).toBe("value: 7")
    // Updates to the previous branch do not leak in.
    loadingLabel.set("nope")
    expect(view.value).toBe("value: 7")
    v.set({ tag: "loading" })
    expect(view.value).toBe("nope")
  })

  it("bindPrism cutoff suppresses observers across no-op state changes", () => {
    type State =
      | { tag: "loaded"; data: number }
      | { tag: "loading" }
    const loadedPrism = unionMember<State, { tag: "loaded"; data: number }>(
      (s): s is { tag: "loaded"; data: number } => s.tag === "loaded",
    )
    const loading = makeVar("L")
    const loaded = makeVar("X")
    const v = makeVar<State>({ tag: "loading" })
    const view = bindPrism(loadedPrism, v, (matched) =>
      matched === null ? loading : loaded,
    )
    const obs = vi.fn()
    view.observe(obs)
    // Switch to loaded; loaded.value === "X" but loading.value === "L", so this fires.
    v.set({ tag: "loaded", data: 1 })
    expect(obs).toHaveBeenCalledTimes(1)
    expect(obs).toHaveBeenLastCalledWith("X")
    // Same constructor, different payload — prism's reference-equality cutoff
    // would let the new "loaded" object through, but the inner cell's value
    // hasn't changed, so the bind result's cutoff suppresses.
    v.set({ tag: "loaded", data: 2 })
    expect(obs).toHaveBeenCalledTimes(1)
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
