/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AbiType, ContractArtifact } from '@aztec/aztec.js/abi'
import { AztecAddress } from '@aztec/aztec.js/addresses'
import { getAllFunctionAbis, isAddressStruct } from '@aztec/stdlib/abi'
import { coerceAztecAddress } from '../shared/fields'

function looksLikeDeepCopiedAztecAddress(value: unknown): boolean {
  if (value instanceof AztecAddress) {
    return true
  }
  return typeof value === 'object'
    && value !== null
    && 'xCoord' in value
}

function coerceIfAddressLike(value: unknown): unknown {
  if (!looksLikeDeepCopiedAztecAddress(value)) {
    return value
  }

  try {
    return coerceAztecAddress(value)
  } catch {
    return value
  }
}

/** Rehydrate method arguments after port deep-copy (e.g. AztecAddress class instances → plain objects). */
export function coerceMethodParameters(
  artifact: ContractArtifact,
  method: string,
  parameters: unknown[],
): unknown[] {
  const fnAbi = getAllFunctionAbis(artifact).find(entry => entry.name === method)
  const paramAbis = Array.isArray(fnAbi?.parameters) ? fnAbi.parameters : undefined

  if (!paramAbis) {
    return parameters.map(coerceIfAddressLike)
  }

  return parameters.map((param, index) => {
    const paramAbi = paramAbis.at(index)
    if (paramAbi?.type && isAddressStruct(paramAbi.type)) {
      return coerceIfAddressLike(param)
    }
    return param
  })
}

function defaultPrimitiveAbiArgument(abiType: AbiType, paramName: string, method: string): unknown {
  switch (abiType.kind) {
    case 'field':
      return 0
    case 'integer':
      return 0n
    case 'boolean':
      return false
    default:
      throw new Error(
        `Missing required argument "${paramName}" for method "${method}". `
        + `Cannot infer a default for ABI type "${abiType.kind}".`,
      )
  }
}

/**
 * Pad missing trailing method arguments using ABI primitive defaults (e.g. `_nonce` → 0).
 * Noir internal params are often omitted in visual flows when the contract default applies.
 */
export function alignMethodParameters(
  artifact: ContractArtifact,
  method: string,
  parameters: unknown[],
): unknown[] {
  const fnAbi = getAllFunctionAbis(artifact).find(entry => entry.name === method)
  const paramAbis = Array.isArray(fnAbi?.parameters) ? fnAbi.parameters : undefined
  if (!paramAbis) {
    return parameters
  }

  if (parameters.length > paramAbis.length) {
    throw new Error(
      `Too many arguments for method "${method}": expected ${paramAbis.length}, got ${parameters.length}.`,
    )
  }

  if (parameters.length === paramAbis.length) {
    return parameters
  }

  const aligned = [...parameters]

  for (let index = parameters.length; index < paramAbis.length; index++) {
    const paramAbi = paramAbis[index]!
    aligned.push(defaultPrimitiveAbiArgument(paramAbi.type, paramAbi.name, method))
  }

  return aligned
}
