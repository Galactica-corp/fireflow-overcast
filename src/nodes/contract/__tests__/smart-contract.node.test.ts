/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OvercastRuntime } from '../../runtime-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AztecArtifactRef } from '../../../shared/schemas'
import { registerOvercastRuntime } from '../../runtime-registry'
import AztecSmartContractNode from '../smart-contract.node'

const mockCreateSmartContract = vi.fn()

registerOvercastRuntime({
  createSmartContract: mockCreateSmartContract,
} as unknown as OvercastRuntime)

describe('aztecSmartContractNode', () => {
  let node: AztecSmartContractNode
  let mockContext: { startTime: Date }

  beforeEach(() => {
    node = new AztecSmartContractNode('test-id')
    node.initialize()
    mockContext = { startTime: new Date() }
    mockCreateSmartContract.mockReset()
  })

  it('initializes with default values', () => {
    expect(node.address).toBe('')
    expect(node.network).toBe('Local')
    expect(node.artifact).toBeUndefined()
    expect(node.contract).toBeUndefined()
  })

  it('throws when artifact is missing', async () => {
    node.address = 'aztec1:contract'

    await expect(node.execute(mockContext as never)).rejects.toThrow('Artifact is required')
  })

  it('throws when address is missing', async () => {
    const artifact = new AztecArtifactRef()
    artifact.workspaceId = 'ws-1'
    artifact.branch = 'main'
    artifact.path = 'artifacts/Token.json'
    node.artifact = artifact

    await expect(node.execute(mockContext as never)).rejects.toThrow('Contract address is required')
  })

  it('assembles AztecSmartContractRef without loading the artifact', async () => {
    const artifact = new AztecArtifactRef()
    artifact.workspaceId = 'ws-1'
    artifact.branch = 'main'
    artifact.path = 'artifacts/Token.json'
    artifact.name = 'Token'

    node.address = 'aztec1:contract'
    node.network = 'Local'
    node.artifact = artifact

    await node.execute(mockContext as never)

    expect(mockCreateSmartContract).not.toHaveBeenCalled()
    expect(node.contract).toMatchObject({
      address: 'aztec1:contract',
      network: 'Local',
      artifact,
    })
  })
})
