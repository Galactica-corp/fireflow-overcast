/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @persistent-ai/fireflow-overcast/server
 *
 * Server-only exports: nodes and utilities.
 * Importing this module triggers node registration via @Node() decorators and
 * fills in the runtime registry the nodes call at execute time. The `/nodes`
 * entry alone registers declaration-only classes (ports and schemas) so the
 * editor bundle never pulls the `@aztec/*` stack — execution requires this
 * module to have been imported.
 */

import { registerOvercastRuntime } from './nodes/runtime-registry'
import { installAztecChonkProveAwait } from './patch-aztec-chonk-prove'
import { createSmartContract } from './utils/aztec-contract'
import { createFeePayer, ensureSponsoredFpcRegistered } from './utils/aztec-fee'
import {
  buildTransaction,
  simulateTransaction,
  submitTransaction,
  toSerializableTxReceipt,
} from './utils/aztec-tx'
import {
  createSigner,
  deriveAccountAddress,
  generateAccountCredentials,
  resolveAccount,
} from './utils/aztec-wallet'
import { repairContractArtifact } from './utils/repair-contract-artifact'
import {
  resolveArtifact,
  resolveContract,
  resolveFeePayer,
  resolveSigner,
  resolveTxRequest,
} from './utils/resolve-aztec'
import { buildPaymentHeader, parseChallenge, requestResource } from './utils/x402'

installAztecChonkProveAwait()

registerOvercastRuntime({
  buildPaymentHeader,
  buildTransaction,
  createFeePayer,
  createSigner,
  createSmartContract,
  deriveAccountAddress,
  ensureSponsoredFpcRegistered,
  generateAccountCredentials,
  parseChallenge,
  repairContractArtifact,
  requestResource,
  resolveAccount,
  resolveArtifact,
  resolveContract,
  resolveFeePayer,
  resolveSigner,
  resolveTxRequest,
  simulateTransaction,
  submitTransaction,
  toSerializableTxReceipt,
})

export * from './nodes'
export * from './shared'
export * from './utils'
