/**
 * Shared benchmark helpers — data generation, DOM cleanup.
 */

export interface Row {
  id: string
  label: string
  selected: boolean
}

let nextId = 0

export function makeRows(count: number): Row[] {
  const rows: Row[] = []
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `row-${nextId++}`,
      label: `Item ${nextId} - ${adjectives[nextId % adjectives.length]} ${nouns[nextId % nouns.length]}`,
      selected: false,
    })
  }
  return rows
}

const adjectives = [
  "pretty", "large", "big", "small", "tall", "short", "long", "handsome",
  "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful",
  "mushy", "odd", "unsightly", "adorable", "important", "inexpensive",
  "cheap", "expensive", "fancy",
]

const nouns = [
  "table", "chair", "house", "bbq", "desk", "car", "pony", "cookie",
  "sandwich", "burger", "pizza", "mouse", "keyboard", "monitor", "phone",
  "laptop", "screen", "printer", "scanner", "speaker", "headphone",
]

/** Clean up a DOM container between benchmark iterations. */
export function clearContainer(container: Element): void {
  container.innerHTML = ""
}
