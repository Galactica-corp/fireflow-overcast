/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { TokenContract } from '@aztec-foundation/aztec-standards/dist/src/artifacts/Token.js'
import { getAllFunctionAbis } from '@aztec/stdlib/abi'
import { describe, expect, it } from 'vitest'
import { artifactNeedsAbiRepair, artifactNeedsBufferRehydration, artifactNeedsPublicFunctionLayoutRepair, repairContractArtifact } from '../../utils/repair-contract-artifact'

describe('repairContractArtifact', () => {
  it('detects sparse function ABIs', () => {
    const sparse = {
      ...TokenContract.artifact,
      functions: TokenContract.artifact.functions.map(fn => ({ name: fn.name })),
      nonDispatchPublicFunctions: [],
    } as typeof TokenContract.artifact

    expect(artifactNeedsAbiRepair(sparse)).toBe(true)
  })

  it('restores parameters for known Token artifact', () => {
    const sparse = {
      ...TokenContract.artifact,
      functions: TokenContract.artifact.functions.map(fn => ({ name: fn.name })),
      nonDispatchPublicFunctions: [],
    } as typeof TokenContract.artifact

    const repaired = repairContractArtifact(sparse)
    const fn = getAllFunctionAbis(repaired).find(f => f.name === 'transfer_private_to_private')

    expect(fn?.parameters).toHaveLength(4)
    expect(artifactNeedsAbiRepair(repaired)).toBe(false)
  })

  it('is a no-op for complete artifacts', () => {
    const repaired = repairContractArtifact(TokenContract.artifact)
    expect(repaired).toBe(TokenContract.artifact)
  })

  it('resolves JSON-parsed Token artifact to bundled SDK instance', () => {
    const parsed = JSON.parse(JSON.stringify(TokenContract.artifact)) as typeof TokenContract.artifact

    expect(artifactNeedsBufferRehydration(parsed)).toBe(true)

    const repaired = repairContractArtifact(parsed)
    expect(repaired).toBe(TokenContract.artifact)
    expect(artifactNeedsBufferRehydration(repaired)).toBe(false)
  })

  it('normalizes raw compiler layout with all public functions in functions', () => {
    const raw = JSON.parse(JSON.stringify(TokenContract.artifact)) as typeof TokenContract.artifact
    const allPublic = [
      ...raw.functions.filter(fn => fn.functionType === 'public'),
      ...(raw.nonDispatchPublicFunctions ?? []),
    ]
    raw.functions = [
      ...raw.functions.filter(fn => fn.functionType !== 'public'),
      ...allPublic,
    ]
    raw.nonDispatchPublicFunctions = []

    expect(artifactNeedsPublicFunctionLayoutRepair(raw)).toBe(true)

    const repaired = repairContractArtifact(raw)
    expect(artifactNeedsPublicFunctionLayoutRepair(repaired)).toBe(false)
    expect(repaired).toBe(TokenContract.artifact)
  })
})
