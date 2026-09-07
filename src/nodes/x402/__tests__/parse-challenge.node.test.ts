/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OvercastRuntime } from '../../runtime-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AztecAccountRef,
  AztecArtifactRef,
  AztecSignerRef,
  AztecSmartContractRef,
} from '../../../shared/schemas'
import { registerOvercastRuntime } from '../../runtime-registry'
import ParseX402ChallengeNode from '../parse-challenge.node'

const mockResolveSigner = vi.fn()
const mockResolveContract = vi.fn()
const mockParseChallenge = vi.fn()

registerOvercastRuntime({
  resolveSigner: mockResolveSigner,
  resolveContract: mockResolveContract,
  parseChallenge: mockParseChallenge,
} as unknown as OvercastRuntime)

function makeSignerRef(): AztecSignerRef {
  const account = new AztecAccountRef()
  account.workspaceId = 'ws-1'
  account.branch = 'main'
  account.pointerPath = 'secrets/a.ffsecret'
  account.address = 'aztec1:alice'
  account.network = 'Local'
  account.label = 'default'
  const signer = new AztecSignerRef()
  signer.account = account
  return signer
}

function makeContractRef(): AztecSmartContractRef {
  const artifact = new AztecArtifactRef()
  artifact.workspaceId = 'ws-1'
  artifact.branch = 'main'
  artifact.path = 'artifacts/Token.json'
  const contract = new AztecSmartContractRef()
  contract.address = 'aztec1:token'
  contract.network = 'Local'
  contract.artifact = artifact
  return contract
}

describe('parseX402ChallengeNode', () => {
  let node: ParseX402ChallengeNode
  let mockContext: { startTime: Date, executionId: string }
  const liveSigner = { address: {}, wallet: {} }
  const liveContract = { address: {}, artifact: {}, network: 'Local' }
  const mockResponse = {
    status: 402,
    headers: {},
    body: {},
    url: 'http://localhost:4402/api/resource',
    method: 'GET',
    challenge: { commitment: '0xabc' },
  }
  const mockResult = {
    method: 'transfer_private_to_commitment',
    parameters: [liveSigner.address, '0xabc', 100n, 0],
    paymentContext: {
      accepted: { scheme: 'exact' },
      x402Version: 2,
      senderAddress: 'aztec1:alice',
    },
  }

  beforeEach(() => {
    node = new ParseX402ChallengeNode('test-id')
    node.initialize()
    mockContext = { startTime: new Date(), executionId: 'x402-parse-1' }
    mockResolveSigner.mockReset()
    mockResolveContract.mockReset()
    mockParseChallenge.mockReset()
    mockResolveSigner.mockResolvedValue(liveSigner)
    mockResolveContract.mockResolvedValue(liveContract)
    mockParseChallenge.mockResolvedValue(mockResult)
  })

  it('throws when x402 response is missing', async () => {
    node.signer = makeSignerRef()

    await expect(node.execute(mockContext as never)).rejects.toThrow('x402 response is required')
  })

  it('throws when signer is missing', async () => {
    node.x402Response = mockResponse as never
    node.maxAmount = '1000'

    await expect(node.execute(mockContext as never)).rejects.toThrow('Signer is required')
  })

  it('throws when maxAmount is missing', async () => {
    node.x402Response = mockResponse as never
    node.signer = makeSignerRef()

    await expect(node.execute(mockContext as never)).rejects.toThrow('maxAmount is required')
  })

  it('resolves refs then parses the challenge', async () => {
    const signerRef = makeSignerRef()
    const contractRef = makeContractRef()
    node.x402Response = mockResponse as never
    node.signer = signerRef
    node.contract = contractRef
    node.maxAmount = '1000'
    node.expectedAsset = '0xtoken'
    node.expectedPayTo = '0xmerchant'

    await node.execute(mockContext as never)

    expect(mockResolveSigner).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({
          workspaceId: 'ws-1',
          address: 'aztec1:alice',
        }),
      }),
      mockContext,
    )
    expect(mockResolveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'aztec1:token',
        artifact: expect.objectContaining({ path: 'artifacts/Token.json' }),
      }),
      mockContext,
    )
    expect(mockParseChallenge).toHaveBeenCalledWith({
      x402Response: mockResponse,
      signer: liveSigner,
      contract: liveContract,
      maxAmount: '1000',
      expectedAsset: '0xtoken',
      expectedPayTo: '0xmerchant',
    })
    expect(node.method).toBe('transfer_private_to_commitment')
    expect(node.parameters).toStrictEqual(mockResult.parameters)
    expect(node.paymentContext).toStrictEqual(mockResult.paymentContext)
  })
})
