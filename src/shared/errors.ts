/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export class InvalidAztecFieldError extends Error {
  constructor(
    public readonly fieldName: string,
    public readonly value: string,
    cause?: unknown,
  ) {
    super(`Invalid Aztec field "${fieldName}": ${value}`, { cause })
    this.name = 'InvalidAztecFieldError'
  }
}
