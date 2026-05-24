import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: packageJson.name,
    watch: false,
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
})
