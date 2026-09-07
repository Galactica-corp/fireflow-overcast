/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'
import { parseAccountNetwork, parseAztecAccountPointer } from '../aztec-account-ref'

describe('parseAztecAccountPointer', () => {
  it('reads secretId and address from a pointer file', () => {
    const raw = JSON.stringify({
      version: '1.0',
      type: 'ffsecret',
      secretId: 'SEC_1',
      secretType: 'aztec-account',
      address: '0xabc',
    })
    expect(parseAztecAccountPointer(raw, 'secrets/x.ffsecret')).toMatchObject({
      secretId: 'SEC_1',
      address: '0xabc',
    })
  })

  it('throws on invalid JSON', () => {
    expect(() => parseAztecAccountPointer('not-json', 'p')).toThrow(/not valid JSON/)
  })

  it('throws when secretId or address is missing', () => {
    expect(() => parseAztecAccountPointer(JSON.stringify({ secretId: 'SEC_1' }), 'p'))
      .toThrow(/missing secretId or address/)
  })
})

describe('parseAccountNetwork', () => {
  it('accepts a known network', () => {
    expect(parseAccountNetwork('Testnet')).toBe('Testnet')
  })

  it('rejects an unknown network', () => {
    expect(() => parseAccountNetwork('Mainnet')).toThrow(/Unknown Aztec network/)
  })
})
