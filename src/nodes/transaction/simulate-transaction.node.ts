/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext, NodeExecutionResult } from '@persistent-ai/fireflow-types'
import {
  BaseNode,
  Input,
  Node,
  Output,
  PortAny,
  PortObject,
} from '@persistent-ai/fireflow-types'
import { AztecTxRequestRef } from '../../shared/schemas'
import { getOvercastRuntime } from '../runtime-registry'

@Node({
  type: 'AztecSimulateTransactionNode',
  title: 'Simulate Transaction',
  description: 'Simulate a prepared transaction locally via the PXE without submitting on-chain',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'transaction', 'simulate', 'read'],
})
export default class AztecSimulateTransactionNode extends BaseNode {
  @Input()
  @PortObject({
    title: 'Transaction',
    description: 'Transaction request from the Aztec Transaction Builder',
    required: true,
    schema: AztecTxRequestRef,
  })
  transaction?: AztecTxRequestRef

  @Output()
  @PortAny({
    title: 'Result',
    description: 'Value(s) returned by the simulated smart contract method',
  })
  result: unknown = null

  async execute(context: ExecutionContext): Promise<NodeExecutionResult> {
    if (!this.transaction) {
      throw new Error('Transaction is required')
    }

    const runtime = getOvercastRuntime()
    const live = await runtime.resolveTxRequest(this.transaction, context)
    this.result = await runtime.simulateTransaction(live)

    return {}
  }
}
