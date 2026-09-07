/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ExecutionContext,
  IDBOSContextService,
  IFlowLockService,
  IMCPRuntimeContextService,
  IStepOptions,
  IVaultContextService,
  IVFSContextService,
  IVFSWriteContextService,
} from '@persistent-ai/fireflow-types'
import type { OvercastRuntime } from '../../runtime-registry'
import { subtle } from 'node:crypto'
import { classifyNode } from '@persistent-ai/fireflow-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerOvercastRuntime } from '../../runtime-registry'
import AztecEnsureAccountNode from '../ensure-account.node'
import { encryptForEcdh } from './support/mock-aztec-account-vault'

const CALLER_ID = 'USR_caller'
const WORKSPACE_ID = 'ws-personal'
const BRANCH = 'main'
const POINTER_PATH = 'secrets/aztec-account.Local.default.ffsecret'

const mockGenerateAccountCredentials = vi.fn()
const mockDeriveAccountAddress = vi.fn()

registerOvercastRuntime({
  generateAccountCredentials: mockGenerateAccountCredentials,
  deriveAccountAddress: mockDeriveAccountAddress,
} as unknown as OvercastRuntime)

interface StoredSecret {
  ownerId: string
  name: string
  value: Record<string, string>
}

interface Harness {
  node: AztecEnsureAccountNode
  files: Map<string, string>
  secrets: Map<string, StoredSecret>
  createSecret: ReturnType<typeof vi.fn>
  updateSecret: ReturnType<typeof vi.fn>
  generateCalls: () => number
  stepNames: string[]
  stepResults: unknown[]
  writeFileImpl: (path: string, content: string) => void
  context: ExecutionContext
}

function createSerializingLock(): IFlowLockService {
  let held: string | undefined
  const waiters: Array<() => void> = []
  return {
    acquire: async () => {
      if (held) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
        })
      }
      held = `lock-${Math.random().toString(16).slice(2)}`
      return { acquired: true, lockId: held }
    },
    release: async (_key, lockId) => {
      if (held !== lockId) {
        return { released: false }
      }
      held = undefined
      const next = waiters.shift()
      next?.()
      return { released: true }
    },
  }
}

/**
 * Mirrors production `VFSContextService.readFile`: the method body uses `this`.
 * An unbound `vfs.readFile` passed as a callback throws
 * `undefined is not an object (evaluating 'this.resolvePermission')`.
 */
class MethodVfs {
  constructor(private readonly files: Map<string, string>) {}

  async resolvePermission(): Promise<void> {}

  async readFile(_workspaceId: string, _ref: string, path: string): Promise<string> {
    await this.resolvePermission()
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error('Object not found')
    }
    return content
  }
}

function createHarness(overrides?: {
  callerId?: string
  lock?: IFlowLockService
}): Harness {
  const files = new Map<string, string>()
  const secrets = new Map<string, StoredSecret>()
  let secretSeq = 0
  const stepNames: string[] = []
  const stepResults: unknown[] = []

  const createSecret = vi.fn(async (params: {
    ownerId: string
    name: string
    value: Record<string, string>
  }) => {
    secretSeq += 1
    const id = `SEC_${secretSeq}`
    secrets.set(id, { ownerId: params.ownerId, name: params.name, value: params.value })
    return id
  })

  const updateSecret = vi.fn(async (
    secretId: string,
    _ownerId: string,
    value: Record<string, string>,
  ) => {
    const existing = secrets.get(secretId)
    if (existing) {
      existing.value = value
    }
  })

  const findSecretIdByName = vi.fn(async (
    ownerId: string,
    name: string,
  ): Promise<string | null> => {
    for (const [id, stored] of secrets) {
      if (stored.ownerId === ownerId && stored.name === name) {
        return id
      }
    }
    return null
  })

  const writeFileImpl = (path: string, content: string): void => {
    files.set(path, content)
  }

  const vfs = new MethodVfs(files)

  const vfsWrite: Pick<IVFSWriteContextService, 'writeFile' | 'commit'> = {
    writeFile: async (_workspaceId, _branch, path, content) => {
      writeFileImpl(path, content)
      return { uri: path, checksum: '', size: content.length, success: true }
    },
    commit: async () => ({ commitId: 'c1', success: true }),
  }

  const dbos = {
    runStep: async <T>(fn: () => Promise<T>, options?: IStepOptions): Promise<T> => {
      if (options?.name) {
        stepNames.push(options.name)
      }
      const result = await fn()
      stepResults.push(result)
      return result
    },
  }

  const mcpRuntime: Pick<IMCPRuntimeContextService, 'resolvePersonalWorkspace'> = {
    resolvePersonalWorkspace: async () => ({ workspaceId: WORKSPACE_ID, branchName: BRANCH }),
  }

  const resolveSecretForExecution = vi.fn(async (
    secretId: string,
    _identities: string[],
    ecdhPublicKeyBase64: string,
  ) => {
    const stored = secrets.get(secretId)
    if (!stored) {
      throw new Error(`unknown secret ${secretId}`)
    }
    const transit = await encryptForEcdh(JSON.stringify(stored.value), ecdhPublicKeyBase64)
    return { ...transit, secretType: 'aztec-account' }
  })

  let ecdhKeyPair: CryptoKeyPair | undefined
  const getECDHKeyPair = async (): Promise<CryptoKeyPair> => {
    if (!ecdhKeyPair) {
      ecdhKeyPair = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveKey'],
      )
    }
    return ecdhKeyPair
  }

  const node = new AztecEnsureAccountNode('ensure-test')
  node.initialize()

  const context = {
    callerId: overrides?.callerId ?? CALLER_ID,
    getECDHKeyPair,
    services: {
      dbos: dbos as unknown as IDBOSContextService,
      vfs: vfs as unknown as IVFSContextService,
      vfsWrite: vfsWrite as unknown as IVFSWriteContextService,
      vault: {
        createSecret,
        updateSecret,
        findSecretIdByName,
        resolveSecretForExecution,
        getSecretForExecution: async () => {
          throw new Error('resolveSecretForExecution should be used')
        },
      } as unknown as IVaultContextService,
      flowLock: overrides?.lock ?? createSerializingLock(),
      mcpRuntime: mcpRuntime as unknown as IMCPRuntimeContextService,
    },
  } as unknown as ExecutionContext

  return {
    node,
    files,
    secrets,
    createSecret,
    updateSecret,
    generateCalls: () => mockGenerateAccountCredentials.mock.calls.length,
    stepNames,
    stepResults,
    writeFileImpl: (path, content) => {
      writeFileImpl(path, content)
    },
    context,
  }
}

describe('aztecEnsureAccountNode', () => {
  beforeEach(() => {
    mockGenerateAccountCredentials.mockReset()
    mockDeriveAccountAddress.mockReset()
    mockGenerateAccountCredentials.mockReturnValue({
      secret: '0xsecret-a',
      salt: '0xsalt-a',
      signingKey: '0xsign-a',
    })
    mockDeriveAccountAddress.mockImplementation(async (params: {
      secret: string
    }) => {
      if (params.secret === '0xsecret-a') {
        return '0xaddress-a'
      }
      if (params.secret === '0xsecret-b') {
        return '0xaddress-b'
      }
      throw new Error(`unexpected secret ${params.secret}`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('classifies as dbos and is not pure', () => {
    const node = new AztecEnsureAccountNode('meta')
    node.initialize()
    expect(classifyNode(node)).toBe('dbos')
    expect(node.metadata.execution?.dbos).toBe(true)
    expect(node.metadata.execution?.pure).not.toBe(true)
  })

  it('has no secret output ports', () => {
    const node = new AztecEnsureAccountNode('ports')
    node.initialize()
    const accountPort = node.findPortByKey('account')
    expect(accountPort?.getConfig().type).toBe('object')
    expect(node.findPortByKey('outSecret')).toBeUndefined()
    expect(node.findPortByKey('secret')).toBeUndefined()
  })

  it('throws without callerId', async () => {
    const h = createHarness()
    const context = { ...h.context, callerId: undefined }
    await expect(h.node.execute(context)).rejects.toThrow(/Caller identity required/)
  })

  it('throws on an invalid label', async () => {
    const h = createHarness()
    h.node.label = 'feature/x'
    await expect(h.node.execute(h.context)).rejects.toThrow(/Invalid account label/)
  })

  it('(a) second run with an existing pointer returns the same address and does not mint', async () => {
    const h = createHarness()
    await h.node.execute(h.context)

    expect(h.node.account?.address).toBe('0xaddress-a')
    expect(h.createSecret).toHaveBeenCalledTimes(1)
    expect(h.generateCalls()).toBe(1)
    expect(h.files.has(POINTER_PATH)).toBe(true)

    mockGenerateAccountCredentials.mockClear()
    h.createSecret.mockClear()

    const second = new AztecEnsureAccountNode('ensure-test-2')
    second.initialize()
    await second.execute(h.context)

    expect(second.account?.address).toBe('0xaddress-a')
    expect(h.createSecret).not.toHaveBeenCalled()
    expect(mockGenerateAccountCredentials).not.toHaveBeenCalled()
    expect(h.updateSecret).not.toHaveBeenCalled()
  })

  it('(b) two concurrent first-runs return one address and create once', async () => {
    const lock = createSerializingLock()
    const shared = createHarness({ lock })

    const nodeA = new AztecEnsureAccountNode('a')
    nodeA.initialize()
    const nodeB = new AztecEnsureAccountNode('b')
    nodeB.initialize()

    const results = await Promise.allSettled([
      nodeA.execute(shared.context),
      nodeB.execute(shared.context),
    ])

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2)
    expect(nodeA.account?.address).toBe(nodeB.account?.address)
    expect(nodeA.account?.address).toBe('0xaddress-a')
    expect(shared.createSecret).toHaveBeenCalledTimes(1)
    expect(shared.generateCalls()).toBe(1)
  })

  it('(c) a crash between steps adopts the same secretId and address on retry', async () => {
    const h = createHarness()
    const originalWrite = h.files.set.bind(h.files)
    let writes = 0
    const vfsWrite = h.context.services?.vfsWrite
    if (!vfsWrite) {
      throw new Error('expected vfsWrite')
    }
    vfsWrite.writeFile = async (_workspaceId, _branch, path, content) => {
      writes += 1
      if (writes === 1) {
        throw new Error('simulated crash before pointer commit')
      }
      originalWrite(path, content)
      return { uri: path, checksum: '', size: content.length, success: true }
    }

    await expect(h.node.execute(h.context)).rejects.toThrow(/simulated crash/)
    expect(h.secrets.size).toBe(1)
    expect(h.files.has(POINTER_PATH)).toBe(false)
    const secretId = [...h.secrets.keys()][0]
    expect(h.generateCalls()).toBe(1)

    mockGenerateAccountCredentials.mockReturnValue({
      secret: '0xsecret-b',
      salt: '0xsalt-b',
      signingKey: '0xsign-b',
    })

    const retry = new AztecEnsureAccountNode('ensure-retry')
    retry.initialize()
    await retry.execute(h.context)

    expect(h.createSecret).toHaveBeenCalledTimes(1)
    expect(h.updateSecret).not.toHaveBeenCalled()
    expect(h.generateCalls()).toBe(1)
    expect(retry.account?.address).toBe('0xaddress-a')
    expect(mockDeriveAccountAddress).toHaveBeenLastCalledWith(expect.objectContaining({
      secret: '0xsecret-a',
      salt: '0xsalt-a',
      signingKey: '0xsign-a',
    }))
    const pointer = JSON.parse(h.files.get(POINTER_PATH)!) as { secretId: string, address: string }
    expect(pointer.secretId).toBe(secretId)
    expect(pointer.address).toBe('0xaddress-a')
  })

  it('does not mint when a pointer read fails for a reason other than not-found', async () => {
    const h = createHarness()
    const vfs = h.context.services?.vfs
    if (!vfs) {
      throw new Error('expected vfs')
    }
    vfs.readFile = async () => {
      throw new Error('undefined is not an object (evaluating \'this.resolvePermission\')')
    }

    await expect(h.node.execute(h.context)).rejects.toThrow(/this\.resolvePermission/)
    expect(h.createSecret).not.toHaveBeenCalled()
    expect(h.generateCalls()).toBe(0)
    expect(h.updateSecret).not.toHaveBeenCalled()
  })

  it('step 1 checkpoint is public-only and both steps are named', async () => {
    const h = createHarness()
    await h.node.execute(h.context)

    // Node-scoped names: two EnsureAccount instances in one flow must not share
    // step names, or a recovery-time reorder swaps their checkpoints silently.
    expect(h.stepNames).toEqual([
      'ensure-account:ensure-test:ensure-vault-secret',
      'ensure-account:ensure-test:publish-pointer',
    ])
    const first = h.stepResults[0] as Record<string, unknown>
    expect(first).not.toHaveProperty('secret')
    expect(first).not.toHaveProperty('salt')
    expect(first).not.toHaveProperty('signingKey')
    expect(first).toMatchObject({
      secretId: 'SEC_1',
      address: '0xaddress-a',
      existed: false,
    })
    expect(h.node.account).toMatchObject({
      workspaceId: WORKSPACE_ID,
      branch: BRANCH,
      pointerPath: POINTER_PATH,
      address: '0xaddress-a',
      network: 'Local',
      label: 'default',
    })
  })
})
