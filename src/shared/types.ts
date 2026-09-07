/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContractArtifact } from '@aztec/aztec.js/abi'
import type { AztecAddress } from '@aztec/aztec.js/addresses'
import type { ContractFunctionInteraction } from '@aztec/aztec.js/contracts'
import type { FeePaymentMethod } from '@aztec/aztec.js/fee'
import type { AccountManager } from '@aztec/aztec.js/wallet'
import type { EmbeddedWallet } from '@aztec/wallets/embedded'
import type { ParsedPaymentRequirements } from '@galactica-net/x402-mechanism'
import type { FeePaymentMethodEnum } from './fee'
import type { HttpMethod } from './http'
import type { NetworkEnum } from './network'

/** Account + PXE context bundle produced by the Aztec Account Signer node. */
export interface Signer {
  wallet: EmbeddedWallet
  account: AccountManager
  address: AztecAddress
  nodeUrl: string
}

/** Lazy contract descriptor (not bound to a wallet until transaction build). */
export interface SmartContractDescriptor {
  address: AztecAddress
  artifact: ContractArtifact
  network: NetworkEnum
}

/** Fee payment configuration consumed by transaction-building / submission nodes. */
export interface FeePayer {
  method: 'fee_juice' | 'sponsored'
  paymentMethod: FeePaymentMethod | undefined
}

/** Live contract call ready for simulation or submission. Never a port value. */
export interface PreparedTransaction {
  interaction: ContractFunctionInteraction
  from: AztecAddress
  feePayer?: FeePayer
  method: string
}

/** HTTP header name/value pair. */
export interface Header {
  name: string
  value: string
}

/** Parsed x402 payment challenge from a prepared 402 response. */
export interface X402Challenge {
  accepted: ParsedPaymentRequirements
  x402Version: number
  nonce: string
  commitment?: string
  offchainMessage?: string
  prepareTxHash?: string
  amount: string
  asset: string
  payTo: string
  senderAddress?: string
  /** Client-side receipt time (ms) used for maxTimeoutSeconds staleness checks. */
  receivedAt?: number
}

/** HTTP response from the Request x402 Resource node. */
export interface X402Response {
  status: number
  headers: Record<string, string>
  body: unknown
  url: string
  method: string
  challenge?: X402Challenge
}

/** Context carried from Parse Challenge to Build Payment Header. */
export interface X402PaymentContext {
  accepted: ParsedPaymentRequirements
  x402Version: number
  senderAddress: string
}

export type { FeePaymentMethodEnum, HttpMethod, NetworkEnum }
