import { describe, it, expect } from "vitest"
import {
  getterOf, foldOf, setterOf, reviewOf,
  toGetter, toFold, toSetter, toReview,
  lensOf, prismOf, isoOf, affineOf,
  prop, each, traversal,
  type Getter, type Fold, type Setter, type Review,
} from "../src/index"

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

interface User {
  name: string
  age: number
  bio: string | null
}

const alice: User = { name: "Alice", age: 30, bio: "Engineer" }
const bob: User = { name: "Bob", age: 25, bio: null }

const nameLens = prop<User>()("name")
const ageLens = prop<User>()("age")

const uppercaseIso = isoOf<string, string>(
  s => s.toUpperCase(),
  s => s.toLowerCase(),
)

const positivePrism = prismOf<number, number>(
  n => n > 0 ? n : null,
  n => n,
)

const bioAffine = affineOf<User, string>(
  u => u.bio,
  (bio, u) => ({ ...u, bio }),
)

// ---------------------------------------------------------------------------
// Getter
// ---------------------------------------------------------------------------

describe("Getter", () => {
  it("getterOf creates a Getter with get", () => {
    const g = getterOf<User, string>(u => u.name)
    expect(g.get(alice)).toBe("Alice")
    expect(g.get(bob)).toBe("Bob")
  })

  it("Getter.compose(Getter) = Getter", () => {
    const nameGetter = getterOf<User, string>(u => u.name)
    const lengthGetter = getterOf<string, number>(s => s.length)
    const composed = nameGetter.compose(lengthGetter)
    expect(composed.get(alice)).toBe(5) // "Alice".length
    expect(composed.get(bob)).toBe(3) // "Bob".length
  })

  it("Getter.compose(Lens) = Getter", () => {
    interface Wrapper { user: User }
    const wrapperGetter = getterOf<Wrapper, User>(w => w.user)
    const composed = wrapperGetter.compose(nameLens)
    expect(composed.get({ user: alice })).toBe("Alice")
  })

  it("Getter.compose(Prism) = Fold", () => {
    const ageGetter = getterOf<User, number>(u => u.age)
    const composed = ageGetter.compose(positivePrism)
    // Result is a Fold
    expect(composed.getAll(alice)).toEqual([30])
    expect(composed.getAll({ ...alice, age: -1 })).toEqual([])
  })

  it("Getter.compose(Traversal) = Fold", () => {
    interface Team { members: readonly User[] }
    const membersGetter = getterOf<Team, readonly User[]>(t => t.members)
    const eachUser = each<User>()
    const composed = membersGetter.compose(eachUser)
    const team = { members: [alice, bob] }
    expect(composed.getAll(team)).toEqual([alice, bob])
  })

  it("Getter.compose(Iso) = Getter", () => {
    const nameGetter = getterOf<User, string>(u => u.name)
    const composed = nameGetter.compose(uppercaseIso)
    expect(composed.get(alice)).toBe("ALICE")
  })
})

// ---------------------------------------------------------------------------
// Fold
// ---------------------------------------------------------------------------

describe("Fold", () => {
  it("foldOf creates a Fold with getAll", () => {
    const f = foldOf<number[], number>(arr => arr.filter(n => n > 2))
    expect(f.getAll([1, 2, 3, 4])).toEqual([3, 4])
  })

  it("Fold.fold accumulates", () => {
    const f = foldOf<number[], number>(arr => arr)
    const sum = f.fold((acc, n) => acc + n, 0)
    expect(sum([1, 2, 3])).toBe(6)
  })

  it("Fold.compose(Getter) = Fold", () => {
    const usersFold = foldOf<User[], User>(users => users)
    const nameGetter = getterOf<User, string>(u => u.name)
    const composed = usersFold.compose(nameGetter)
    expect(composed.getAll([alice, bob])).toEqual(["Alice", "Bob"])
  })

  it("Fold.compose(Fold) = Fold", () => {
    const outerFold = foldOf<number[][], number[]>(arrs => arrs)
    const innerFold = foldOf<number[], number>(arr => arr.filter(n => n > 0))
    const composed = outerFold.compose(innerFold)
    expect(composed.getAll([[-1, 2], [3, -4]])).toEqual([2, 3])
  })

  it("Fold.compose(Lens) = Fold", () => {
    const usersFold = foldOf<User[], User>(users => users)
    const composed = usersFold.compose(nameLens)
    expect(composed.getAll([alice, bob])).toEqual(["Alice", "Bob"])
  })

  it("Fold.compose(Prism) = Fold", () => {
    const numbersFold = foldOf<number[], number>(arr => arr)
    const composed = numbersFold.compose(positivePrism)
    expect(composed.getAll([-1, 2, -3, 4])).toEqual([2, 4])
  })

  it("Fold.compose(Traversal) = Fold", () => {
    interface Group { items: readonly number[] }
    const groupsFold = foldOf<Group[], Group>(gs => gs)
    const itemsTrav = traversal<Group, number>(
      g => g.items,
      f => g => ({ items: g.items.map(f) }),
    )
    const composed = groupsFold.compose(itemsTrav)
    expect(composed.getAll([
      { items: [1, 2] },
      { items: [3, 4] },
    ])).toEqual([1, 2, 3, 4])
  })
})

// ---------------------------------------------------------------------------
// Setter
// ---------------------------------------------------------------------------

describe("Setter", () => {
  it("setterOf creates a Setter with modify", () => {
    const s = setterOf<number[], number>(f => arr => arr.map(f))
    expect(s.modify(n => n * 2)([1, 2, 3])).toEqual([2, 4, 6])
  })

  it("Setter.set replaces", () => {
    const s = setterOf<number[], number>(f => arr => arr.map(f))
    expect(s.set(0)([1, 2, 3])).toEqual([0, 0, 0])
  })

  it("Setter.compose(Setter) = Setter", () => {
    const outerSetter = setterOf<number[][], number[]>(f => arrs => arrs.map(f))
    const innerSetter = setterOf<number[], number>(f => arr => arr.map(f))
    const composed = outerSetter.compose(innerSetter)
    expect(composed.modify(n => n + 1)([[1, 2], [3, 4]])).toEqual([[2, 3], [4, 5]])
  })

  it("Setter.compose(Lens) = Setter", () => {
    const usersSetter = setterOf<User[], User>(f => users => users.map(f))
    const composed = usersSetter.compose(nameLens)
    const result = composed.modify(s => s.toUpperCase())([alice, bob])
    expect(result[0]!.name).toBe("ALICE")
    expect(result[1]!.name).toBe("BOB")
  })

  it("Setter.compose(Prism) = Setter", () => {
    const numbersSetter = setterOf<number[], number>(f => arr => arr.map(f))
    const composed = numbersSetter.compose(positivePrism)
    // Only positive numbers get modified
    const result = composed.modify(n => n * 10)([-1, 2, -3, 4])
    expect(result).toEqual([-1, 20, -3, 40])
  })

  it("Setter.compose(Traversal) = Setter", () => {
    interface Model { items: readonly number[] }
    const modelSetter = setterOf<Model, Model>(f => m => f(m))
    const itemsTrav = traversal<Model, number>(
      m => m.items,
      f => m => ({ items: m.items.map(f) }),
    )
    const composed = modelSetter.compose(itemsTrav)
    const result = composed.modify(n => n + 1)({ items: [1, 2, 3] })
    expect(result).toEqual({ items: [2, 3, 4] })
  })
})

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

describe("Review", () => {
  it("reviewOf creates a Review", () => {
    const r = reviewOf<string, number>(n => String(n))
    expect(r.review(42)).toBe("42")
  })

  it("Review.compose(Review) = Review", () => {
    const r1 = reviewOf<string, number>(n => `num:${n}`)
    const r2 = reviewOf<number, boolean>(b => b ? 1 : 0)
    const composed = r1.compose(r2)
    expect(composed.review(true)).toBe("num:1")
    expect(composed.review(false)).toBe("num:0")
  })

  it("Review.compose(Prism) = Review", () => {
    type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number }
    const shapePrism = prismOf<Shape, { kind: "circle"; r: number }>(
      s => s.kind === "circle" ? s : null,
      c => c,
    )
    const r = reviewOf<Shape[], Shape>(s => [s])
    const composed = r.compose(shapePrism)
    expect(composed.review({ kind: "circle", r: 5 })).toEqual([{ kind: "circle", r: 5 }])
  })

  it("Review.compose(Iso) = Review", () => {
    const r = reviewOf<string[], string>(s => [s])
    const composed = r.compose(uppercaseIso)
    expect(composed.review("hello")).toEqual(["hello"]) // Iso.to = toLowerCase
  })
})

// ---------------------------------------------------------------------------
// Conversion functions
// ---------------------------------------------------------------------------

describe("toGetter", () => {
  it("extracts Getter from Lens", () => {
    const g = toGetter(nameLens)
    expect(g.get(alice)).toBe("Alice")
  })

  it("extracts Getter from Iso", () => {
    const g = toGetter(uppercaseIso)
    expect(g.get("hello")).toBe("HELLO")
  })
})

describe("toFold", () => {
  it("extracts Fold from Traversal", () => {
    const eachNum = each<number>()
    const f = toFold(eachNum)
    expect(f.getAll([1, 2, 3])).toEqual([1, 2, 3])
  })

  it("extracts Fold from Prism", () => {
    const f = toFold(positivePrism)
    expect(f.getAll(5)).toEqual([5])
    expect(f.getAll(-1)).toEqual([])
  })

  it("extracts Fold from Affine", () => {
    const f = toFold(bioAffine)
    expect(f.getAll(alice)).toEqual(["Engineer"])
    expect(f.getAll(bob)).toEqual([])
  })
})

describe("toSetter", () => {
  it("extracts Setter from Lens", () => {
    const s = toSetter(nameLens)
    const result = s.modify(n => n.toUpperCase())(alice)
    expect(result.name).toBe("ALICE")
  })

  it("extracts Setter from Traversal", () => {
    const eachNum = each<number>()
    const s = toSetter(eachNum)
    expect(s.modify(n => n * 2)([1, 2, 3])).toEqual([2, 4, 6])
  })

  it("Setter.set works", () => {
    const s = toSetter(nameLens)
    const result = s.set("Charlie")(alice)
    expect(result.name).toBe("Charlie")
  })
})

describe("toReview", () => {
  it("extracts Review from Prism", () => {
    const r = toReview(positivePrism)
    expect(r.review(42)).toBe(42)
  })

  it("extracts Review from Iso", () => {
    const r = toReview(uppercaseIso)
    expect(r.review("HELLO")).toBe("hello")
  })
})

// ---------------------------------------------------------------------------
// Cross-composition: OpticBase.compose(new types)
// ---------------------------------------------------------------------------

describe("OpticBase.compose with new types", () => {
  it("Lens.compose(Getter) = Getter", () => {
    const lengthGetter = getterOf<string, number>(s => s.length)
    const composed = nameLens.compose(lengthGetter)
    expect(composed.get(alice)).toBe(5)
  })

  it("Prism.compose(Getter) = Fold", () => {
    const strGetter = getterOf<number, string>(n => String(n))
    const composed = positivePrism.compose(strGetter)
    expect(composed.getAll(5)).toEqual(["5"])
    expect(composed.getAll(-1)).toEqual([])
  })

  it("Lens.compose(Fold) = Fold", () => {
    interface Model { items: readonly number[] }
    const itemsLens = prop<Model>()("items")
    const evenFold = foldOf<readonly number[], number>(arr => arr.filter(n => n % 2 === 0))
    const composed = itemsLens.compose(evenFold)
    expect(composed.getAll({ items: [1, 2, 3, 4] })).toEqual([2, 4])
  })

  it("Lens.compose(Setter) = Setter", () => {
    interface Model { items: number[] }
    const itemsLens = lensOf<Model, number[]>(
      m => m.items,
      (items, m) => ({ ...m, items }),
    )
    const mapSetter = setterOf<number[], number>(f => arr => arr.map(f))
    const composed = itemsLens.compose(mapSetter)
    const result = composed.modify(n => n * 2)({ items: [1, 2, 3] })
    expect(result.items).toEqual([2, 4, 6])
  })
})

// ---------------------------------------------------------------------------
// Cross-composition: Traversal.compose(new types)
// ---------------------------------------------------------------------------

describe("Traversal.compose with new types", () => {
  const eachUser = each<User>()

  it("Traversal.compose(Getter) = Fold", () => {
    const nameGetter = getterOf<User, string>(u => u.name)
    const composed = eachUser.compose(nameGetter)
    expect(composed.getAll([alice, bob])).toEqual(["Alice", "Bob"])
  })

  it("Traversal.compose(Fold) = Fold", () => {
    const bioFold = foldOf<User, string>(u => u.bio !== null ? [u.bio] : [])
    const composed = eachUser.compose(bioFold)
    expect(composed.getAll([alice, bob])).toEqual(["Engineer"])
  })

  it("Traversal.compose(Setter) = Setter", () => {
    const nameSetter = setterOf<User, User>(f => u => f(u))
    const composed = eachUser.compose(nameSetter)
    const result = composed.modify(u => ({ ...u, name: u.name.toUpperCase() }))([alice, bob])
    expect(result[0]!.name).toBe("ALICE")
    expect(result[1]!.name).toBe("BOB")
  })
})
