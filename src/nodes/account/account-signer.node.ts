/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext, NodeExecutionResult } from '@persistent-ai/fireflow-types'
import type { SecretScope } from '../../shared/schemas'
import {
  BaseNode,
  Input,
  Node,
  Output,
  PortArrayString,
  PortObject,
  PortString,
  StringEnum,
} from '@persistent-ai/fireflow-types'
import {
  AztecAccountRef,
  AztecSignerRef,
  DEFAULT_SECRET_SCOPE,
  SECRET_SCOPE_OPTIONS,
} from '../../shared/schemas'

@Node({
  type: 'AztecAccountSignerNode',
  title: 'Aztec Account Signer',
  description: 'Assemble an AztecSignerRef from an AztecAccountRef and note-discovery senders',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'account', 'wallet', 'signer'],
  execution: { pure: true },
})
export default class AztecAccountSignerNode extends BaseNode {
  @Input()
  @PortObject({
    title: 'Account',
    description: 'Pointer coordinates + public address of the Aztec account to load',
    schema: AztecAccountRef,
    required: true,
  })
  account?: AztecAccountRef

  @Input()
  @StringEnum([...SECRET_SCOPE_OPTIONS], {
    title: 'Secret Scope',
    description: 'Which identity owns the vault secret behind the account pointer',
    defaultValue: DEFAULT_SECRET_SCOPE,
    options: SECRET_SCOPE_OPTIONS.map(opt => ({
      id: opt,
      type: 'string',
      defaultValue: opt,
      title: opt,
    })),
  })
  secretScope: SecretScope = DEFAULT_SECRET_SCOPE

  @Input()
  @PortArrayString({
    title: 'Discover Notes From',
    description: 'Sender addresses to register for private note discovery',
    defaultValue: [],
  })
  discoverNotesFrom: string[] = []

  @Output()
  @PortObject({
    title: 'Signer',
    description: 'Serializable signing context — consumers rehydrate the live wallet locally',
    schema: AztecSignerRef,
  })
  signer?: AztecSignerRef

  @Output()
  @PortString({
    title: 'Address',
    description: 'Public Aztec account address from the account ref',
  })
  address: string = ''

  async execute(_context: ExecutionContext): Promise<NodeExecutionResult> {
    if (!this.account) {
      throw new Error('Account is required')
    }

    const signer = new AztecSignerRef()
    signer.account = this.account
    signer.secretScope = this.secretScope
    signer.discoverNotesFrom = [...this.discoverNotesFrom]
    this.signer = signer
    this.address = this.account.address

    return {}
  }
}
