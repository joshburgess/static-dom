# @static-dom/react

React adapter for [Static DOM](https://github.com/joshburgess/static-dom).

Drop SDOM subtrees into existing React apps as a performance optimisation. React manages the component tree above the boundary; SDOM manages everything inside it with no virtual-DOM diffing.

## Install

```sh
pnpm add @static-dom/react @static-dom/core
```

`react` (^18 or ^19) is a peer dependency.

## Usage

### Component API

```tsx
import { SDOMBoundary } from "@static-dom/react"
import { myTableView } from "./views"

function App({ model, onMsg }) {
  return (
    <div>
      <h1>Dashboard</h1>
      <SDOMBoundary sdom={myTableView} model={model} onMsg={onMsg} />
    </div>
  )
}
```

### Hook API

```tsx
import { useSDOMBoundary } from "@static-dom/react"

function MyComponent({ model, onMsg }) {
  const ref = useSDOMBoundary(myView, model, onMsg)
  return <div ref={ref} />
}
```

When `model` changes, the update flows directly to SDOM's subscription system, bypassing React's reconciler.

## License

Dual-licensed under Apache-2.0 OR MIT.
