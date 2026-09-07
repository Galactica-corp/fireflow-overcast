/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext, NodeExecutionResult } from '@persistent-ai/fireflow-types'
import type { X402PaymentContext, X402Response } from '../../shared/types'
import {
  BaseNode,
  Input,
  Node,
  Output,
  PortAny,
  PortObject,
  PortString,
} from '@persistent-ai/fireflow-types'
import { AztecSignerRef, AztecSmartContractRef, X402PaymentContextSchema, X402ResponseSchema } from '../../shared/schemas'
import { getOvercastRuntime } from '../runtime-registry'

@Node({
  type: 'ParseX402ChallengeNode',
  title: 'Parse x402 Challenge',
  description: 'Parse an x402 challenge and produce settlement method/parameters for the transaction builder',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'x402', 'payment'],
})
export default class ParseX402ChallengeNode extends BaseNode {
  @Input()
  @PortObject({
    title: 'x402 Response',
    description: 'The x402 challenge response from Request x402 Resource',
    required: true,
    schema: X402ResponseSchema,
  })
  x402Response: X402Response | null = null

  @Input()
  @PortObject({
    title: 'Signer',
    description: 'Paying account whose funds complete the partial note',
    required: true,
    schema: AztecSignerRef,
  })
  signer?: AztecSignerRef

  @Input()
  @PortObject({
    title: 'Contract',
    description: 'Token contract used for offchain_receive when an offchain message is present',
    schema: AztecSmartContractRef,
  })
  contract?: AztecSmartContractRef

  @Input()
  @PortString({
    title: 'Max Amount',
    description: 'Maximum allowed payment amount in token base units (required spend cap)',
    required: true,
    defaultValue: '',
  })
  maxAmount: string = ''

  @Input()
  @PortString({
    title: 'Expected Asset',
    description: 'When set, challenge asset must match this token contract address',
    defaultValue: '',
  })
  expectedAsset: string = ''

  @Input()
  @PortString({
    title: 'Expected Pay To',
    description: 'When set, challenge payTo must match this merchant recipient address',
    defaultValue: '',
  })
  expectedPayTo: string = ''

  @Output()
  @PortString({
    title: 'Method',
    description: 'Token-contract method to call to settle the payment',
  })
  method: string = ''

  @Output()
  @PortAny({
    title: 'Parameters',
    description: 'Parameters (the completed note) for the Aztec Transaction Builder',
    defaultValue: [],
  })
  parameters: unknown[] = []

  @Output()
  @PortObject({
    title: 'Payment Context',
    description: 'Payment context passed to Build x402 Payment Header',
    schema: X402PaymentContextSchema,
  })
  paymentContext: X402PaymentContext | null = null

  async execute(context: ExecutionContext): Promise<NodeExecutionResult> {
    if (!this.x402Response) {
      throw new Error('x402 response is required')
    }
    if (!this.signer) {
      throw new Error('Signer is required')
    }
    if (!this.maxAmount.trim()) {
      throw new Error('maxAmount is required')
    }

    const runtime = getOvercastRuntime()
    const signer = await runtime.resolveSigner(this.signer, context)
    const contract = this.contract
      ? await runtime.resolveContract(this.contract, context)
      : undefined

    const result = await runtime.parseChallenge({
      x402Response: this.x402Response,
      signer,
      contract,
      maxAmount: this.maxAmount,
      expectedAsset: this.expectedAsset.trim() || undefined,
      expectedPayTo: this.expectedPayTo.trim() || undefined,
    })

    this.method = result.method
    this.parameters = result.parameters
    this.paymentContext = result.paymentContext

    return {}
  }
}
