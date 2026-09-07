/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FeePaymentMethodEnum } from '../shared/fee'
import type { FeePayer, Signer } from '../shared/types'
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts'
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee'
import { Fr } from '@aztec/aztec.js/fields'
import { createAztecNodeClient } from '@aztec/aztec.js/node'
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC'
import { parseAztecAddress } from '../shared/fields'

/**
 * EmbeddedWallet defaults to minFeePadding=0.5 (maxFees = minFees * 1.5).
 * After a heavy local/sandbox tx, the next block's gasFees can jump ~20× while
 * getPredictedMinFees still reports the pre-spike min — the following send then
 * fails mid-simulation with maxFeesPerGas < gasFees. Safe for Sponsored FPC;
 * do not apply on testnet FeeJuice flows.
 */
export const LOCAL_MIN_FEE_PADDING = 50

export interface CreateFeePayerParams {
  method: FeePaymentMethodEnum
  fpcAddress?: string
}

export interface RegisterSponsoredFpcParams {
  wallet: Signer['wallet']
  nodeUrl: string
  fpcAddress: string
}

/** Register a deployed Sponsored FPC contract in the signer's PXE (required before fee-sponsored submit). */
export async function ensureSponsoredFpcRegistered(params: RegisterSponsoredFpcParams): Promise<void> {
  const address = parseAztecAddress(params.fpcAddress)

  // Canonical Sponsored FPC (salt 0) is not returned by node.getContract — derive from artifact instead.
  const canonicalInstance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) },
  )
  let instance = canonicalInstance.address.equals(address) ? canonicalInstance : undefined

  if (!instance) {
    const node = createAztecNodeClient(params.nodeUrl)
    instance = (await node.getContract(address)) ?? undefined
  }

  if (!instance) {
    throw new Error(`Sponsored FPC contract not found on chain at ${params.fpcAddress}`)
  }

  await params.wallet.registerContract(instance, SponsoredFPCContract.artifact)
}

/** Build a fee-payment configuration for transaction building / submission. */
export function createFeePayer(params: CreateFeePayerParams): FeePayer {
  if (params.method === 'SponsoredFPC') {
    if (!params.fpcAddress?.trim()) {
      throw new Error('FPC address is required for SponsoredFPC fee payment')
    }
    return {
      method: 'sponsored' as const,
      paymentMethod: new SponsoredFeePaymentMethod(parseAztecAddress(params.fpcAddress)),
    }
  }

  return {
    method: 'fee_juice',
    paymentMethod: undefined,
  }
}
