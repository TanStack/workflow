import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['./packages/workflow-core/vitest.config.ts'],
  },
})
