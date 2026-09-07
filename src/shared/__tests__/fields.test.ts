/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'
import { InvalidAztecFieldError } from '../errors'
import { parseAztecAddress, parseFq, parseFr } from '../fields'

describe('parseFr', () => {
  it('parses a hex string', () => {
    const fr = parseFr('0x01')
    expect(fr.toString()).toBeTruthy()
  })

  it('parses a decimal string', () => {
    const fr = parseFr('1')
    expect(fr.toString()).toBeTruthy()
  })

  it('throws InvalidAztecFieldError for empty string', () => {
    expect(() => parseFr('')).toThrow(InvalidAztecFieldError)
  })

  it('throws InvalidAztecFieldError for invalid input', () => {
    expect(() => parseFr('not-a-field')).toThrow(InvalidAztecFieldError)
  })
})

describe('parseAztecAddress', () => {
  it('throws InvalidAztecFieldError for empty string', () => {
    expect(() => parseAztecAddress('')).toThrow(InvalidAztecFieldError)
  })

  it('throws InvalidAztecFieldError for invalid input', () => {
    expect(() => parseAztecAddress('not-an-address')).toThrow(InvalidAztecFieldError)
  })
})

describe('parseFq', () => {
  it('parses a hex string', () => {
    const fq = parseFq('0x01')
    expect(fq.toString()).toBeTruthy()
  })

  it('parses a decimal string', () => {
    const fq = parseFq('1')
    expect(fq.toString()).toBeTruthy()
  })

  it('throws InvalidAztecFieldError for empty string', () => {
    expect(() => parseFq('')).toThrow(InvalidAztecFieldError)
  })

  it('throws InvalidAztecFieldError for invalid input', () => {
    expect(() => parseFq('not-a-field')).toThrow(InvalidAztecFieldError)
  })
})
