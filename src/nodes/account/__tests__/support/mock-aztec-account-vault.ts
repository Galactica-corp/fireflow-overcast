/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ExecutionContext,
  IExecutionServices,
  IVaultContextService,
  IVFSContextService,
} from '@persistent-ai/fireflow-types'
import type { AccountCredentials } from '../../../../utils/aztec-wallet'
import { Buffer } from 'node:buffer'
import { randomBytes, subtle } from 'node:crypto'
import { ExecutionContext as ExecutionContextClass } from '@persistent-ai/fireflow-types'
import { AztecAccountRef } from '../../../../shared/schemas'

const WORKSPACE_ID = 'ws-test'
const BRANCH = 'main'
const POINTER_PATH = 'secrets/aztec-account.Local.default.ffsecret'
const SECRET_ID = 'SEC_aztec_1'
const CALLER_ID = 'USR_caller'

export interface AccountSignerHarness {
  context: ExecutionContext
  account: AztecAccountRef
  files: Map<string, string>
}

export async function makeAccountSignerHarness(params: {
  credentials: AccountCredentials
  address: string
  network?: string
  label?: string
  secretType?: string
  omitPointer?: boolean
  callerId?: string
  executionId?: string
}): Promise<AccountSignerHarness> {
  const files = new Map<string, string>()
  const secretType = params.secretType ?? 'aztec-account'
  if (!params.omitPointer) {
    files.set(POINTER_PATH, JSON.stringify({
      version: '1.0',
      type: 'ffsecret',
      secretId: SECRET_ID,
      secretType,
      name: 'aztec-account:Local:default',
      description: 'Aztec account credentials',
      address: params.address,
    }))
  }

  const vfs = {
    readFile: async (_workspaceId: string, _ref: string, path: string) => {
      const content = files.get(path)
      if (content === undefined) {
        throw new Error(`not found: ${path}`)
      }
      return content
    },
  } as unknown as IVFSContextService

  const vault = {
    resolveSecretForExecution: async (
      secretId: string,
      _identities: string[],
      ecdhPublicKeyBase64: string,
    ) => {
      if (secretId !== SECRET_ID) {
        throw new Error(`unknown secret ${secretId}`)
      }
      const transit = await encryptForEcdh(JSON.stringify(params.credentials), ecdhPublicKeyBase64)
      return { ...transit, secretType }
    },
    getSecretForExecution: async () => {
      throw new Error('resolveSecretForExecution should be used')
    },
  } as unknown as IVaultContextService

  const callerId = params.callerId ?? CALLER_ID
  const context = new ExecutionContextClass(
    'account-signer-test',
    new AbortController(),
    undefined,
    params.executionId,
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
    { vault, vfs } as IExecutionServices,
    undefined,
    callerId,
    callerId,
  )

  const account = new AztecAccountRef()
  account.workspaceId = WORKSPACE_ID
  account.branch = BRANCH
  account.pointerPath = POINTER_PATH
  account.address = params.address
  account.network = params.network ?? 'Local'
  account.label = params.label ?? 'default'

  return { context, account, files }
}

export async function encryptForEcdh(
  plaintextJson: string,
  callerPublicKeyBase64: string,
): Promise<{ encrypted: string, hkdfNonce: string, publicKey: string }> {
  const ephemeralKeyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey'],
  )

  const callerPublicKey = await subtle.importKey(
    'raw',
    Buffer.from(callerPublicKeyBase64, 'base64'),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  const sharedSecret = await subtle.deriveKey(
    { name: 'ECDH', public: callerPublicKey },
    ephemeralKeyPair.privateKey,
    { name: 'HKDF', hash: 'SHA-256' },
    false,
    ['deriveKey'],
  )

  const hkdfNonce = randomBytes(32)
  const aesKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: hkdfNonce,
      info: new ArrayBuffer(0),
    },
    sharedSecret,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )

  const iv = randomBytes(12)
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    Buffer.from(plaintextJson, 'utf-8'),
  )

  const rawPublicKey = await subtle.exportKey('raw', ephemeralKeyPair.publicKey)

  return {
    encrypted: Buffer.concat([iv, Buffer.from(ciphertext)]).toString('base64'),
    hkdfNonce: hkdfNonce.toString('base64'),
    publicKey: Buffer.from(rawPublicKey).toString('base64'),
  }
}
