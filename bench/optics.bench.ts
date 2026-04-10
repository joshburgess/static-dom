/**
 * Benchmark: Optics Performance
 *
 * Compares the new unified optics (Either-wrapped getOptic/setOptic) against
 * raw function calls to verify no significant regression from the structural
 * subtyping redesign.
 *
 * Scenarios:
 *   1. Lens get/set — single prop lens
 *   2. Composed lens get/set — 5-deep composed prop lenses via at()
 *   3. Prism preview — union member match/miss
 *   4. Traversal getAll/modifyAll — each() over arrays
 *   5. modify — lens + prism + affine
 *   6. Raw function baseline — equivalent operations without optics
 */

import { bench, describe } from "vitest"
import {
  prop, at, composeLenses, lensOf, prismOf, affineOf,
  each, values, filtered, unionMember, indexLens,
} from "../src/optics"

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

interface Address { street: string; city: string; zip: string }
interface User { name: string; age: number; address: Address }
interface App { user: User; settings: { theme: string; lang: string } }

const app: App = {
  user: {
    name: "Alice",
    age: 30,
    address: { street: "123 Elm St", city: "Springfield", zip: "62701" },
  },
  settings: { theme: "dark", lang: "en" },
}

const users: ReadonlyArray<User> = Array.from({ length: 1000 }, (_, i) => ({
  name: `User${i}`,
  age: 20 + (i % 50),
  address: { street: `${i} Main St`, city: "Town", zip: String(10000 + i) },
}))

type Shape =
  | { kind: "circle"; r: number }
  | { kind: "rect"; w: number; h: number }

const shapes: ReadonlyArray<Shape> = Array.from({ length: 1000 }, (_, i) =>
  i % 2 === 0
    ? { kind: "circle" as const, r: i }
    : { kind: "rect" as const, w: i, h: i * 2 }
)

// ---------------------------------------------------------------------------
// Pre-built optics (not counted in benchmark)
// ---------------------------------------------------------------------------

const nameLens = prop<User>()("name")
const streetLens = at<App>()("user", "address", "street")
const ageLens = prop<User>()("age")

const circlePrism = prismOf<Shape, { kind: "circle"; r: number }>(
  s => s.kind === "circle" ? s as { kind: "circle"; r: number } : null,
  c => c,
)

const eachUser = each<User>()
const eachUserName = eachUser.compose(prop<User>()("name"))
const adultsOnly = eachUser.compose(filtered<User>(u => u.age >= 21))

interface NullModel { value: number | null }
const valueAffine = affineOf<NullModel, number>(
  m => m.value,
  (v, m) => ({ ...m, value: v }),
)

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("Lens get/set — single prop", () => {
  const user = app.user

  bench("lens.get", () => {
    nameLens.get(user)
  })

  bench("lens.set", () => {
    nameLens.set("Bob", user)
  })

  bench("raw get (baseline)", () => {
    user.name
  })

  bench("raw set (baseline)", () => {
    ({ ...user, name: "Bob" })
  })
})

describe("Lens get/set — 3-deep composed (at)", () => {
  bench("composed.get", () => {
    streetLens.get(app)
  })

  bench("composed.set", () => {
    streetLens.set("456 Oak Ave", app)
  })

  bench("raw get (baseline)", () => {
    app.user.address.street
  })

  bench("raw set (baseline)", () => {
    ({
      ...app,
      user: {
        ...app.user,
        address: { ...app.user.address, street: "456 Oak Ave" },
      },
    })
  })
})

describe("Prism preview — union member", () => {
  const circle: Shape = { kind: "circle", r: 5 }
  const rect: Shape = { kind: "rect", w: 3, h: 4 }

  bench("prism.preview (match)", () => {
    circlePrism.preview(circle)
  })

  bench("prism.preview (miss)", () => {
    circlePrism.preview(rect)
  })

  bench("raw check (baseline)", () => {
    circle.kind === "circle" ? circle : null
  })
})

describe("Traversal getAll — 1000 elements", () => {
  bench("each().getAll", () => {
    eachUser.getAll(users)
  })

  bench("each().compose(prop).getAll", () => {
    eachUserName.getAll(users)
  })

  bench("filtered().getAll", () => {
    adultsOnly.getAll(users)
  })

  bench("raw map (baseline)", () => {
    users.map(u => u.name)
  })

  bench("raw filter (baseline)", () => {
    users.filter(u => u.age >= 21)
  })
})

describe("Traversal modifyAll — 1000 elements", () => {
  bench("each().compose(prop).modifyAll", () => {
    eachUserName.modifyAll(n => n.toUpperCase())(users)
  })

  bench("raw map (baseline)", () => {
    users.map(u => ({ ...u, name: u.name.toUpperCase() }))
  })
})

describe("modify — various optic types", () => {
  const user = app.user

  bench("lens.modify", () => {
    ageLens.modify(a => a + 1)(user)
  })

  bench("prism.modify (match)", () => {
    const circle: Shape = { kind: "circle", r: 5 }
    circlePrism.modify(c => ({ ...c, r: c.r * 2 }))(circle)
  })

  bench("prism.modify (miss)", () => {
    const rect: Shape = { kind: "rect", w: 3, h: 4 }
    circlePrism.modify(c => ({ ...c, r: c.r * 2 }))(rect)
  })

  bench("affine.modify (present)", () => {
    valueAffine.modify(v => v + 1)({ value: 5 })
  })

  bench("affine.modify (absent)", () => {
    valueAffine.modify(v => v + 1)({ value: null })
  })

  bench("raw modify (baseline)", () => {
    ({ ...user, age: user.age + 1 })
  })
})

describe("Traversal fold — 1000 elements", () => {
  const sumAges = eachUser
    .compose(prop<User>()("age"))
    .fold<number>((acc, age) => acc + age, 0)

  bench("traversal.fold", () => {
    sumAges(users)
  })

  bench("raw reduce (baseline)", () => {
    users.reduce((acc, u) => acc + u.age, 0)
  })
})
