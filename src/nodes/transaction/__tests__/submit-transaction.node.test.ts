/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OvercastRuntime } from '../../runtime-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AztecTxRequestRef } from '../../../shared/schemas'
import { toSerializableTxReceipt } from '../../../utils/aztec-tx'
import { registerOvercastRuntime } from '../../runtime-registry'
import AztecSubmitTransactionNode from '../submit-transaction.node'

const mockResolveTxRequest = vi.fn()
const mockSubmitTransaction = vi.fn()

registerOvercastRuntime({
  resolveTxRequest: mockResolveTxRequest,
  submitTransaction: mockSubmitTransaction,
  toSerializableTxReceipt,
} as unknown as OvercastRuntime)

describe('aztecSubmitTransactionNode', () => {
  let node: AztecSubmitTransactionNode
  let mockContext: { startTime: Date, executionId: string }
  const liveTransaction = { interaction: { send: vi.fn() }, from: {}, method: 'transfer' }

  beforeEach(() => {
    node = new AztecSubmitTransactionNode('test-id')
    node.initialize()
    mockContext = { startTime: new Date(), executionId: 'submit-exec-1' }
    mockResolveTxRequest.mockReset()
    mockSubmitTransaction.mockReset()
    mockResolveTxRequest.mockResolvedValue(liveTransaction)
  })

  it('throws when transaction is missing', async () => {
    await expect(node.execute(mockContext as never)).rejects.toThrow('Transaction is required')
  })

  it('resolves then submits without waiting', async () => {
    mockSubmitTransaction.mockResolvedValue({ txHash: '0xabc' })
    const ref = new AztecTxRequestRef()
    ref.method = 'transfer'
    node.transaction = ref
    node.waitForConfirmation = false

    await node.execute(mockContext as never)

    expect(mockResolveTxRequest).toHaveBeenCalledWith(ref, mockContext)
    expect(mockSubmitTransaction).toHaveBeenCalledWith(liveTransaction, {
      witnesses: [],
      waitForConfirmation: false,
    })
    expect(node.txHash).toBe('0xabc')
    expect(node.receipt).toBeNull()
  })

  it('submits with witnesses and waits for confirmation', async () => {
    const receipt = { status: 'success', txHash: { toString: () => '0xdef' } }
    mockSubmitTransaction.mockResolvedValue({ txHash: '0xdef', receipt })
    const witnesses = [{ id: 1 }] as never[]
    const ref = new AztecTxRequestRef()
    node.transaction = ref
    node.witnesses = witnesses
    node.waitForConfirmation = true

    await node.execute(mockContext as never)

    expect(node.txHash).toBe('0xdef')
    expect(node.receipt).toEqual({
      txHash: '0xdef',
      status: 'success',
    })
    expect(mockSubmitTransaction).toHaveBeenCalledWith(liveTransaction, {
      witnesses,
      waitForConfirmation: true,
    })
  })
})
