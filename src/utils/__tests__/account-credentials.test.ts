/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'
import { parseFq, parseFr } from '../../shared/fields'
import { generateAccountCredentials } from '../aztec-wallet'

describe('generateAccountCredentials', () => {
  it('returns three values that parseFr / parseFq accept, and successive calls agree on nothing', () => {
    const a = generateAccountCredentials()
    const b = generateAccountCredentials()

    expect(() => parseFr(a.secret)).not.toThrow()
    expect(() => parseFr(a.salt)).not.toThrow()
    expect(() => parseFq(a.signingKey)).not.toThrow()

    expect(a.secret).not.toBe(b.secret)
    expect(a.salt).not.toBe(b.salt)
    expect(a.signingKey).not.toBe(b.signingKey)
    expect(a.secret).not.toBe(a.salt)
    expect(a.secret).not.toBe(a.signingKey)
    expect(a.salt).not.toBe(a.signingKey)
  })
})
