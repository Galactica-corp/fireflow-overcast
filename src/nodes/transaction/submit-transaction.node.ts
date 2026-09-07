/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AuthWitness } from '@aztec/stdlib/auth-witness'
import type { ExecutionContext, NodeExecutionResult } from '@persistent-ai/fireflow-types'
import type { SerializableTxReceipt } from '../../utils/aztec-tx'
import {
  BaseNode,
  Input,
  Node,
  Output,
  PortAny,
  PortBoolean,
  PortObject,
  PortString,
} from '@persistent-ai/fireflow-types'
import { AztecTxReceiptSchema, AztecTxRequestRef } from '../../shared/schemas'
import { getOvercastRuntime } from '../runtime-registry'

@Node({
  type: 'AztecSubmitTransactionNode',
  title: 'Submit Aztec Transaction',
  description: 'Submit a prepared Aztec transaction to the network with optional authorization witnesses',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'transaction', 'submit'],
})
export default class AztecSubmitTransactionNode extends BaseNode {
  @Input()
  @PortObject({
    title: 'Transaction',
    description: 'Transaction request to submit',
    required: true,
    schema: AztecTxRequestRef,
  })
  transaction?: AztecTxRequestRef

  @Input()
  @PortAny({
    title: 'Witnesses',
    description: 'Authorization witnesses required by the transaction',
    defaultValue: [],
  })
  witnesses: AuthWitness[] = []

  @Input()
  @PortBoolean({
    title: 'Wait For Confirmation',
    description: 'Whether to wait for the transaction to be confirmed before completing',
    defaultValue: false,
  })
  waitForConfirmation: boolean = false

  @Output()
  @PortString({
    title: 'Tx Hash',
    description: 'Submitted transaction hash',
  })
  txHash: string = ''

  @Output()
  @PortObject({
    title: 'Receipt',
    description: 'Confirmation status / receipt (when waiting for confirmation)',
    schema: AztecTxReceiptSchema,
  })
  // Matches BuildX402PaymentHeaderNode input. Port values are JSON-serialized
  // across edges, so the SDK TxReceipt (with method guards) cannot survive.
  receipt: SerializableTxReceipt | null = null

  async execute(context: ExecutionContext): Promise<NodeExecutionResult> {
    if (!this.transaction) {
      throw new Error('Transaction is required')
    }

    const runtime = getOvercastRuntime()
    const live = await runtime.resolveTxRequest(this.transaction, context)
    const witnesses = Array.isArray(this.witnesses) ? this.witnesses : []
    const { txHash, receipt } = await runtime.submitTransaction(live, {
      witnesses,
      waitForConfirmation: this.waitForConfirmation,
    })

    this.txHash = txHash
    this.receipt = receipt ? runtime.toSerializableTxReceipt(receipt) : null

    return {}
  }
}
