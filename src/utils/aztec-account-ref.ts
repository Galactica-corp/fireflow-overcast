/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext } from '@persistent-ai/fireflow-types'
import type { NetworkEnum } from '../shared/network'
import type { AztecAccountRef, SecretScope } from '../shared/schemas'
import type { AccountCredentials } from './aztec-wallet'
import { Buffer } from 'node:buffer'
import { subtle } from 'node:crypto'
import { wrapSecret } from '@persistent-ai/fireflow-types'
import { NETWORK_OPTIONS } from '../shared/network'

const SECRET_TYPE = 'aztec-account'

export interface AztecAccountPointer {
  secretId: string
  address: string
}

export function parseAztecAccountPointer(raw: string, path: string): AztecAccountPointer {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Aztec account pointer at ${path} is not valid JSON`)
  }

  if (!isAccountPointerFile(parsed)) {
    throw new Error(`Aztec account pointer at ${path} is missing secretId or address`)
  }
  return parsed
}

export function parseAccountNetwork(network: string): NetworkEnum {
  if (!(NETWORK_OPTIONS as readonly string[]).includes(network)) {
    throw new Error(`Unknown Aztec network "${network}"`)
  }
  return network as NetworkEnum
}

function resolveSecretOwner(
  context: ExecutionContext,
  secretScope: SecretScope,
): string {
  const identity = secretScope === 'owner' ? context.flowOwnerId : context.callerId
  if (!identity) {
    throw new Error(
      secretScope === 'owner'
        ? 'Flow-owner identity required to load the Aztec account'
        : 'Caller identity required to load the Aztec account',
    )
  }
  return identity
}

/**
 * Read the `.ffsecret` pointer on an `AztecAccountRef` and decrypt the
 * scoped `aztec-account` vault secret. Plaintext exists only on the stack.
 */
export async function loadAztecAccountCredentials(
  context: ExecutionContext,
  account: AztecAccountRef,
  secretScope: SecretScope = 'caller',
): Promise<AccountCredentials> {
  assertAccountRef(account)

  const vault = context.services?.vault
  const vfs = context.services?.vfs
  if (!vault) {
    throw new Error('Vault service not available')
  }
  if (!vfs) {
    throw new Error('VFS service not available')
  }

  const raw = await vfs.readFile(account.workspaceId, account.branch, account.pointerPath)
  const pointer = parseAztecAccountPointer(raw, account.pointerPath)
  const identity = resolveSecretOwner(context, secretScope)
  return loadAztecAccountCredentialsFromSecretId(context, pointer.secretId, identity)
}

/**
 * Decrypt an `aztec-account` vault row. Plaintext exists only on the stack.
 */
export async function loadAztecAccountCredentialsFromSecretId(
  context: ExecutionContext,
  secretId: string,
  identity: string,
): Promise<AccountCredentials> {
  const vault = context.services?.vault
  if (!vault) {
    throw new Error('Vault service not available')
  }

  const keyPair = await context.getECDHKeyPair()
  const publicKeyBase64 = Buffer.from(
    await subtle.exportKey('raw', keyPair.publicKey),
  ).toString('base64')

  const transit = vault.resolveSecretForExecution
    ? await vault.resolveSecretForExecution(secretId, [identity], publicKeyBase64)
    : await vault.getSecretForExecution(secretId, identity, publicKeyBase64)

  if (transit.secretType !== SECRET_TYPE) {
    throw new Error(`Expected ${SECRET_TYPE} secret, got ${transit.secretType}`)
  }

  return wrapSecret(SECRET_TYPE, transit).decrypt(context)
}

function isAccountPointerFile(value: unknown): value is AztecAccountPointer {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const rec = value as Record<string, unknown>
  return typeof rec.secretId === 'string' && rec.secretId.length > 0
    && typeof rec.address === 'string' && rec.address.length > 0
}

function assertAccountRef(account: AztecAccountRef): void {
  if (!account.workspaceId || !account.branch || !account.pointerPath || !account.address || !account.network) {
    throw new Error('AztecAccountRef is missing workspaceId, branch, pointerPath, address, or network')
  }
}
