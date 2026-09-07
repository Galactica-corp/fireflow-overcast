/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { createSmartContract } from '../utils/aztec-contract'
import type { createFeePayer, ensureSponsoredFpcRegistered } from '../utils/aztec-fee'
import type {
  buildTransaction,
  simulateTransaction,
  submitTransaction,
  toSerializableTxReceipt,
} from '../utils/aztec-tx'
import type {
  createSigner,
  deriveAccountAddress,
  generateAccountCredentials,
  resolveAccount,
} from '../utils/aztec-wallet'
import type { repairContractArtifact } from '../utils/repair-contract-artifact'
import type {
  resolveArtifact,
  resolveContract,
  resolveFeePayer,
  resolveSigner,
  resolveTxRequest,
} from '../utils/resolve-aztec'
import type { buildPaymentHeader, parseChallenge, requestResource } from '../utils/x402'

/**
 * Where the Overcast nodes find their Aztec runtime.
 *
 * The node class declarations have to load anywhere a flow is deserialized —
 * including the editor bundle, which needs the ports and the schemas but never
 * talks to an Aztec node. Importing the runtime from the nodes would drag the
 * whole `@aztec/*` stack (aztec.js, the PXE embedded wallet, barretenberg's
 * bb.js WASM workers and every `@aztec/noir-contracts.js` artifact — ~85MB of
 * bundled JS) into that bundle for nothing. So the nodes import only this
 * module, and `@persistent-ai/fireflow-overcast/server` — the entry the
 * executor and tRPC layer load — fills it in on import.
 *
 * Mirrors `@persistent-ai/fireflow-bash`'s runner-registry
 * (packages/fireflow-bash/src/runtime/runner-registry.ts).
 */
export interface OvercastRuntime {
  buildPaymentHeader: typeof buildPaymentHeader
  buildTransaction: typeof buildTransaction
  createFeePayer: typeof createFeePayer
  createSigner: typeof createSigner
  createSmartContract: typeof createSmartContract
  deriveAccountAddress: typeof deriveAccountAddress
  ensureSponsoredFpcRegistered: typeof ensureSponsoredFpcRegistered
  generateAccountCredentials: typeof generateAccountCredentials
  parseChallenge: typeof parseChallenge
  repairContractArtifact: typeof repairContractArtifact
  requestResource: typeof requestResource
  resolveAccount: typeof resolveAccount
  resolveArtifact: typeof resolveArtifact
  resolveContract: typeof resolveContract
  resolveFeePayer: typeof resolveFeePayer
  resolveSigner: typeof resolveSigner
  resolveTxRequest: typeof resolveTxRequest
  simulateTransaction: typeof simulateTransaction
  submitTransaction: typeof submitTransaction
  toSerializableTxReceipt: typeof toSerializableTxReceipt
}

let runtime: OvercastRuntime | undefined

export function registerOvercastRuntime(rt: OvercastRuntime): void {
  runtime = rt
}

export function getOvercastRuntime(): OvercastRuntime {
  if (!runtime) {
    throw new Error(
      'The Overcast/Aztec runtime is not loaded in this process. Import '
      + '"@persistent-ai/fireflow-overcast/server" where flows are executed — '
      + 'the editor bundle registers the nodes for deserialization only.',
    )
  }
  return runtime
}
