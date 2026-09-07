/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  loadAztecAccountCredentials,
  loadAztecAccountCredentialsFromSecretId,
  parseAccountNetwork,
  parseAztecAccountPointer,
} from './aztec-account-ref'
export type { AztecAccountPointer } from './aztec-account-ref'
export { createSmartContract } from './aztec-contract'
export type { CreateSmartContractParams } from './aztec-contract'
export { createFeePayer, LOCAL_MIN_FEE_PADDING } from './aztec-fee'
export type { CreateFeePayerParams } from './aztec-fee'
export { createPXEWallet, PXEWallet } from './aztec-pxe-wallet'
export { buildTransaction, simulateTransaction, submitTransaction } from './aztec-tx'
export type {
  BuildTransactionParams,
  SubmitTransactionOptions,
  SubmitTransactionResult,
} from './aztec-tx'
export { toSerializableSimulationResult, toSerializableTxReceipt } from './aztec-tx'
export { createSigner, deriveAccountAddress, generateAccountCredentials, resolveAccount } from './aztec-wallet'
export type { AccountCredentials, CreateSignerParams, DeriveAccountAddressParams, ResolveAccountParams } from './aztec-wallet'
export {
  clearAztecObjectCaches,
  primeSignerCache,
  resolveArtifact,
  resolveContract,
  resolveFeePayer,
  resolveSigner,
  resolveTxRequest,
} from './resolve-aztec'
export { buildPaymentHeader, parseChallenge, requestResource } from './x402'
export type {
  BuildPaymentHeaderParams,
  ParseChallengeParams,
  ParseChallengeResult,
  RequestResourceParams,
} from './x402'
