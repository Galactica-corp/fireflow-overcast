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
  AztecFeePayerRef,
  AztecSignerRef,
  AztecSmartContractRef,
} from '../../../shared/schemas'
import { registerOvercastRuntime } from '../../runtime-registry'
import AztecTransactionBuilderNode from '../transaction-builder.node'

const mockBuildTransaction = vi.fn()

registerOvercastRuntime({
  buildTransaction: mockBuildTransaction,
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

function makeContractRef(address = 'aztec1:contract'): AztecSmartContractRef {
  const artifact = new AztecArtifactRef()
  artifact.workspaceId = 'ws-1'
  artifact.branch = 'main'
  artifact.path = 'artifacts/Token.json'
  const contract = new AztecSmartContractRef()
  contract.address = address
  contract.network = 'Local'
  contract.artifact = artifact
  return contract
}

describe('aztecTransactionBuilderNode', () => {
  let node: AztecTransactionBuilderNode
  let mockContext: { startTime: Date }

  beforeEach(() => {
    node = new AztecTransactionBuilderNode('test-id')
    node.initialize()
    mockContext = { startTime: new Date() }
    mockBuildTransaction.mockReset()
  })

  it('throws when contract is missing', async () => {
    node.signer = makeSignerRef()
    node.method = 'balance_of_private'

    await expect(node.execute(mockContext as never)).rejects.toThrow('Contract is required')
  })

  it('throws when signer is missing', async () => {
    node.contract = makeContractRef()
    node.method = 'balance_of_private'

    await expect(node.execute(mockContext as never)).rejects.toThrow('Signer is required')
  })

  it('throws when method is missing', async () => {
    node.contract = makeContractRef()
    node.signer = makeSignerRef()

    await expect(node.execute(mockContext as never)).rejects.toThrow('Method is required')
  })

  it('assembles AztecTxRequestRef without buildTransaction', async () => {
    const feePayer = new AztecFeePayerRef()
    feePayer.method = 'FeeJuice'
    node.contract = makeContractRef()
    node.signer = makeSignerRef()
    node.method = 'balance_of_private'
    node.parameters = ['aztec1:alice']
    node.feePayer = feePayer

    await node.execute(mockContext as never)

    expect(mockBuildTransaction).not.toHaveBeenCalled()
    expect(node.transaction).toMatchObject({
      contract: node.contract,
      signer: node.signer,
      method: 'balance_of_private',
      parameters: ['aztec1:alice'],
      feePayer,
      subContracts: [],
    })
  })

  it('forwards subContracts onto the request ref', async () => {
    const sub = makeContractRef('aztec1:token')
    node.contract = makeContractRef()
    node.signer = makeSignerRef()
    node.method = 'drip_to_private'
    node.parameters = ['aztec1:token', 10]
    node.subContracts = [sub]

    await node.execute(mockContext as never)

    expect(mockBuildTransaction).not.toHaveBeenCalled()
    expect(node.transaction?.subContracts).toEqual([sub])
  })
})
