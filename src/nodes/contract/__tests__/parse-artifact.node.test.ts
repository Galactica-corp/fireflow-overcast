/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext, IExecutionServices, IVFSContextService } from '@persistent-ai/fireflow-types'
import type { OvercastRuntime } from '../../runtime-registry'
import { ExecutionContext as ExecutionContextClass } from '@persistent-ai/fireflow-types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { repairContractArtifact } from '../../../utils/repair-contract-artifact'
import { clearAztecObjectCaches, resolveArtifact } from '../../../utils/resolve-aztec'
import { registerOvercastRuntime } from '../../runtime-registry'
import ParseContractArtifactNode from '../parse-artifact.node'

registerOvercastRuntime({
  repairContractArtifact,
  resolveArtifact,
} as unknown as OvercastRuntime)

const ARTIFACT_PATH = 'artifacts/Token.json'
const ARTIFACT_JSON = JSON.stringify({ name: 'TestContract', functions: [], events: [] })

function makeContext(files: Map<string, string>, executionId = 'parse-artifact-test'): ExecutionContext {
  const vfs = {
    readFile: async (_workspaceId: string, _ref: string, path: string) => {
      const content = files.get(path)
      if (content === undefined) {
        throw new Error(`not found: ${path}`)
      }
      return content
    },
  } as unknown as IVFSContextService

  return new ExecutionContextClass(
    'parse-artifact-flow',
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

describe('parseContractArtifactNode', () => {
  let node: ParseContractArtifactNode
  let files: Map<string, string>

  beforeEach(() => {
    clearAztecObjectCaches()
    node = new ParseContractArtifactNode('test-id')
    node.initialize()
    files = new Map([[ARTIFACT_PATH, ARTIFACT_JSON]])
  })

  afterEach(() => {
    clearAztecObjectCaches()
  })

  it('initializes with default values and no json port', () => {
    expect(node.workspaceId).toBe('')
    expect(node.branch).toBe('')
    expect(node.path).toBe('')
    expect(node.artifact).toBeUndefined()
    expect(node.findPortByKey('json')).toBeUndefined()
  })

  it('throws when coordinates are missing', async () => {
    await expect(node.execute(makeContext(files))).rejects.toThrow(
      'Workspace ID, branch, and path are required',
    )
  })

  it('throws when the VFS file is missing', async () => {
    node.workspaceId = 'ws-1'
    node.branch = 'main'
    node.path = 'missing.json'

    await expect(node.execute(makeContext(files))).rejects.toThrow(/not found/)
  })

  it('throws when JSON is invalid', async () => {
    files.set(ARTIFACT_PATH, '{not valid json')
    node.workspaceId = 'ws-1'
    node.branch = 'main'
    node.path = ARTIFACT_PATH

    await expect(node.execute(makeContext(files))).rejects.toThrow(/not valid JSON/)
  })

  it('emits AztecArtifactRef with name and no ABI on the port', async () => {
    node.workspaceId = 'ws-1'
    node.branch = 'main'
    node.path = ARTIFACT_PATH

    await node.execute(makeContext(files))

    expect(node.artifact).toMatchObject({
      workspaceId: 'ws-1',
      branch: 'main',
      path: ARTIFACT_PATH,
      name: 'TestContract',
    })
    expect(node.artifact).not.toHaveProperty('functions')
  })
})
