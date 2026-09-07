/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['reflect-metadata'],
    globals: true,
    // Aztec's native/WASM stack SIGSEGVs when Vitest tears down a `threads`
    // worker that loaded `@aztec/*`. Process isolation (`forks`) is the
    // boundary that keeps this package — and the root suite's `overcast`
    // project — from dying after a green summary. Integration already uses
    // forks for the same class of reason (`vitest.integration.config.ts`).
    pool: 'forks',
    exclude: ['**/node_modules/**', '**/dist/**', '**/__integration__/**', '**/docs/demo/**'],
  },
})
