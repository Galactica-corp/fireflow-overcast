/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext, NodeExecutionResult } from '@persistent-ai/fireflow-types'
import type { Header, X402PaymentContext } from '../../shared/types'
import type { SerializableTxReceipt } from '../../utils/aztec-tx'
import {
  BaseNode,
  Input,
  Node,
  Output,
  PortObject,
  PortString,
} from '@persistent-ai/fireflow-types'
import { AztecTxReceiptSchema, HttpHeaderSchema, X402PaymentContextSchema } from '../../shared/schemas'
import { getOvercastRuntime } from '../runtime-registry'

@Node({
  type: 'BuildX402PaymentHeaderNode',
  title: 'Build x402 Payment Header',
  description: 'Transform a submitted settlement transaction into the x402 payment header expected by the merchant',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'x402', 'payment'],
})
export default class BuildX402PaymentHeaderNode extends BaseNode {
  @Input()
  @PortString({
    title: 'Tx Hash',
    description: 'Hash of the submitted settlement transaction',
    required: true,
    defaultValue: '',
  })
  txHash: string = ''

  @Input()
  @PortObject({
    title: 'Receipt',
    description: 'Confirmation receipt of the settlement transaction',
    schema: AztecTxReceiptSchema,
  })
  // Matches what Submit Transaction emits. Port values are JSON-serialized across
  // edges, so the SDK's TxReceipt class union — whose isMined()/isPending()
  // guards are methods — can never survive the trip.
  receipt: SerializableTxReceipt | null = null

  @Input()
  @PortObject({
    title: 'Payment Context',
    description: 'Payment context from Parse x402 Challenge',
    required: true,
    schema: X402PaymentContextSchema,
  })
  paymentContext: X402PaymentContext | null = null

  @Output()
  @PortObject({
    title: 'Payment Header',
    description: 'x402 payment header to pass to Request x402 Resource on the second request',
    schema: HttpHeaderSchema,
  })
  paymentHeader: Header | null = null

  async execute(_context: ExecutionContext): Promise<NodeExecutionResult> {
    if (!this.txHash) {
      throw new Error('Transaction hash is required')
    }
    if (!this.paymentContext) {
      throw new Error('Payment context is required')
    }

    // Submit emits a receipt only when it waited for confirmation. A settlement
    // that reverted or was dropped never paid the merchant — sending a header
    // for it invites a rejected (or disputed) second request. `pending` is
    // allowed: a no-wait flow legitimately builds the header before mining.
    const status = this.receipt?.status?.toLowerCase()
    if (status && status !== 'success' && status !== 'pending') {
      throw new Error(
        `Settlement transaction ${this.txHash} did not succeed (receipt status: ${this.receipt!.status}) — refusing to build a payment header for an unsettled payment`,
      )
    }

    this.paymentHeader = getOvercastRuntime().buildPaymentHeader({
      txHash: this.txHash,
      paymentContext: this.paymentContext,
    })

    return {}
  }
}
