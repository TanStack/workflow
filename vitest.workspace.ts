import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      './packages/template-devtools/vitest.config.ts',
      './packages/template/vitest.config.ts',
      './packages/react-template-devtools/vitest.config.ts',
      './packages/react-template/vitest.config.ts',
      './packages/solid-template-devtools/vitest.config.ts',
      './packages/solid-template/vitest.config.ts',
    ],
  },
})
