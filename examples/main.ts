/**
 * examples/main.ts — router that mounts the selected example
 */

import { mountCounter } from "./counter"
import { mountTodo } from "./todo"
import { mountMatchDemo } from "./match-demo"
import { mountDynamicDemo } from "./dynamic-demo"

const app = document.getElementById("app")!
const navLinks = document.querySelectorAll("nav a")

let currentHandle: { teardown(): void } | null = null

function route() {
  // Clean up previous example
  if (currentHandle) {
    currentHandle.teardown()
    currentHandle = null
  }
  app.innerHTML = ""

  // Highlight active nav link
  const hash = location.hash || "#counter"
  navLinks.forEach(a => {
    a.classList.toggle("active", a.getAttribute("href") === hash)
  })

  // Mount the selected example
  switch (hash) {
    case "#counter":
      currentHandle = mountCounter(app)
      break
    case "#todo":
      currentHandle = mountTodo(app)
      break
    case "#match":
      currentHandle = mountMatchDemo(app)
      break
    case "#dynamic":
      currentHandle = mountDynamicDemo(app)
      break
    default:
      currentHandle = mountCounter(app)
  }
}

window.addEventListener("hashchange", route)
route()
