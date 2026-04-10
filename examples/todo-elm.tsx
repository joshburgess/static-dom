/**
 * examples/todo-elm.tsx
 *
 * Full-stack SDOM example demonstrating:
 *   - JSX runtime (automatic mode)
 *   - Elm architecture (elmProgram with Cmd + Sub)
 *   - Optics (prop, at, each, Traversal, Prism, Affine)
 *   - Compiled templates (auto-optimized by JSX)
 *   - array() for keyed list reconciliation
 *   - optional() with Prism for conditional rendering
 *   - Subscriptions (keyboard shortcuts)
 *
 * To run (conceptual — needs a bundler with sdomJsx plugin):
 *   import { mountTodoElm } from "./todo-elm"
 *   mountTodoElm(document.getElementById("app")!)
 */

import {
  text, element, array, optional, staticText, fragment,
  elmProgram, noCmd, batchCmd,
  prop, at, each, prismOf, nullablePrism, composeLenses,
  onWindow,
  type Cmd, type Sub, type KeyedItem,
} from "../src/index"

// ─────────────────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────────────────

interface Todo {
  readonly id: string
  readonly text: string
  readonly done: boolean
}

interface EditState {
  readonly id: string
  readonly draft: string
}

interface Model {
  readonly todos: ReadonlyArray<Todo>
  readonly input: string
  readonly filter: "all" | "active" | "done"
  readonly editing: EditState | null
  readonly nextId: number
}

const init: Model = {
  todos: [
    { id: "1", text: "Learn SDOM", done: true },
    { id: "2", text: "Build something", done: false },
    { id: "3", text: "Ship it", done: false },
  ],
  input: "",
  filter: "all",
  editing: null,
  nextId: 4,
}

// ─────────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────────

type Msg =
  | { readonly type: "inputChanged"; readonly value: string }
  | { readonly type: "addTodo" }
  | { readonly type: "toggleTodo"; readonly id: string }
  | { readonly type: "toggleAll" }
  | { readonly type: "removeTodo"; readonly id: string }
  | { readonly type: "clearDone" }
  | { readonly type: "startEdit"; readonly id: string }
  | { readonly type: "editChanged"; readonly value: string }
  | { readonly type: "commitEdit" }
  | { readonly type: "cancelEdit" }
  | { readonly type: "setFilter"; readonly filter: Model["filter"] }
  | { readonly type: "keydown"; readonly key: string }

// ─────────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────────

function update(msg: Msg, model: Model): [Model, Cmd<Msg>] {
  switch (msg.type) {
    case "inputChanged":
      return [{ ...model, input: msg.value }, noCmd]

    case "addTodo": {
      const text = model.input.trim()
      if (!text) return [model, noCmd]
      const id = String(model.nextId)
      return [{
        ...model,
        todos: [...model.todos, { id, text, done: false }],
        input: "",
        nextId: model.nextId + 1,
      }, noCmd]
    }

    case "toggleTodo":
      return [{
        ...model,
        todos: model.todos.map(t =>
          t.id === msg.id ? { ...t, done: !t.done } : t
        ),
      }, noCmd]

    case "toggleAll": {
      const allDone = model.todos.every(t => t.done)
      return [{
        ...model,
        todos: model.todos.map(t => ({ ...t, done: !allDone })),
      }, noCmd]
    }

    case "removeTodo":
      return [{
        ...model,
        todos: model.todos.filter(t => t.id !== msg.id),
      }, noCmd]

    case "clearDone":
      return [{
        ...model,
        todos: model.todos.filter(t => !t.done),
      }, noCmd]

    case "startEdit": {
      const todo = model.todos.find(t => t.id === msg.id)
      if (!todo) return [model, noCmd]
      return [{
        ...model,
        editing: { id: msg.id, draft: todo.text },
      }, noCmd]
    }

    case "editChanged":
      return model.editing
        ? [{ ...model, editing: { ...model.editing, draft: msg.value } }, noCmd]
        : [model, noCmd]

    case "commitEdit": {
      if (!model.editing) return [model, noCmd]
      const draft = model.editing.draft.trim()
      if (!draft) return [model, noCmd]
      return [{
        ...model,
        todos: model.todos.map(t =>
          t.id === model.editing!.id ? { ...t, text: draft } : t
        ),
        editing: null,
      }, noCmd]
    }

    case "cancelEdit":
      return [{ ...model, editing: null }, noCmd]

    case "setFilter":
      return [{ ...model, filter: msg.filter }, noCmd]

    case "keydown":
      // Global keyboard shortcuts
      if (msg.key === "Escape" && model.editing) {
        return [{ ...model, editing: null }, noCmd]
      }
      return [model, noCmd]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────────────────────────────────────

function subscriptions(_model: Model): Sub<Msg> {
  return onWindow<Msg>("keydown-handler", "keydown", (e) => ({
    type: "keydown",
    key: (e as KeyboardEvent).key,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Optics — demonstrating the new unified system
// ─────────────────────────────────────────────────────────────────────────────

// Path selector: deep focus in one call
const inputLens = at<Model>()("input")
const filterLens = at<Model>()("filter")
const todosLens = at<Model>()("todos")

// Traversal: focus on all todos, then each todo's text
const allTodoTexts = todosLens
  .compose(each<Todo>())
  .compose(prop<Todo>()("text"))

// Traversal: all done flags
const allDoneFlags = todosLens
  .compose(each<Todo>())
  .compose(prop<Todo>()("done"))

// Prism: editing state
const editingPrism = prismOf<Model, EditState>(
  m => m.editing,
  editing => ({ ...init, editing }),
)

// Affine: nullable field access
const editingAffine = nullablePrism<Model>()("editing")

// Derived: count helpers using Traversal fold
const countActive = todosLens
  .compose(each<Todo>())
  .compose(prop<Todo>()("done"))
  .fold<number>((acc, done) => acc + (done ? 0 : 1), 0)

const countDone = todosLens
  .compose(each<Todo>())
  .compose(prop<Todo>()("done"))
  .fold<number>((acc, done) => acc + (done ? 1 : 0), 0)

// ─────────────────────────────────────────────────────────────────────────────
// Visible todos — filtered view
// ─────────────────────────────────────────────────────────────────────────────

function visibleTodos(model: Model): KeyedItem<Todo>[] {
  const filtered = model.filter === "all"
    ? model.todos
    : model.filter === "active"
      ? model.todos.filter(t => !t.done)
      : model.todos.filter(t => t.done)
  return filtered.map(t => ({ key: t.id, model: t }))
}

// ─────────────────────────────────────────────────────────────────────────────
// View — using constructors (JSX alternative shown in comments)
// ─────────────────────────────────────────────────────────────────────────────

// Todo item — only knows about Todo, not the full Model
const todoItem = element<"li", Todo, Msg>("li", {
  classes: m => ({
    "todo-item": true,
    done: m.done,
  }),
}, [
  element("div", { rawAttrs: { class: () => "todo-content" } }, [
    element("input", {
      attrs: {
        type: () => "checkbox",
        checked: m => m.done,
      },
      on: {
        change: (_e, m) => ({ type: "toggleTodo", id: m.id }),
      },
    }, []),
    element("span", {
      classes: m => ({ "todo-text": true, strikethrough: m.done }),
    }, [
      text(m => m.text),
    ]),
    element("button", {
      rawAttrs: { class: () => "edit-btn" },
      on: { click: (_e, m) => ({ type: "startEdit", id: m.id }) },
    }, [staticText("Edit")]),
    element("button", {
      rawAttrs: { class: () => "delete-btn" },
      on: { click: (_e, m) => ({ type: "removeTodo", id: m.id }) },
    }, [staticText("\u00d7")]),
  ]),
])

// Edit overlay — rendered only when editing is non-null
const editOverlay = optional(
  editingPrism,
  element<"div", EditState, Msg>("div", {
    rawAttrs: { class: () => "edit-overlay" },
  }, [
    element("input", {
      attrs: { value: m => m.draft, type: () => "text" },
      rawAttrs: { class: () => "edit-input" },
      on: {
        input: (e, _m) => ({
          type: "editChanged",
          value: (e.target as HTMLInputElement).value,
        }),
        keydown: (e, _m) => {
          if (e.key === "Enter") return { type: "commitEdit" }
          if (e.key === "Escape") return { type: "cancelEdit" }
          return null
        },
      },
    }, []),
    element("button", {
      rawAttrs: { class: () => "save-btn" },
      on: { click: () => ({ type: "commitEdit" }) },
    }, [staticText("Save")]),
    element("button", {
      rawAttrs: { class: () => "cancel-btn" },
      on: { click: () => ({ type: "cancelEdit" }) },
    }, [staticText("Cancel")]),
  ]),
)

// Main view
const view = element<"div", Model, Msg>("div", {
  rawAttrs: { class: () => "todo-app" },
}, [
  // Header
  element("h1", {}, [staticText("SDOM Todos")]),

  // Input row
  element("div", { rawAttrs: { class: () => "input-row" } }, [
    element("input", {
      attrs: {
        value: m => m.input,
        placeholder: () => "What needs to be done?",
      },
      rawAttrs: { class: () => "new-todo" },
      on: {
        input: (e, _m) => ({
          type: "inputChanged",
          value: (e.target as HTMLInputElement).value,
        }),
        keydown: (e, _m) => e.key === "Enter" ? { type: "addTodo" } : null,
      },
    }, []),
    element("button", {
      rawAttrs: { class: () => "add-btn" },
      on: { click: () => ({ type: "addTodo" }) },
    }, [staticText("Add")]),
  ]),

  // Toggle all + filter bar
  element("div", { rawAttrs: { class: () => "toolbar" } }, [
    element("button", {
      rawAttrs: { class: () => "toggle-all" },
      on: { click: () => ({ type: "toggleAll" }) },
    }, [text(m => m.todos.every(t => t.done) ? "Uncheck all" : "Check all")]),

    element("div", { rawAttrs: { class: () => "filters" } }, [
      element("button", {
        classes: m => ({ active: m.filter === "all" }),
        on: { click: () => ({ type: "setFilter", filter: "all" as const }) },
      }, [staticText("All")]),
      element("button", {
        classes: m => ({ active: m.filter === "active" }),
        on: { click: () => ({ type: "setFilter", filter: "active" as const }) },
      }, [staticText("Active")]),
      element("button", {
        classes: m => ({ active: m.filter === "done" }),
        on: { click: () => ({ type: "setFilter", filter: "done" as const }) },
      }, [staticText("Done")]),
    ]),
  ]),

  // Todo list
  array("ul", visibleTodos, todoItem),

  // Footer
  element("div", { rawAttrs: { class: () => "footer" } }, [
    text(m => {
      const active = countActive(m)
      const done = countDone(m)
      return `${active} active, ${done} done, ${m.todos.length} total`
    }),
    element("button", {
      rawAttrs: { class: () => "clear-done" },
      on: { click: () => ({ type: "clearDone" }) },
    }, [text(m => `Clear done (${countDone(m)})`)]),
  ]),

  // Edit overlay (conditional via Prism)
  editOverlay,
])

// ─────────────────────────────────────────────────────────────────────────────
// Mount
// ─────────────────────────────────────────────────────────────────────────────

export function mountTodoElm(container: HTMLElement): void {
  elmProgram<Model, Msg>({
    container,
    init: [init, noCmd],
    update,
    view,
    subscriptions,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Optics demo — shows the power of the unified optics system
// ─────────────────────────────────────────────────────────────────────────────

/** Demonstrate optics outside of rendering. */
export function opticsDemo(): void {
  const model = init

  // Path selector
  console.log("Input:", inputLens.get(model))
  console.log("Filter:", filterLens.get(model))

  // Traversal: get all todo texts
  console.log("All texts:", allTodoTexts.getAll(model))

  // Traversal: fold to count
  console.log("Active count:", countActive(model))
  console.log("Done count:", countDone(model))

  // Traversal: modify all texts
  const uppercased = allTodoTexts.modifyAll(t => t.toUpperCase())(model)
  console.log("Uppercased:", allTodoTexts.getAll(uppercased))

  // Prism: check editing state
  console.log("Editing:", editingPrism.preview(model)) // null

  // Affine: nullable field
  console.log("Editing (affine):", editingAffine.preview(model)) // null

  // Lens modify
  const withNewFilter = filterLens.modify(() => "done" as const)(model)
  console.log("After filter change:", withNewFilter.filter)
}
