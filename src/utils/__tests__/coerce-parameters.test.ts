/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { TokenContract } from '@aztec-foundation/aztec-standards/dist/src/artifacts/Token.js'
import { AztecAddress } from '@aztec/aztec.js/addresses'
import { deepCopy } from '@persistent-ai/fireflow-types'
import { describe, expect, it } from 'vitest'
import { alignMethodParameters, coerceMethodParameters } from '../../utils/coerce-parameters'

describe('coerceMethodParameters', () => {
  const addr = AztecAddress.fromStringUnsafe(
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  )

  it('rehydrates deep-copied AztecAddress method arguments', () => {
    const copied = deepCopy(addr)
    const coerced = coerceMethodParameters(
      TokenContract.artifact,
      'transfer_private_to_private',
      [copied, copied, 1n, 0],
    )

    expect(coerced[0]).toBeInstanceOf(AztecAddress)
    expect(coerced[1]).toBeInstanceOf(AztecAddress)
  })

  it('falls back when artifact ABI entry has no parameters array', () => {
    const copied = deepCopy(addr)
    const sparseArtifact = {
      ...TokenContract.artifact,
      functions: [{ name: 'transfer_private_to_private' }],
      nonDispatchPublicFunctions: [],
    } as typeof TokenContract.artifact

    const coerced = coerceMethodParameters(
      sparseArtifact,
      'transfer_private_to_private',
      [copied, copied, 1n, 0],
    )

    expect(coerced[0]).toBeInstanceOf(AztecAddress)
    expect(coerced[1]).toBeInstanceOf(AztecAddress)
  })

  it('pads missing trailing _nonce with field default 0', () => {
    const addr = AztecAddress.fromStringUnsafe(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    )
    const aligned = alignMethodParameters(
      TokenContract.artifact,
      'transfer_private_to_private',
      [addr, addr, 1n],
    )

    expect(aligned).toHaveLength(4)
    expect(aligned[3]).toBe(0)
  })
})
