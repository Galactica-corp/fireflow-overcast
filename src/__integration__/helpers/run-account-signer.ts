/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext } from '@persistent-ai/fireflow-types'
import type { NetworkEnum } from '../../shared/network'
import type { AccountCredentials } from '../../utils/aztec-wallet'
import { makeAccountSignerHarness } from '../../nodes/account/__tests__/support/mock-aztec-account-vault'
import AztecAccountSignerNode from '../../nodes/account/account-signer.node'
import { INTEGRATION_EXECUTION_ID } from './integration-context'

export interface AccountSignerExecution {
  node: AztecAccountSignerNode
  context: ExecutionContext
  credentials: AccountCredentials
}

export async function executeAccountSignerNode(params: {
  id: string
  credentials: AccountCredentials
  address: string
  network?: NetworkEnum
  discoverNotesFrom?: string[]
  executionId?: string
}): Promise<AccountSignerExecution> {
  const harness = await makeAccountSignerHarness({
    credentials: params.credentials,
    address: params.address,
    network: params.network ?? 'Local',
    executionId: params.executionId ?? INTEGRATION_EXECUTION_ID,
  })

  const node = new AztecAccountSignerNode(params.id)
  node.initialize()
  node.account = harness.account
  node.discoverNotesFrom = params.discoverNotesFrom ?? []
  await node.execute(harness.context)
  return { node, context: harness.context, credentials: params.credentials }
}
