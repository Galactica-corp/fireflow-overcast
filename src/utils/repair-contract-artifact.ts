/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContractArtifact, FunctionAbi, FunctionArtifact, NoirCompiledContract } from '@aztec/aztec.js/abi'
import { Buffer } from 'node:buffer'
import { TokenContract } from '@aztec-foundation/aztec-standards/dist/src/artifacts/Token.js'
import { FunctionType, getAllFunctionAbis, loadContractArtifact } from '@aztec/stdlib/abi'

type FunctionAbiLike = FunctionAbi | FunctionArtifact

const CANONICAL_ARTIFACTS_BY_NAME: Record<string, ContractArtifact> = {
  [TokenContract.artifact.name]: TokenContract.artifact,
}

function isPublicFunction(fn: FunctionAbiLike): boolean {
  return fn.functionType === FunctionType.PUBLIC
}

function isCompleteFunctionAbi(fn: FunctionAbiLike): boolean {
  return Array.isArray(fn.parameters)
}

/**
 * Raw nargo output nests ABI under `fn.abi` and uses `custom_attributes` instead of
 * aztec.js fields (`parameters`, `functionType`). Detect that shape so we can run
 * `loadContractArtifact` rather than treating it as a sparsified ContractArtifact.
 */
export function isNoirCompiledContract(artifact: ContractArtifact): boolean {
  return (artifact.functions ?? []).some((fn) => {
    const entry = fn as FunctionAbiLike & { abi?: unknown, custom_attributes?: unknown }
    return Array.isArray(entry.custom_attributes)
      || (typeof entry.abi === 'object' && entry.abi !== null)
  })
}

function isSerializedBuffer(value: unknown): value is { type: 'Buffer', data: number[] } {
  return typeof value === 'object'
    && value !== null
    && (value as { type?: string }).type === 'Buffer'
    && Array.isArray((value as { data?: unknown }).data)
}

function rehydrateBuffer(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) {
    return value
  }
  if (isSerializedBuffer(value)) {
    return Buffer.from(value.data)
  }
  return undefined
}

function mergeFunctionAbi(sparse: FunctionAbiLike, canonical: FunctionAbiLike): FunctionAbiLike {
  if (isCompleteFunctionAbi(sparse)) {
    return sparse
  }

  return {
    ...canonical,
    ...sparse,
    parameters: canonical.parameters,
    returnTypes: sparse.returnTypes ?? canonical.returnTypes,
    errorTypes: sparse.errorTypes ?? canonical.errorTypes,
  }
}

function rehydrateFunctionArtifact(fn: FunctionArtifact): FunctionArtifact {
  const bytecode = rehydrateBuffer(fn.bytecode)
  if (!bytecode || bytecode === fn.bytecode) {
    return fn
  }
  return { ...fn, bytecode }
}

/** True when bytecode was JSON-serialized and is no longer a Node Buffer. */
export function artifactNeedsBufferRehydration(artifact: ContractArtifact): boolean {
  return (artifact.functions ?? []).some(fn => fn.bytecode !== undefined && !Buffer.isBuffer(fn.bytecode))
}

/** True when multiple public functions sit in `functions` (raw compiler JSON layout). */
export function artifactNeedsPublicFunctionLayoutRepair(artifact: ContractArtifact): boolean {
  const publicInFunctions = (artifact.functions ?? []).filter(isPublicFunction)
  return publicInFunctions.length > 1
}

/** True when any function ABI entry is missing its parameters array. */
export function artifactNeedsAbiRepair(artifact: ContractArtifact): boolean {
  return getAllFunctionAbis(artifact).some(fn => !isCompleteFunctionAbi(fn))
}

function rehydrateArtifactBuffers(artifact: ContractArtifact): ContractArtifact {
  if (!artifactNeedsBufferRehydration(artifact)) {
    return artifact
  }

  const mapFunctions = (entries: FunctionArtifact[] | undefined): FunctionArtifact[] | undefined => {
    if (!entries) {
      return entries
    }
    return entries.map(rehydrateFunctionArtifact)
  }

  return {
    ...artifact,
    functions: mapFunctions(artifact.functions) as FunctionArtifact[],
    nonDispatchPublicFunctions: mapFunctions(artifact.nonDispatchPublicFunctions as FunctionArtifact[] | undefined) ?? [],
  }
}

/**
 * Aztec.js expects exactly one public function (`public_dispatch`) in `functions`;
 * other public methods belong in `nonDispatchPublicFunctions`. Raw artifact JSON
 * files from the compiler put every public function in `functions` instead.
 */
export function normalizePublicFunctionLayout(artifact: ContractArtifact): ContractArtifact {
  if (!artifactNeedsPublicFunctionLayoutRepair(artifact)) {
    return artifact
  }

  const canonical = CANONICAL_ARTIFACTS_BY_NAME[artifact.name]
  if (canonical) {
    return {
      ...artifact,
      functions: canonical.functions,
      nonDispatchPublicFunctions: canonical.nonDispatchPublicFunctions,
    }
  }

  const functions = [...(artifact.functions ?? [])]
  const nonDispatch = [...(artifact.nonDispatchPublicFunctions ?? [])]
  const publicInFunctions = functions.filter(isPublicFunction)
  const nonPublicFunctions = functions.filter(fn => !isPublicFunction(fn))
  const dispatch = publicInFunctions.find(fn => fn.name === 'public_dispatch') ?? publicInFunctions[0]
  const otherPublic = publicInFunctions.filter(fn => fn !== dispatch)
  const nonDispatchNames = new Set(nonDispatch.map(fn => fn.name))

  for (const fn of otherPublic) {
    if (!nonDispatchNames.has(fn.name)) {
      nonDispatch.push(fn)
    }
  }

  return {
    ...artifact,
    functions: dispatch ? [...nonPublicFunctions, dispatch as FunctionArtifact] : nonPublicFunctions as FunctionArtifact[],
    nonDispatchPublicFunctions: nonDispatch as FunctionAbi[],
  }
}

/**
 * Rehydrate contract artifacts parsed from JSON or passed through ports.
 * Known artifacts (e.g. Token) resolve to bundled SDK instances with live Buffers.
 * Raw nargo JSON is converted via `loadContractArtifact`.
 */
export function repairContractArtifact(artifact: ContractArtifact): ContractArtifact {
  const canonical = CANONICAL_ARTIFACTS_BY_NAME[artifact.name]
  if (canonical) {
    return canonical
  }

  let working: ContractArtifact = artifact
  if (isNoirCompiledContract(working)) {
    working = loadContractArtifact(working as unknown as NoirCompiledContract)
  }

  let repaired = normalizePublicFunctionLayout(working)
  repaired = rehydrateArtifactBuffers(repaired)

  if (!artifactNeedsAbiRepair(repaired)) {
    return repaired
  }

  throw new Error(
    `Contract artifact "${repaired.name}" is missing function parameter ABIs. `
    + 'Provide a full artifact JSON or use a bundled contract artifact from the Aztec SDK.',
  )
}
