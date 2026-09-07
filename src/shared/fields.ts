/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { AztecAddress } from '@aztec/aztec.js/addresses'
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields'
import { InvalidAztecFieldError } from './errors'

function parseFieldElement<T>(
  fieldName: string,
  value: string,
  fromHex: (buf: string) => T,
  fromString: (buf: string) => T,
): T {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new InvalidAztecFieldError(fieldName, value)
  }

  try {
    return trimmed.startsWith('0x') || trimmed.startsWith('0X')
      ? fromHex(trimmed)
      : fromString(trimmed)
  } catch (error) {
    throw new InvalidAztecFieldError(fieldName, value, error)
  }
}

/** Parse a BN254 field element (Fr) from a hex or decimal string. */
export function parseFr(value: string): Fr {
  return parseFieldElement('Fr', value, Fr.fromHexString, Fr.fromString)
}

/** Parse a Grumpkin scalar (Fq) from a hex or decimal string. */
export function parseFq(value: string): GrumpkinScalar {
  return parseFieldElement('Fq', value, GrumpkinScalar.fromHexString, GrumpkinScalar.fromString)
}

/** Parse an Aztec address from a string. */
export function parseAztecAddress(value: string): AztecAddress {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new InvalidAztecFieldError('AztecAddress', value)
  }

  try {
    // "Unsafe" refers to Grumpkin-curve validity, not parsing: this does not check
    // the value is a valid address. `isValid()` is async, so validating here would
    // force every caller of this function async. See README.
    return AztecAddress.fromStringUnsafe(trimmed)
  } catch (error) {
    throw new InvalidAztecFieldError('AztecAddress', value, error)
  }
}

/** Coerce a live or deep-copied Aztec address value back into an AztecAddress instance. */
export function coerceAztecAddress(value: unknown): AztecAddress {
  if (value instanceof AztecAddress) {
    return value
  }

  if (typeof value === 'string') {
    return parseAztecAddress(value)
  }

  if (value && typeof value === 'object') {
    const xCoord = (value as { xCoord?: { asBigInt?: bigint, toBigInt?: () => bigint } }).xCoord
    if (xCoord?.asBigInt !== undefined) {
      return AztecAddress.fromBigIntUnsafe(xCoord.asBigInt)
    }
    if (typeof xCoord?.toBigInt === 'function') {
      return AztecAddress.fromBigIntUnsafe(xCoord.toBigInt())
    }

    const asString = (value as { toString?: () => string }).toString?.()
    if (asString && asString !== '[object Object]') {
      return parseAztecAddress(asString)
    }
  }

  throw new InvalidAztecFieldError('AztecAddress', String(value))
}
