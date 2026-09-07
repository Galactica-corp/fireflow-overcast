/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext, NodeExecutionResult } from '@persistent-ai/fireflow-types'
import type { NetworkEnum } from '../../shared/types'
import {
  BaseNode,
  Input,
  Node,
  Output,
  PortObject,
  PortString,
  StringEnum,
} from '@persistent-ai/fireflow-types'
import { DEFAULT_NETWORK, NETWORK_OPTIONS } from '../../shared/network'
import { AztecArtifactRef, AztecSmartContractRef } from '../../shared/schemas'

@Node({
  type: 'AztecSmartContractNode',
  title: 'Aztec Smart Contract',
  description: 'Represent a deployed Aztec smart contract by binding its address, network, and artifact',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'contract'],
  execution: { pure: true },
})
export default class AztecSmartContractNode extends BaseNode {
  @Input()
  @PortString({
    title: 'Address',
    description: 'Deployed contract address',
    required: true,
    defaultValue: '',
  })
  address: string = ''

  @Input()
  @StringEnum([...NETWORK_OPTIONS], {
    title: 'Network',
    description: 'Target Aztec network',
    defaultValue: DEFAULT_NETWORK,
    options: NETWORK_OPTIONS.map(opt => ({
      id: opt,
      type: 'string',
      defaultValue: opt,
      title: opt,
    })),
  })
  network: NetworkEnum = DEFAULT_NETWORK

  @Input()
  @PortObject({
    title: 'Artifact',
    description: 'VFS coordinates of the contract artifact JSON file',
    schema: AztecArtifactRef,
    required: true,
  })
  artifact?: AztecArtifactRef

  @Output()
  @PortObject({
    title: 'Contract',
    description: 'Serializable smart-contract coordinates',
    schema: AztecSmartContractRef,
  })
  contract?: AztecSmartContractRef

  async execute(_context: ExecutionContext): Promise<NodeExecutionResult> {
    if (!this.artifact) {
      throw new Error('Artifact is required')
    }
    if (!this.address.trim()) {
      throw new Error('Contract address is required')
    }

    const contract = new AztecSmartContractRef()
    contract.address = this.address
    contract.network = this.network
    contract.artifact = this.artifact
    this.contract = contract

    return {}
  }
}
