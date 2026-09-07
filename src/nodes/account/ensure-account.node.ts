/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext, IVFSContextService, NodeExecutionResult } from '@persistent-ai/fireflow-types'
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
import { AztecAccountRef } from '../../shared/schemas'
import { loadAztecAccountCredentialsFromSecretId, parseAztecAccountPointer } from '../../utils/aztec-account-ref'
import { getOvercastRuntime } from '../runtime-registry'

const LABEL_PATTERN = /^[\w-]+$/
const SECRET_TYPE = 'aztec-account'
const LOCK_TTL_MS = 30_000
const LOCK_WAIT_MS = 10_000

interface EnsuredAccount {
  workspaceId: string
  branchName: string
  secretId: string
  address: string
  existed: boolean
  lockId: string
}

@Node({
  type: 'AztecEnsureAccountNode',
  title: 'Aztec Ensure Account',
  description: 'Get-or-create the caller\'s Aztec account; returns an AztecAccountRef',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'account', 'wallet', 'onboarding'],
  execution: { dbos: true },
})
export default class AztecEnsureAccountNode extends BaseNode {
  @Input()
  @StringEnum([...NETWORK_OPTIONS], {
    title: 'Network',
    description: 'Target Aztec network (selects the node RPC used for address derivation)',
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
  @PortString({
    title: 'Label',
    description: 'Account label — folded into the secret name and pointer path. Default is a single account per user per network.',
    defaultValue: 'default',
  })
  label: string = 'default'

  @Output()
  @PortObject({
    title: 'Account',
    description: 'Pointer coordinates + public address of the caller\'s Aztec account',
    schema: AztecAccountRef,
  })
  account?: AztecAccountRef

  async execute(context: ExecutionContext): Promise<NodeExecutionResult> {
    const callerId = context.callerId
    if (!callerId) {
      throw new Error('Caller identity required (agent entrypoint)')
    }
    assertSafeLabel(this.label)

    const services = context.services
    if (!services) {
      throw new Error('This node requires a DBOS execution context')
    }
    const { vault, vfs, vfsWrite, flowLock, mcpRuntime, dbos } = services
    if (!vault) {
      throw new Error('Vault service not available')
    }
    if (!vfs) {
      throw new Error('VFS service not available')
    }
    if (!vfsWrite) {
      throw new Error('VFS write service not available')
    }
    if (!flowLock) {
      throw new Error('Flow lock service not available')
    }
    if (!mcpRuntime) {
      throw new Error('mcpRuntime service not available — cannot resolve the caller\'s personal workspace')
    }

    const name = `${SECRET_TYPE}:${this.network}:${this.label}`
    const path = `secrets/${SECRET_TYPE}.${this.network}.${this.label}.ffsecret`
    const lockKey = `${name}:${callerId}`
    const runtime = getOvercastRuntime()

    // Hold the lock across both steps so a concurrent first-run cannot mint a
    // second address in the gap between createSecret and the pointer commit.
    // A throw inside step 1 releases immediately; a worker kill relies on TTL.
    let lockId: string | undefined
    try {
      const ensured = await dbos.runStep(async (): Promise<EnsuredAccount> => {
        let ws: { workspaceId: string, branchName: string }
        try {
          ws = await mcpRuntime.resolvePersonalWorkspace(callerId)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          throw new Error(
            `Caller personal workspace is required to store the Aztec account pointer: ${message}`,
          )
        }

        const lock = await flowLock.acquire(lockKey, LOCK_TTL_MS, LOCK_WAIT_MS)
        if (!lock.acquired) {
          throw new Error('Account creation already in progress')
        }

        try {
          const pointer = await readPointerOrUndefined(
            vfs,
            ws.workspaceId,
            ws.branchName,
            path,
          )
          if (pointer) {
            return {
              workspaceId: ws.workspaceId,
              branchName: ws.branchName,
              secretId: pointer.secretId,
              address: pointer.address,
              existed: true,
              lockId: lock.lockId,
            }
          }

          const orphan = await vault.findSecretIdByName(
            callerId,
            name,
            SECRET_TYPE,
            'user',
            callerId,
          )
          if (orphan) {
            // Pointer missing, vault row present (crash between mint and commit,
            // or a failed VFS read that previously minted). Reuse the keys —
            // never generateAccountCredentials + updateSecret on an existing row.
            const credentials = await loadAztecAccountCredentialsFromSecretId(
              context,
              orphan,
              callerId,
            )
            const address = await runtime.deriveAccountAddress({
              network: this.network,
              secret: credentials.secret,
              salt: credentials.salt,
              signingKey: credentials.signingKey,
            })
            return {
              workspaceId: ws.workspaceId,
              branchName: ws.branchName,
              secretId: orphan,
              address,
              existed: false,
              lockId: lock.lockId,
            }
          }

          const scalars = runtime.generateAccountCredentials()
          const secretId = await vault.createSecret({
            ownerId: callerId,
            name,
            secretType: SECRET_TYPE,
            value: {
              secret: scalars.secret,
              salt: scalars.salt,
              signingKey: scalars.signingKey,
            },
            scope: 'user',
            scopeId: callerId,
          })

          const address = await runtime.deriveAccountAddress({
            network: this.network,
            secret: scalars.secret,
            salt: scalars.salt,
            signingKey: scalars.signingKey,
          })

          return {
            workspaceId: ws.workspaceId,
            branchName: ws.branchName,
            secretId,
            address,
            existed: false,
            lockId: lock.lockId,
          }
        } catch (err) {
          await flowLock.release(lockKey, lock.lockId)
          throw err
        }
      // Node-scoped step name: DBOS keys steps by call order and only checks the
      // name for mismatch — identical names on two instances of this node would
      // let a recovery-time reorder swap their checkpoints SILENTLY. A unique
      // name turns that into a loud DBOSUnexpectedStepError (CLAUDE.md §4.1).
      }, { name: `ensure-account:${this.id}:ensure-vault-secret` })

      lockId = ensured.lockId

      if (!ensured.existed) {
        await dbos.runStep(async () => {
          await vfsWrite.writeFile(
            ensured.workspaceId,
            ensured.branchName,
            path,
            buildAccountPointer({ secretId: ensured.secretId, name, address: ensured.address }),
          )
          await vfsWrite.commit(
            ensured.workspaceId,
            ensured.branchName,
            'Create Aztec account',
          )
        }, { name: `ensure-account:${this.id}:publish-pointer` })
      }

      const account = new AztecAccountRef()
      account.workspaceId = ensured.workspaceId
      account.branch = ensured.branchName
      account.pointerPath = path
      account.address = ensured.address
      account.network = this.network
      account.label = this.label
      this.account = account
      return {}
    } finally {
      if (lockId) {
        await flowLock.release(lockKey, lockId)
      }
    }
  }
}

function assertSafeLabel(label: string): void {
  if (!LABEL_PATTERN.test(label)) {
    throw new Error(
      `Invalid account label "${label}": must match ${LABEL_PATTERN.source}`,
    )
  }
}

function buildAccountPointer(params: {
  secretId: string
  name: string
  address: string
}): string {
  return JSON.stringify(
    {
      version: '1.0',
      type: 'ffsecret',
      secretId: params.secretId,
      secretType: SECRET_TYPE,
      name: params.name,
      description: 'Aztec account credentials',
      address: params.address,
    },
    null,
    2,
  )
}

async function readPointerOrUndefined(
  vfs: Pick<IVFSContextService, 'readFile'>,
  workspaceId: string,
  branch: string,
  path: string,
): Promise<{ secretId: string, address: string } | undefined> {
  let raw: string
  try {
    // Call as a method so `this` stays bound. Passing `vfs.readFile` unbound
    // drops `this.resolvePermission` on VFSContextService and every read throws.
    raw = await vfs.readFile(workspaceId, branch, path)
  } catch (err) {
    if (isVfsNotFoundError(err)) {
      return undefined
    }
    throw err
  }
  return parseAztecAccountPointer(raw, path)
}

function isVfsNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /not found/i.test(message) || /\b404\b/.test(message)
}
