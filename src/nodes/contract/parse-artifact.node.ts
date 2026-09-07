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
  PortObject,
  PortString,
} from '@persistent-ai/fireflow-types'
import { AztecArtifactRef } from '../../shared/schemas'
import { getOvercastRuntime } from '../runtime-registry'

@Node({
  type: 'ParseContractArtifactNode',
  title: 'Parse Contract Artifact',
  description: 'Validate a contract artifact JSON file in VFS and emit an AztecArtifactRef',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'contract'],
})
export default class ParseContractArtifactNode extends BaseNode {
  @Input()
  @PortString({
    title: 'Workspace ID',
    description: 'Workspace that holds the artifact JSON file',
    required: true,
    defaultValue: '',
  })
  workspaceId: string = ''

  @Input()
  @PortString({
    title: 'Branch',
    description: 'VFS branch / ref',
    required: true,
    defaultValue: '',
  })
  branch: string = ''

  @Input()
  @PortString({
    title: 'Path',
    description: 'Path to the artifact JSON file inside the workspace',
    required: true,
    defaultValue: '',
  })
  path: string = ''

  @Output()
  @PortObject({
    title: 'Artifact',
    description: 'VFS coordinates of the validated contract artifact',
    schema: AztecArtifactRef,
  })
  artifact?: AztecArtifactRef

  async execute(context: ExecutionContext): Promise<NodeExecutionResult> {
    if (!this.workspaceId.trim() || !this.branch.trim() || !this.path.trim()) {
      throw new Error('Workspace ID, branch, and path are required')
    }

    const artifact = new AztecArtifactRef()
    artifact.workspaceId = this.workspaceId
    artifact.branch = this.branch
    artifact.path = this.path

    const parsed = await getOvercastRuntime().resolveArtifact(artifact, context)
    artifact.name = parsed.name ?? ''
    this.artifact = artifact

    return {}
  }
}
