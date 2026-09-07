/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContractArtifact } from '@aztec/aztec.js/abi'
import type { ExecutionContext } from '@persistent-ai/fireflow-types'
import type {
  AztecArtifactRef,
  AztecFeePayerRef,
  AztecSignerRef,
  AztecSmartContractRef,
  AztecTxRequestRef,
} from '../shared/schemas'
import type { FeePayer, PreparedTransaction, Signer, SmartContractDescriptor } from '../shared/types'
import { getOvercastRuntime } from '../nodes/runtime-registry'
import { parseAztecAddress } from '../shared/fields'
import { loadAztecAccountCredentials, parseAccountNetwork } from './aztec-account-ref'

interface ExecutionCaches {
  signer: Map<string, Promise<Signer>>
  feePayer: Map<string, Promise<FeePayer>>
  artifact: Map<string, Promise<ContractArtifact>>
  contract: Map<string, Promise<SmartContractDescriptor>>
  tx: Map<string, Promise<PreparedTransaction>>
  lastAccess: number
}

// Execution ids never recur, so an execution's entries are garbage the moment
// it ends — but nothing in this package hears about execution completion.
// Bound the damage instead: per-execution bundles evicted LRU + TTL, so a
// long-lived worker holds live wallets/PXE handles for at most
// MAX_CACHED_EXECUTIONS recent executions instead of forever.
const MAX_CACHED_EXECUTIONS = 32
const EXECUTION_CACHE_TTL_MS = 30 * 60 * 1000

const executionCaches = new Map<string, ExecutionCaches>()
const registeredSenders = new WeakMap<Signer, Set<string>>()

function now(): number {
  return Date.now()
}

function cachesFor(executionId: string): ExecutionCaches {
  let caches = executionCaches.get(executionId)
  if (caches) {
    // Refresh LRU position (Map preserves insertion order)
    executionCaches.delete(executionId)
  } else {
    caches = {
      signer: new Map(),
      feePayer: new Map(),
      artifact: new Map(),
      contract: new Map(),
      tx: new Map(),
      lastAccess: 0,
    }
  }
  caches.lastAccess = now()
  executionCaches.set(executionId, caches)
  evictStaleExecutions()
  return caches
}

function evictStaleExecutions(): void {
  const cutoff = now() - EXECUTION_CACHE_TTL_MS
  for (const [executionId, caches] of executionCaches) {
    if (caches.lastAccess < cutoff) {
      executionCaches.delete(executionId)
    }
  }
  while (executionCaches.size > MAX_CACHED_EXECUTIONS) {
    const oldest = executionCaches.keys().next().value
    if (oldest === undefined) {
      break
    }
    executionCaches.delete(oldest)
  }
}

export function clearAztecObjectCaches(): void {
  executionCaches.clear()
}

/** Test/instrumentation seam — number of executions currently holding cached objects. */
export function cachedExecutionCount(): number {
  return executionCaches.size
}

export function primeSignerCache(executionId: string, ref: AztecSignerRef, signer: Signer): void {
  assertSignerRef(ref)
  cachesFor(executionId).signer.set(signerCacheKey(ref), Promise.resolve(signer))
}

function cacheGetOrCreate<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  create: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key)
  if (existing) {
    return existing
  }
  const pending = Promise.resolve().then(create)
  cache.set(key, pending)
  void pending.catch(() => {
    if (cache.get(key) === pending) {
      cache.delete(key)
    }
  })
  return pending
}

function executionIdOf(context: ExecutionContext): string {
  if (!context.executionId) {
    throw new Error('Execution id is required to resolve Aztec objects')
  }
  return context.executionId
}

function signerCacheKey(ref: AztecSignerRef): string {
  const account = ref.account!
  // secretScope changes WHOSE vault row is decrypted — it must be part of the
  // key even though the derived-address assertion would catch a mismatch.
  return `${account.network}:${account.address}:${ref.secretScope ?? 'caller'}`
}

function feePayerCacheKey(ref: AztecFeePayerRef): string {
  return `${ref.method}:${ref.fpcAddress ?? ''}`
}

function artifactCacheKey(ref: AztecArtifactRef): string {
  return `${ref.workspaceId}:${ref.branch}:${ref.path}`
}

function contractCacheKey(ref: AztecSmartContractRef): string {
  const artifact = ref.artifact!
  return `${ref.network}:${ref.address}:${artifact.workspaceId}:${artifact.branch}:${artifact.path}`
}

/** Stable JSON for cache keys — Aztec method args often include bigint amounts. */
function stableCacheJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) =>
    typeof nested === 'bigint' ? nested.toString() : nested)
}

function txCacheKey(ref: AztecTxRequestRef): string {
  return stableCacheJson({
    signer: ref.signer?.account
      ? {
          network: ref.signer.account.network,
          address: ref.signer.account.address,
          secretScope: ref.signer.secretScope,
          discoverNotesFrom: ref.signer.discoverNotesFrom,
        }
      : null,
    contract: ref.contract
      ? {
          address: ref.contract.address,
          network: ref.contract.network,
          artifact: ref.contract.artifact
            ? {
                workspaceId: ref.contract.artifact.workspaceId,
                branch: ref.contract.artifact.branch,
                path: ref.contract.artifact.path,
              }
            : null,
        }
      : null,
    subContracts: (ref.subContracts ?? []).map(sub => ({
      address: sub.address,
      network: sub.network,
      artifact: sub.artifact
        ? { workspaceId: sub.artifact.workspaceId, branch: sub.artifact.branch, path: sub.artifact.path }
        : null,
    })),
    method: ref.method,
    parameters: ref.parameters,
    feePayer: ref.feePayer
      ? { method: ref.feePayer.method, fpcAddress: ref.feePayer.fpcAddress }
      : null,
  })
}

function assertSignerRef(ref: AztecSignerRef): void {
  if (!ref.account) {
    throw new Error('AztecSignerRef.account is required')
  }
}

function assertArtifactRef(ref: AztecArtifactRef): void {
  if (!ref.workspaceId || !ref.branch || !ref.path) {
    throw new Error('AztecArtifactRef is missing workspaceId, branch, or path')
  }
}

function assertContractRef(ref: AztecSmartContractRef): void {
  if (!ref.address?.trim()) {
    throw new Error('AztecSmartContractRef.address is required')
  }
  if (!ref.artifact) {
    throw new Error('AztecSmartContractRef.artifact is required')
  }
  assertArtifactRef(ref.artifact)
}

async function applySenders(signer: Signer, senders: string[]): Promise<void> {
  let registered = registeredSenders.get(signer)
  if (!registered) {
    registered = new Set()
    registeredSenders.set(signer, registered)
  }
  for (const addr of senders) {
    const trimmed = addr.trim()
    if (!trimmed || registered.has(trimmed)) {
      continue
    }
    await signer.wallet.registerSender(parseAztecAddress(trimmed), `sender-${registered.size}`)
    registered.add(trimmed)
  }
}

export async function resolveSigner(ref: AztecSignerRef, context: ExecutionContext): Promise<Signer> {
  assertSignerRef(ref)
  const key = signerCacheKey(ref)
  const signer = await cacheGetOrCreate(cachesFor(executionIdOf(context)).signer, key, async () => {
    const account = ref.account!
    const credentials = await loadAztecAccountCredentials(context, account, ref.secretScope ?? 'caller')
    const created = await getOvercastRuntime().createSigner({
      network: parseAccountNetwork(account.network),
      secret: credentials.secret,
      salt: credentials.salt,
      signingKey: credentials.signingKey,
      discoverNotesFrom: [],
    })
    const derived = created.address.toString()
    if (derived !== account.address) {
      throw new Error(
        `Loaded account address ${derived} does not match AztecAccountRef.address ${account.address}`,
      )
    }
    return created
  })
  await applySenders(signer, ref.discoverNotesFrom ?? [])
  return signer
}

export async function resolveFeePayer(ref: AztecFeePayerRef, context: ExecutionContext): Promise<FeePayer> {
  const key = feePayerCacheKey(ref)
  return cacheGetOrCreate(cachesFor(executionIdOf(context)).feePayer, key, async () => {
    return getOvercastRuntime().createFeePayer({
      method: ref.method,
      fpcAddress: ref.fpcAddress || undefined,
    })
  })
}

export async function resolveArtifact(
  ref: AztecArtifactRef,
  context: ExecutionContext,
): Promise<ContractArtifact> {
  assertArtifactRef(ref)
  const key = artifactCacheKey(ref)
  return cacheGetOrCreate(cachesFor(executionIdOf(context)).artifact, key, async () => {
    const vfs = context.services?.vfs
    if (!vfs) {
      throw new Error('VFS service not available')
    }
    const raw = await vfs.readFile(ref.workspaceId, ref.branch, ref.path)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`Contract artifact at ${ref.path} is not valid JSON`)
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error(`Contract artifact at ${ref.path} is not a JSON object`)
    }
    return getOvercastRuntime().repairContractArtifact(parsed as ContractArtifact)
  })
}

export async function resolveContract(
  ref: AztecSmartContractRef,
  context: ExecutionContext,
): Promise<SmartContractDescriptor> {
  assertContractRef(ref)
  const key = contractCacheKey(ref)
  return cacheGetOrCreate(cachesFor(executionIdOf(context)).contract, key, async () => {
    const artifact = await resolveArtifact(ref.artifact!, context)
    return getOvercastRuntime().createSmartContract({
      address: ref.address,
      network: ref.network,
      artifact,
    })
  })
}

export async function resolveTxRequest(
  ref: AztecTxRequestRef,
  context: ExecutionContext,
): Promise<PreparedTransaction> {
  if (!ref.signer) {
    throw new Error('Signer is required')
  }
  if (!ref.contract) {
    throw new Error('Contract is required')
  }
  if (!ref.method?.trim()) {
    throw new Error('Method is required')
  }

  const key = txCacheKey(ref)
  return cacheGetOrCreate(cachesFor(executionIdOf(context)).tx, key, async () => {
    const signer = await resolveSigner(ref.signer!, context)
    const contract = await resolveContract(ref.contract!, context)
    const subContracts = await Promise.all(
      (ref.subContracts ?? []).map(sub => resolveContract(sub, context)),
    )
    const feePayer = ref.feePayer
      ? await resolveFeePayer(ref.feePayer, context)
      : undefined

    if (feePayer?.method === 'sponsored' && ref.feePayer?.fpcAddress?.trim()) {
      await getOvercastRuntime().ensureSponsoredFpcRegistered({
        wallet: signer.wallet,
        nodeUrl: signer.nodeUrl,
        fpcAddress: ref.feePayer.fpcAddress,
      })
    }

    return getOvercastRuntime().buildTransaction({
      contract,
      signer,
      method: ref.method,
      parameters: Array.isArray(ref.parameters) ? ref.parameters : [],
      feePayer,
      subContracts,
    })
  })
}
