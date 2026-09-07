/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OvercastRuntime } from '../../runtime-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AztecTxRequestRef } from '../../../shared/schemas'
import { registerOvercastRuntime } from '../../runtime-registry'
import AztecSimulateTransactionNode from '../simulate-transaction.node'

const mockResolveTxRequest = vi.fn()
const mockSimulateTransaction = vi.fn()

registerOvercastRuntime({
  resolveTxRequest: mockResolveTxRequest,
  simulateTransaction: mockSimulateTransaction,
} as unknown as OvercastRuntime)

describe('aztecSimulateTransactionNode', () => {
  let node: AztecSimulateTransactionNode
  let mockContext: { startTime: Date, executionId: string }
  const liveTransaction = { interaction: { simulate: vi.fn() }, from: {}, method: 'balance_of_private' }

  beforeEach(() => {
    node = new AztecSimulateTransactionNode('test-id')
    node.initialize()
    mockContext = { startTime: new Date(), executionId: 'sim-exec-1' }
    mockResolveTxRequest.mockReset()
    mockSimulateTransaction.mockReset()
    mockResolveTxRequest.mockResolvedValue(liveTransaction)
    mockSimulateTransaction.mockResolvedValue('1000')
  })

  it('throws when transaction is missing', async () => {
    await expect(node.execute(mockContext as never)).rejects.toThrow('Transaction is required')
  })

  it('resolves the tx request then simulates', async () => {
    const ref = new AztecTxRequestRef()
    ref.method = 'balance_of_private'
    node.transaction = ref

    await node.execute(mockContext as never)

    expect(mockResolveTxRequest).toHaveBeenCalledWith(ref, mockContext)
    expect(mockSimulateTransaction).toHaveBeenCalledWith(liveTransaction)
    expect(node.result).toBe('1000')
  })
})
