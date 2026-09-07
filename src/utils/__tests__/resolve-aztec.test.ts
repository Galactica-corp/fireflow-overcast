/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext, IExecutionServices, IVFSContextService } from '@persistent-ai/fireflow-types'
import type { OvercastRuntime } from '../../nodes/runtime-registry'
import { ExecutionContext as ExecutionContextClass, ObjectPort, resolveObjectSchema } from '@persistent-ai/fireflow-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAccountSignerHarness } from '../../nodes/account/__tests__/support/mock-aztec-account-vault'
import { registerOvercastRuntime } from '../../nodes/runtime-registry'
import {
  AztecAccountRef,
  AztecArtifactRef,
  AztecFeePayerRef,
  AztecSignerRef,
  AztecSmartContractRef,
  AztecTxRequestRef,
} from '../../shared/schemas'
import {
  cachedExecutionCount,
  clearAztecObjectCaches,
  primeSignerCache,
  resolveArtifact,
  resolveSigner,
  resolveTxRequest,
} from '../resolve-aztec'

const mockCreateSigner = vi.fn()
const mockRepairContractArtifact = vi.fn((artifact: unknown) => artifact)
const mockCreateSmartContract = vi.fn()
const mockCreateFeePayer = vi.fn()
const mockBuildTransaction = vi.fn()
const mockEnsureSponsoredFpcRegistered = vi.fn()

registerOvercastRuntime({
  createSigner: mockCreateSigner,
  repairContractArtifact: mockRepairContractArtifact,
  createSmartContract: mockCreateSmartContract,
  createFeePayer: mockCreateFeePayer,
  buildTransaction: mockBuildTransaction,
  ensureSponsoredFpcRegistered: mockEnsureSponsoredFpcRegistered,
  resolveArtifact,
  resolveSigner,
  resolveTxRequest,
} as unknown as OvercastRuntime)

const CREDENTIALS = {
  secret: '0x0a',
  salt: '0x0b',
  signingKey: '0x0c',
}

const SENDER = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

function makeExecutionContext(
  services: IExecutionServices,
  executionId: string,
  callerId = 'USR_caller',
): ExecutionContext {
  return new ExecutionContextClass(
    'resolve-aztec-test',
    new AbortController(),
    undefined,
    executionId,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    services,
    undefined,
    callerId,
    callerId,
  )
}

describe('resolve-aztec caches', () => {
  beforeEach(() => {
    clearAztecObjectCaches()
    mockCreateSigner.mockReset()
    mockRepairContractArtifact.mockClear()
    mockCreateSmartContract.mockReset()
    mockCreateFeePayer.mockReset()
    mockBuildTransaction.mockReset()
    mockEnsureSponsoredFpcRegistered.mockReset()
  })

  afterEach(() => {
    clearAztecObjectCaches()
  })

  it('shares one Signer instance within an executionId and coalesces parallel resolves', async () => {
    const harness = await makeAccountSignerHarness({
      credentials: CREDENTIALS,
      address: 'aztec1:alice',
    })
    const liveSigner = {
      wallet: { registerSender: vi.fn().mockResolvedValue(undefined) },
      account: {},
      address: { toString: () => 'aztec1:alice' },
      nodeUrl: 'http://localhost:8080',
    }
    mockCreateSigner.mockResolvedValue(liveSigner)

    const ref = new AztecSignerRef()
    ref.account = harness.account
    ref.discoverNotesFrom = []

    const context = makeExecutionContext(
      harness.context.services as IExecutionServices,
      'exec-cache-hit',
    )

    const [a, b] = await Promise.all([
      resolveSigner(ref, context),
      resolveSigner(ref, context),
    ])

    expect(a).toBe(liveSigner)
    expect(b).toBe(liveSigner)
    expect(mockCreateSigner).toHaveBeenCalledTimes(1)
  })

  it('rehydrates after clearAztecObjectCaches (recovery / fresh-worker stand-in)', async () => {
    const harness = await makeAccountSignerHarness({
      credentials: CREDENTIALS,
      address: 'aztec1:alice',
    })
    mockCreateSigner
      .mockResolvedValueOnce({
        wallet: { registerSender: vi.fn() },
        account: {},
        address: { toString: () => 'aztec1:alice' },
        nodeUrl: 'http://a',
      })
      .mockResolvedValueOnce({
        wallet: { registerSender: vi.fn() },
        account: {},
        address: { toString: () => 'aztec1:alice' },
        nodeUrl: 'http://b',
      })

    const ref = new AztecSignerRef()
    ref.account = harness.account

    const context = makeExecutionContext(
      harness.context.services as IExecutionServices,
      'exec-recovery',
    )

    const first = await resolveSigner(ref, context)
    clearAztecObjectCaches()
    const second = await resolveSigner(ref, context)

    expect(mockCreateSigner).toHaveBeenCalledTimes(2)
    expect(second).not.toBe(first)
    expect(second.nodeUrl).toBe('http://b')
  })

  it('does not stick a rejected hydrate in the cache', async () => {
    const harness = await makeAccountSignerHarness({
      credentials: CREDENTIALS,
      address: 'aztec1:alice',
    })
    mockCreateSigner
      .mockRejectedValueOnce(new Error('pxe down'))
      .mockResolvedValueOnce({
        wallet: { registerSender: vi.fn() },
        account: {},
        address: { toString: () => 'aztec1:alice' },
        nodeUrl: 'http://ok',
      })

    const ref = new AztecSignerRef()
    ref.account = harness.account
    const context = makeExecutionContext(
      harness.context.services as IExecutionServices,
      'exec-fail',
    )

    await expect(resolveSigner(ref, context)).rejects.toThrow('pxe down')
    const recovered = await resolveSigner(ref, context)
    expect(recovered.nodeUrl).toBe('http://ok')
    expect(mockCreateSigner).toHaveBeenCalledTimes(2)
  })

  it('registers additional discoverNotesFrom senders on a cache hit', async () => {
    const harness = await makeAccountSignerHarness({
      credentials: CREDENTIALS,
      address: 'aztec1:alice',
    })
    const registerSender = vi.fn().mockResolvedValue(undefined)
    mockCreateSigner.mockResolvedValue({
      wallet: { registerSender },
      account: {},
      address: { toString: () => 'aztec1:alice' },
      nodeUrl: 'http://localhost:8080',
    })

    const refA = new AztecSignerRef()
    refA.account = harness.account
    refA.discoverNotesFrom = []

    const refB = new AztecSignerRef()
    refB.account = harness.account
    refB.discoverNotesFrom = [SENDER]

    const context = makeExecutionContext(
      harness.context.services as IExecutionServices,
      'exec-senders',
    )

    await resolveSigner(refA, context)
    await resolveSigner(refB, context)

    expect(mockCreateSigner).toHaveBeenCalledTimes(1)
    expect(registerSender).toHaveBeenCalledTimes(1)
  })

  it('reads an artifact from VFS once per execution', async () => {
    const readFile = vi.fn().mockResolvedValue(JSON.stringify({ name: 'Token', functions: [] }))
    const vfs = { readFile } as unknown as IVFSContextService
    const context = makeExecutionContext({ vfs } as IExecutionServices, 'exec-artifact')

    const ref = new AztecArtifactRef()
    ref.workspaceId = 'ws-1'
    ref.branch = 'main'
    ref.path = 'artifacts/Token.json'

    const a = await resolveArtifact(ref, context)
    const b = await resolveArtifact(ref, context)

    expect(a).toBe(b)
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(mockRepairContractArtifact).toHaveBeenCalledTimes(1)
  })

  it('preserves nested AztecSignerRef.account fields through ObjectPort.setValue', () => {
    const account = new AztecAccountRef()
    account.workspaceId = 'ws-1'
    account.branch = 'main'
    account.pointerPath = 'secrets/aztec-account.Local.default.ffsecret'
    account.address = '0xabc'
    account.network = 'Local'
    account.label = 'default'

    const signer = new AztecSignerRef()
    signer.account = account
    signer.secretScope = 'caller'
    signer.discoverNotesFrom = []

    const port = new ObjectPort({
      type: 'object',
      key: 'signer',
      schema: resolveObjectSchema(AztecSignerRef),
    })
    port.setValue(signer as never)

    const value = port.getValue() as AztecSignerRef
    expect(value.account?.workspaceId).toBe('ws-1')
    expect(value.account?.pointerPath).toBe('secrets/aztec-account.Local.default.ffsecret')
    expect(value.account?.address).toBe('0xabc')
    expect(value.account?.network).toBe('Local')
  })

  it('resolveTxRequest accepts bigint parameters in the cache key', async () => {
    const harness = await makeAccountSignerHarness({
      credentials: CREDENTIALS,
      address: 'aztec1:alice',
    })
    mockCreateSmartContract.mockReturnValue({
      address: { toString: () => 'aztec1:token' },
      artifact: { name: 'Token' },
      network: 'Local',
    })
    mockCreateFeePayer.mockReturnValue({ method: 'fee_juice', paymentMethod: undefined })
    const liveTx = { interaction: {}, from: {}, method: 'transfer_private_to_private' }
    mockBuildTransaction.mockResolvedValue(liveTx)

    harness.files.set('artifacts/Token.json', JSON.stringify({ name: 'Token', functions: [] }))
    const context = makeExecutionContext(
      harness.context.services as IExecutionServices,
      'exec-bigint-tx',
    )

    const artifact = new AztecArtifactRef()
    artifact.workspaceId = 'ws-1'
    artifact.branch = 'main'
    artifact.path = 'artifacts/Token.json'

    const contract = new AztecSmartContractRef()
    contract.address = 'aztec1:token'
    contract.network = 'Local'
    contract.artifact = artifact

    const signer = new AztecSignerRef()
    signer.account = harness.account
    primeSignerCache('exec-bigint-tx', signer, {
      wallet: { registerSender: vi.fn() },
      account: {},
      address: { toString: () => 'aztec1:alice' },
      nodeUrl: 'http://localhost:8080',
    } as never)

    const feePayer = new AztecFeePayerRef()
    feePayer.method = 'FeeJuice'

    const tx = new AztecTxRequestRef()
    tx.signer = signer
    tx.contract = contract
    tx.method = 'transfer_private_to_private'
    tx.parameters = ['aztec1:alice', 'aztec1:bob', 250n, 0]
    tx.feePayer = feePayer

    await expect(resolveTxRequest(tx, context)).resolves.toBe(liveTx)
    expect(mockBuildTransaction).toHaveBeenCalledTimes(1)
  })

  it('evicts least-recently-used executions beyond the cap instead of growing forever', async () => {
    // Execution ids never recur, so without eviction every execution that
    // touches Aztec parks a live wallet/PXE in the worker permanently.
    const harness = await makeAccountSignerHarness({
      credentials: CREDENTIALS,
      address: 'aztec1:alice',
    })
    const liveSigner = {
      wallet: { registerSender: vi.fn().mockResolvedValue(undefined) },
      account: {},
      address: { toString: () => 'aztec1:alice' },
      nodeUrl: 'http://localhost:8080',
    }
    mockCreateSigner.mockResolvedValue(liveSigner)

    const ref = new AztecSignerRef()
    ref.account = harness.account
    ref.discoverNotesFrom = []
    const services = harness.context.services as IExecutionServices

    const total = 40
    for (let i = 0; i < total; i++) {
      await resolveSigner(ref, makeExecutionContext(services, `exec-evict-${i}`))
    }
    expect(mockCreateSigner).toHaveBeenCalledTimes(total)
    expect(cachedExecutionCount()).toBeLessThanOrEqual(32)

    // The oldest execution was evicted — resolving under it creates afresh…
    mockCreateSigner.mockClear()
    await resolveSigner(ref, makeExecutionContext(services, 'exec-evict-0'))
    expect(mockCreateSigner).toHaveBeenCalledTimes(1)

    // …while a recent one still serves from cache.
    mockCreateSigner.mockClear()
    await resolveSigner(ref, makeExecutionContext(services, `exec-evict-${total - 1}`))
    expect(mockCreateSigner).not.toHaveBeenCalled()
  })
})
