/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContractArtifact } from '@aztec/aztec.js/abi'
import type { AztecAddress } from '@aztec/aztec.js/addresses'
import type { NetworkEnum } from '../shared/network'
import type { Signer, SmartContractDescriptor } from '../shared/types'
import { createAztecNodeClient } from '@aztec/aztec.js/node'
import { coerceAztecAddress, parseAztecAddress } from '../shared/fields'
import { repairContractArtifact } from './repair-contract-artifact'

export interface CreateSmartContractParams {
  address: string
  network: NetworkEnum
  artifact: ContractArtifact
}

export interface EnsureContractRegisteredParams {
  wallet: Signer['wallet']
  nodeUrl: string
  address: AztecAddress | string
  artifact: ContractArtifact
}

export interface EnsureContractsRegisteredParams {
  wallet: Signer['wallet']
  nodeUrl: string
  contracts: Array<{ address: AztecAddress | string, artifact: ContractArtifact }>
}

/** Register a deployed contract in the signer's PXE (required before simulate/submit). */
export async function ensureContractRegistered(params: EnsureContractRegisteredParams): Promise<void> {
  const address = coerceAztecAddress(params.address)
  const artifact = repairContractArtifact(params.artifact)
  const node = createAztecNodeClient(params.nodeUrl)
  const instance = await node.getContract(address)
  if (!instance) {
    throw new Error(`Contract not found on chain at ${address.toString()}`)
  }
  await params.wallet.registerContract(instance, artifact)
}

/** Register the primary contract and any nested contracts it calls. */
export async function ensureContractsRegistered(params: EnsureContractsRegisteredParams): Promise<void> {
  for (const contract of params.contracts) {
    await ensureContractRegistered({
      wallet: params.wallet,
      nodeUrl: params.nodeUrl,
      address: contract.address,
      artifact: contract.artifact,
    })
  }
}

/** Bind a contract address and artifact into a lazy smart-contract descriptor. */
export function createSmartContract(params: CreateSmartContractParams): SmartContractDescriptor {
  if (!params.address.trim()) {
    throw new Error('Contract address is required')
  }
  if (!params.artifact) {
    throw new Error('Artifact is required')
  }

  return {
    address: parseAztecAddress(params.address),
    artifact: params.artifact,
    network: params.network,
  }
}
