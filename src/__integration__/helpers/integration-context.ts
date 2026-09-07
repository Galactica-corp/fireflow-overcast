/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContractArtifact } from '@aztec/aztec.js/abi'
import type {
  ExecutionContext,
  IExecutionServices,
  IVFSContextService,
} from '@persistent-ai/fireflow-types'
import type AztecAccountSignerNode from '../../nodes/account/account-signer.node'
import type { Signer } from '../../shared/types'
import { ExecutionContext as ExecutionContextClass } from '@persistent-ai/fireflow-types'
import ParseContractArtifactNode from '../../nodes/contract/parse-artifact.node'
import { AztecArtifactRef } from '../../shared/schemas'
import { primeSignerCache } from '../../utils/resolve-aztec'

const ARTIFACT_WORKSPACE = 'ws-integration'
const ARTIFACT_BRANCH = 'main'

export const INTEGRATION_EXECUTION_ID = 'overcast-integration'

export function makeIntegrationVfs(files: Map<string, string>): IVFSContextService {
  return {
    readFile: async (_workspaceId: string, _ref: string, path: string) => {
      const content = files.get(path)
      if (content === undefined) {
        throw new Error(`not found: ${path}`)
      }
      return content
    },
  } as unknown as IVFSContextService
}

export function makeIntegrationContext(
  vfs: IVFSContextService,
  executionId = INTEGRATION_EXECUTION_ID,
): ExecutionContext {
  return new ExecutionContextClass(
    'overcast-integration-flow',
    new AbortController(),
    undefined,
    executionId,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { vfs } as IExecutionServices,
  )
}

export function artifactPathFor(name: string): string {
  return `artifacts/${name}.json`
}

export async function executeParseArtifact(
  id: string,
  artifact: ContractArtifact,
  context: ExecutionContext,
  files: Map<string, string>,
): Promise<ParseContractArtifactNode> {
  const path = artifactPathFor(artifact.name || id)
  files.set(path, JSON.stringify(artifact))

  const node = new ParseContractArtifactNode(id)
  node.initialize()
  node.workspaceId = ARTIFACT_WORKSPACE
  node.branch = ARTIFACT_BRANCH
  node.path = path
  await node.execute(context)
  return node
}

export function makeArtifactRef(name: string, artifactName?: string): AztecArtifactRef {
  const ref = new AztecArtifactRef()
  ref.workspaceId = ARTIFACT_WORKSPACE
  ref.branch = ARTIFACT_BRANCH
  ref.path = artifactPathFor(name)
  ref.name = artifactName ?? name
  return ref
}

/**
 * Seed the process-local signer cache so simulate/submit reuse a shared PXE
 * (required for private note visibility across mint/transfer in integration tests).
 */
export function bindSignerToWallet(
  node: AztecAccountSignerNode,
  live: Signer,
  executionId = INTEGRATION_EXECUTION_ID,
): void {
  if (!node.signer) {
    throw new Error('Account Signer must produce an AztecSignerRef before priming the cache')
  }
  primeSignerCache(executionId, node.signer, live)
  node.address = live.address.toString()
}
