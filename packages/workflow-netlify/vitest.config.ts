import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@tanstack/workflow-core': new URL(
        '../workflow-core/src/index.ts',
        import.meta.url,
      ).pathname,
      '@tanstack/workflow-runtime': new URL(
        '../workflow-runtime/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    name: packageJson.name,
    watch: false,
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
})
