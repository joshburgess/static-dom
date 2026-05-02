/**
 * examples/todo.ts — demonstrates `array`, lens `focus`, and `optional`
 */

import { element, text, array, optional, program, prism } from "../src/index"

interface Todo {
  id: string
  text: string
  done: boolean
}

interface TodoModel {
  todos: Todo[]
  input: string
  filter: "all" | "active" | "done"
  editing: { id: string; draft: string } | null
}

type TodoMsg =
  | { type: "inputChanged"; value: string }
  | { type: "addTodo" }
  | { type: "toggleTodo"; id: string }
  | { type: "removeTodo"; id: string }
  | { type: "startEdit"; id: string }
  | { type: "editChanged"; value: string }
  | { type: "commitEdit" }
  | { type: "cancelEdit" }
  | { type: "setFilter"; filter: TodoModel["filter"] }

function todoUpdate(msg: TodoMsg, model: TodoModel): TodoModel {
  switch (msg.type) {
    case "inputChanged":
      return { ...model, input: msg.value }

    case "addTodo":
      if (!model.input.trim()) return model
      return {
        ...model,
        todos: [...model.todos, {
          id: Math.random().toString(36).slice(2),
          text: model.input.trim(),
          done: false,
        }],
        input: "",
      }

    case "toggleTodo":
      return {
        ...model,
        todos: model.todos.map(t =>
          t.id === msg.id ? { ...t, done: !t.done } : t
        ),
      }

    case "removeTodo":
      return { ...model, todos: model.todos.filter(t => t.id !== msg.id) }

    case "startEdit":
      return {
        ...model,
        editing: { id: msg.id, draft: model.todos.find(t => t.id === msg.id)?.text ?? "" },
      }

    case "editChanged":
      return model.editing
        ? { ...model, editing: { ...model.editing, draft: msg.value } }
        : model

    case "commitEdit":
      if (!model.editing) return model
      return {
        ...model,
        todos: model.todos.map(t =>
          t.id === model.editing!.id ? { ...t, text: model.editing!.draft } : t
        ),
        editing: null,
      }

    case "cancelEdit":
      return { ...model, editing: null }

    case "setFilter":
      return { ...model, filter: msg.filter }
  }
}

// The todo item component -- knows only about `Todo`, not the full TodoModel
const todoItem = element<"li", Todo, TodoMsg>("li", {
  classes: m => ({ done: m.done, editing: false }),
}, [
  element("input", {
    attrs: { type: () => "checkbox", checked: m => m.done },
    on: { change: (_e, m) => ({ type: "toggleTodo", id: m.id }) },
  }, []),
  text(m => m.text),
  element("button", {
    rawAttrs: { "aria-label": () => "delete" },
    on: { click: (_e, m) => ({ type: "removeTodo", id: m.id }) },
  }, [text(() => "\u00d7")]),
])

// Prism for the editing state
const editingPrism = prism<TodoModel, { id: string; draft: string }>(
  m => m.editing,
  editing => ({ todos: [], input: "", filter: "all", editing })
)

// Edit form -- only rendered when `model.editing` is non-null
const editForm = optional(
  editingPrism,
  element<"div", { id: string; draft: string }, TodoMsg>("div", { rawAttrs: { class: () => "edit-form" } }, [
    element("input", {
      attrs: { value: m => m.draft },
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
    element("button", { on: { click: () => ({ type: "commitEdit" }) } }, [text(() => "Save")]),
    element("button", { on: { click: () => ({ type: "cancelEdit" }) } }, [text(() => "Cancel")]),
  ])
)

// The visible todos, derived from filter
function visibleTodos(model: TodoModel): Todo[] {
  switch (model.filter) {
    case "all":    return model.todos
    case "active": return model.todos.filter(t => !t.done)
    case "done":   return model.todos.filter(t => t.done)
  }
}

const todoView = element<"div", TodoModel, TodoMsg>("div", { rawAttrs: { class: () => "todo-app" } }, [
  // Input row
  element("div", { rawAttrs: { class: () => "input-row" } }, [
    element("input", {
      attrs: { value: m => m.input, placeholder: () => "What needs to be done?" },
      on: {
        input: (e, _m) => ({
          type: "inputChanged",
          value: (e.target as HTMLInputElement).value,
        }),
        keydown: (e, _m) => e.key === "Enter" ? { type: "addTodo" } : null,
      },
    }, []),
    element("button", { on: { click: () => ({ type: "addTodo" }) } }, [
      text(() => "Add"),
    ]),
  ]),

  // Filter tabs
  element("div", { rawAttrs: { class: () => "filters" } }, [
    element("button", {
      classes: m => ({ active: m.filter === "all" }),
      on: { click: () => ({ type: "setFilter", filter: "all" as const }) },
    }, [text(() => "All")]),
    element("button", {
      classes: m => ({ active: m.filter === "active" }),
      on: { click: () => ({ type: "setFilter", filter: "active" as const }) },
    }, [text(() => "Active")]),
    element("button", {
      classes: m => ({ active: m.filter === "done" }),
      on: { click: () => ({ type: "setFilter", filter: "done" as const }) },
    }, [text(() => "Done")]),
  ]),

  // Dynamic list -- uses `array` with keyed items, reuses DOM nodes
  array(
    "ul",
    m => visibleTodos(m).map(t => ({ key: t.id, model: t })),
    todoItem
  ),

  // Summary
  element("p", { rawAttrs: { class: () => "summary" } }, [
    text(m => {
      const active = m.todos.filter(t => !t.done).length
      return `${active} item${active !== 1 ? "s" : ""} left`
    }),
  ]),

  // Edit form -- conditionally present via `optional` + Prism
  editForm,
])

export function mountTodo(container: HTMLElement) {
  return program({
    container,
    init: { todos: [], input: "", filter: "all", editing: null },
    update: todoUpdate,
    view: todoView,
  })
}
