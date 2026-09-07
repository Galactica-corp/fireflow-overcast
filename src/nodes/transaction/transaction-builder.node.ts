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
  PortArrayObject,
  PortObject,
  PortString,
} from '@persistent-ai/fireflow-types'
import {
  AztecFeePayerRef,
  AztecSignerRef,
  AztecSmartContractRef,
  AztecTxRequestRef,
} from '../../shared/schemas'

@Node({
  type: 'AztecTransactionBuilderNode',
  title: 'Aztec Transaction Builder',
  description: 'Build a transaction calling a method on an Aztec smart contract',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'transaction'],
  execution: { pure: true },
})
export default class AztecTransactionBuilderNode extends BaseNode {
  @Input()
  @PortObject({
    title: 'Contract',
    description: 'Target smart contract coordinates',
    required: true,
    schema: AztecSmartContractRef,
  })
  contract?: AztecSmartContractRef

  @Input()
  @PortArrayObject(AztecSmartContractRef, {
    title: 'Sub Contracts',
    description: 'Additional contracts the primary call invokes (registered in the PXE before simulate/submit)',
    defaultValue: [],
  })
  subContracts: AztecSmartContractRef[] = []

  @Input()
  @PortObject({
    title: 'Signer',
    description: 'Account building / sending the transaction',
    required: true,
    schema: AztecSignerRef,
  })
  signer?: AztecSignerRef

  @Input()
  @PortString({
    title: 'Method',
    description: 'Name of the contract method to call',
    required: true,
    defaultValue: '',
  })
  method: string = ''

  @Input()
  @PortAny({
    title: 'Parameters',
    description: 'Ordered list of arguments for the method',
    defaultValue: [],
  })
  parameters: unknown[] = []

  @Input()
  @PortObject({
    title: 'Fee Payer',
    description: 'Who pays the transaction fee and how',
    schema: AztecFeePayerRef,
  })
  feePayer?: AztecFeePayerRef

  @Output()
  @PortObject({
    title: 'Transaction',
    description: 'Serializable transaction request ready for simulation or submission',
    schema: AztecTxRequestRef,
  })
  transaction?: AztecTxRequestRef

  async execute(_context: ExecutionContext): Promise<NodeExecutionResult> {
    if (!this.contract) {
      throw new Error('Contract is required')
    }
    if (!this.signer) {
      throw new Error('Signer is required')
    }
    if (!this.method) {
      throw new Error('Method is required')
    }

    const transaction = new AztecTxRequestRef()
    transaction.contract = this.contract
    transaction.subContracts = Array.isArray(this.subContracts) ? this.subContracts : []
    transaction.signer = this.signer
    transaction.method = this.method
    transaction.parameters = Array.isArray(this.parameters) ? this.parameters : []
    transaction.feePayer = this.feePayer
    this.transaction = transaction

    return {}
  }
}
