import { describe, it, expect } from "vitest"
import { lis } from "../src/constructors"

describe("lis (Longest Increasing Subsequence)", () => {
  it("returns empty for empty array", () => {
    expect(lis([])).toEqual([])
  })

  it("returns single element for single-element array", () => {
    expect(lis([5])).toEqual([0])
  })

  it("returns all indices for sorted array", () => {
    expect(lis([1, 2, 3, 4, 5])).toEqual([0, 1, 2, 3, 4])
  })

  it("returns single index for reversed array", () => {
    const result = lis([5, 4, 3, 2, 1])
    expect(result.length).toBe(1)
  })

  it("finds LIS in mixed sequence", () => {
    // [3, 1, 4, 1, 5, 9, 2, 6] → LIS could be [1, 4, 5, 9] or [1, 4, 5, 6]
    const result = lis([3, 1, 4, 1, 5, 9, 2, 6])
    expect(result.length).toBe(4)
    // Verify the values at returned indices form an increasing sequence
    const values = result.map(i => [3, 1, 4, 1, 5, 9, 2, 6][i]!)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!)
    }
  })

  it("handles duplicates", () => {
    const result = lis([2, 2, 2, 2])
    expect(result.length).toBe(1)
  })

  it("finds LIS of reordering scenario", () => {
    // Old: [A=0, B=1, C=2, D=3, E=4]
    // New: [D, A, E, B, C]
    // Old positions in new order: [3, 0, 4, 1, 2]
    // LIS: [0, 4] → indices [1, 2] (positions 0, 4) or [0, 1, 2] → [1, 3, 4] (positions 0, 1, 2)
    const result = lis([3, 0, 4, 1, 2])
    expect(result.length).toBe(3) // 0 < 1 < 2 at indices 1, 3, 4
  })
})
