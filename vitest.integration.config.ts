/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['reflect-metadata', './src/__integration__/setup.ts'],
    globals: true,
    include: ['src/__integration__/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    pool: 'forks',
    singleFork: true,
    // Suites share one sandbox and one fixture deploy; do not race beforeAll hooks.
    fileParallelism: false,
  },
})
