import { configDefaults, defineConfig } from 'vitest/config'

// Unit tests are plain TS modules (server/lib, shared, app/utils) with injected deps,
// so no Nuxt test environment is needed. Live tests hit real external APIs and only run
// with `pnpm test:live`.
export default defineConfig({
  test: {
    environment: 'node',
    exclude: [
      ...configDefaults.exclude,
      '.nuxt/**',
      '.output/**',
      ...(process.env.LIVE ? [] : ['**/*.live.test.ts'])
    ]
  }
})
