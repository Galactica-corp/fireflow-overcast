/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OvercastRuntime } from '../../runtime-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerOvercastRuntime } from '../../runtime-registry'
import AztecGetFeePayerNode from '../get-fee-payer.node'

const mockCreateFeePayer = vi.fn()
const mockEnsureSponsoredFpcRegistered = vi.fn()

registerOvercastRuntime({
  createFeePayer: mockCreateFeePayer,
  ensureSponsoredFpcRegistered: mockEnsureSponsoredFpcRegistered,
} as unknown as OvercastRuntime)

describe('aztecGetFeePayerNode', () => {
  let node: AztecGetFeePayerNode
  let mockContext: { startTime: Date }

  beforeEach(() => {
    node = new AztecGetFeePayerNode('test-id')
    node.initialize()
    mockContext = { startTime: new Date() }
    mockCreateFeePayer.mockReset()
    mockEnsureSponsoredFpcRegistered.mockReset()
  })

  it('initializes with default values', () => {
    expect(node.method).toBe('FeeJuice')
    expect(node.fpcAddress).toBe('')
    expect(node.feePayer).toBeUndefined()
    expect(node.findPortByKey('signer')).toBeUndefined()
  })

  it('assembles fee-juice FeePayerRef without SDK calls', async () => {
    node.method = 'FeeJuice'

    await node.execute(mockContext as never)

    expect(node.feePayer?.method).toBe('FeeJuice')
    expect(node.feePayer?.fpcAddress).toBe('')
    expect(mockCreateFeePayer).not.toHaveBeenCalled()
    expect(mockEnsureSponsoredFpcRegistered).not.toHaveBeenCalled()
  })

  it('assembles sponsored FPC FeePayerRef without registering FPC', async () => {
    node.method = 'SponsoredFPC'
    node.fpcAddress = 'aztec1:fpc'

    await node.execute(mockContext as never)

    expect(node.feePayer?.method).toBe('SponsoredFPC')
    expect(node.feePayer?.fpcAddress).toBe('aztec1:fpc')
    expect(mockCreateFeePayer).not.toHaveBeenCalled()
    expect(mockEnsureSponsoredFpcRegistered).not.toHaveBeenCalled()
  })

  it('throws when SponsoredFPC is missing fpcAddress', async () => {
    node.method = 'SponsoredFPC'
    node.fpcAddress = '  '

    await expect(node.execute(mockContext as never)).rejects.toThrow(
      'FPC address is required for SponsoredFPC fee payment',
    )
  })
})
