import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // node-pty spawns real processes; give lifecycle tests headroom.
    testTimeout: 15000,
    hookTimeout: 15000
  }
})
