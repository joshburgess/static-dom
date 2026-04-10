import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
  },
  bench: {
    environment: "happy-dom",
    include: ["bench/**/*.bench.ts"],
  },
})
