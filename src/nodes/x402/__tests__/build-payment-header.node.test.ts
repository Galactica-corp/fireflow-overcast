/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OvercastRuntime } from '../../runtime-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerOvercastRuntime } from '../../runtime-registry'
import BuildX402PaymentHeaderNode from '../build-payment-header.node'

const mockBuildPaymentHeader = vi.fn()

// The node resolves its Aztec runtime through the registry (filled by the
// /server entry in production); tests register mocks in its place.
registerOvercastRuntime({
  buildPaymentHeader: mockBuildPaymentHeader,
} as unknown as OvercastRuntime)

describe('buildX402PaymentHeaderNode', () => {
  let node: BuildX402PaymentHeaderNode
  let mockContext: any
  const mockPaymentContext = {
    accepted: { scheme: 'exact' },
    x402Version: 2,
    senderAddress: 'aztec1:alice',
  } as any
  const mockHeader = {
    name: 'PAYMENT-SIGNATURE',
    value: 'encoded-payload',
  }

  beforeEach(() => {
    node = new BuildX402PaymentHeaderNode('test-id')
    node.initialize()
    mockContext = { startTime: new Date() }
    mockBuildPaymentHeader.mockReset()
    mockBuildPaymentHeader.mockReturnValue(mockHeader)
  })

  it('throws when tx hash is missing', async () => {
    node.paymentContext = mockPaymentContext

    await expect(node.execute(mockContext)).rejects.toThrow('Transaction hash is required')
  })

  it('throws when payment context is missing', async () => {
    node.txHash = '0xtxhash'

    await expect(node.execute(mockContext)).rejects.toThrow('Payment context is required')
  })

  it('refuses to build a header for a reverted settlement', async () => {
    node.txHash = '0xtxhash'
    node.paymentContext = mockPaymentContext
    node.receipt = { status: 'app_logic_reverted' } as any

    await expect(node.execute(mockContext)).rejects.toThrow(/did not succeed.*app_logic_reverted/)
    expect(mockBuildPaymentHeader).not.toHaveBeenCalled()
  })

  it('refuses to build a header for a dropped settlement', async () => {
    node.txHash = '0xtxhash'
    node.paymentContext = mockPaymentContext
    node.receipt = { status: 'dropped' } as any

    await expect(node.execute(mockContext)).rejects.toThrow(/did not succeed/)
  })

  it('builds a header without a receipt (no-wait submit) and for a pending receipt', async () => {
    node.txHash = '0xtxhash'
    node.paymentContext = mockPaymentContext
    node.receipt = null

    await node.execute(mockContext)
    expect(node.paymentHeader).toStrictEqual(mockHeader)

    node.receipt = { status: 'pending' } as any
    await node.execute(mockContext)
    expect(mockBuildPaymentHeader).toHaveBeenCalledTimes(2)
  })

  it('builds payment header from tx hash and payment context', async () => {
    node.txHash = '0xtxhash'
    node.paymentContext = mockPaymentContext
    node.receipt = { status: 'success' } as any

    await node.execute(mockContext)

    expect(node.paymentHeader).toStrictEqual(mockHeader)
    expect(mockBuildPaymentHeader).toHaveBeenCalledWith({
      txHash: '0xtxhash',
      paymentContext: mockPaymentContext,
    })
  })
})
