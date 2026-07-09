import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'server/**/__tests__/**/*.test.ts',
      'app/**/__tests__/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'server/utils/**/*.ts',
      ],
      exclude: [
        'server/utils/**/*.d.ts',
        'server/utils/**/__tests__/**',
      ],
    },
  },
})