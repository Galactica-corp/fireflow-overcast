/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext, NodeExecutionResult } from '@persistent-ai/fireflow-types'
import type { FeePaymentMethodEnum } from '../../shared/types'
import {
  BaseNode,
  Input,
  Node,
  Output,
  PortObject,
  PortString,
  PortVisibility,
  StringEnum,
} from '@persistent-ai/fireflow-types'
import { DEFAULT_FEE_PAYMENT_METHOD, FEE_PAYMENT_METHOD_OPTIONS } from '../../shared/fee'
import { AztecFeePayerRef } from '../../shared/schemas'

@Node({
  type: 'AztecGetFeePayerNode',
  title: 'Get Fee Payer',
  description: 'Define who pays the transaction fee and how (native fee juice or sponsored FPC)',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'fee'],
  execution: { pure: true },
})
export default class AztecGetFeePayerNode extends BaseNode {
  @Input()
  @StringEnum([...FEE_PAYMENT_METHOD_OPTIONS], {
    title: 'Method',
    description: 'How transaction fees are paid',
    defaultValue: DEFAULT_FEE_PAYMENT_METHOD,
    options: FEE_PAYMENT_METHOD_OPTIONS.map(opt => ({
      id: opt,
      type: 'string',
      defaultValue: opt,
      title: opt,
    })),
  })
  method: FeePaymentMethodEnum = DEFAULT_FEE_PAYMENT_METHOD

  @Input()
  @PortVisibility({
    showIf: node => (node as AztecGetFeePayerNode).method === 'SponsoredFPC',
  })
  @PortString({
    title: 'FPC Address',
    description: 'Fee-paying contract address when using SponsoredFPC',
    defaultValue: '',
  })
  fpcAddress: string = ''

  @Output()
  @PortObject({
    title: 'Fee Payer',
    description: 'Serializable fee strategy for transaction building / submission',
    schema: AztecFeePayerRef,
  })
  feePayer?: AztecFeePayerRef

  async execute(_context: ExecutionContext): Promise<NodeExecutionResult> {
    if (this.method === 'SponsoredFPC' && !this.fpcAddress.trim()) {
      throw new Error('FPC address is required for SponsoredFPC fee payment')
    }

    const feePayer = new AztecFeePayerRef()
    feePayer.method = this.method
    feePayer.fpcAddress = this.fpcAddress
    this.feePayer = feePayer

    return {}
  }
}
