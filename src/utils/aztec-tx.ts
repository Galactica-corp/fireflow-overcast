/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContractFunctionInteraction } from '@aztec/aztec.js/contracts'
import type { AuthWitness } from '@aztec/stdlib/auth-witness'
import type { TxReceipt } from '@aztec/stdlib/tx'
import type { FeePayer, PreparedTransaction, Signer, SmartContractDescriptor } from '../shared/types'
import { Buffer } from 'node:buffer'
import { Contract, NO_WAIT } from '@aztec/aztec.js/contracts'
import { coerceAztecAddress } from '../shared/fields'
import { ensureContractsRegistered } from './aztec-contract'
import { alignMethodParameters, coerceMethodParameters } from './coerce-parameters'
import { repairContractArtifact } from './repair-contract-artifact'

export interface BuildTransactionParams {
  contract: SmartContractDescriptor
  signer: Signer
  method: string
  parameters: unknown[]
  feePayer?: FeePayer
  /** Nested contracts the primary call invokes (e.g. Token when calling Dripper). */
  subContracts?: SmartContractDescriptor[]
}

function collectContractsToRegister(
  primary: { address: SmartContractDescriptor['address'], artifact: SmartContractDescriptor['artifact'] },
  subContracts: SmartContractDescriptor[] = [],
): Array<{ address: SmartContractDescriptor['address'], artifact: SmartContractDescriptor['artifact'] }> {
  return [
    { address: primary.address, artifact: primary.artifact },
    ...subContracts.map(sub => ({ address: sub.address, artifact: sub.artifact })),
  ]
}

export interface SubmitTransactionOptions {
  witnesses?: AuthWitness[]
  waitForConfirmation?: boolean
}

export interface SubmitTransactionResult {
  txHash: string
  receipt?: TxReceipt
}

/** JSON-safe tx receipt for node ports, DBOS step cache, and execution events. */
export interface SerializableTxReceipt {
  txHash: string
  status: string
  executionResult?: string
  transactionFee?: string
  blockHash?: string
  blockNumber?: number
  epochNumber?: number
}

export function toSerializableTxReceipt(receipt: TxReceipt): SerializableTxReceipt {
  return {
    txHash: receipt.txHash.toString(),
    status: String(receipt.status),
    ...(receipt.executionResult != null
      ? { executionResult: String(receipt.executionResult) }
      : {}),
    ...(receipt.transactionFee != null
      ? { transactionFee: String(receipt.transactionFee) }
      : {}),
    ...(receipt.blockHash != null
      ? { blockHash: receipt.blockHash.toString() }
      : {}),
    ...(receipt.blockNumber != null
      ? { blockNumber: Number(receipt.blockNumber) }
      : {}),
    ...(receipt.epochNumber != null
      ? { epochNumber: Number(receipt.epochNumber) }
      : {}),
  }
}

/** JSON-safe simulation return value for node ports, DBOS step cache, and execution events. */
export function toSerializableSimulationResult(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(toSerializableSimulationResult)
  }
  if (value instanceof Uint8Array) {
    return `0x${Buffer.from(value).toString('hex')}`
  }
  if (typeof value === 'object') {
    if ('toBigInt' in value && typeof (value as { toBigInt: () => bigint }).toBigInt === 'function') {
      return (value as { toBigInt: () => bigint }).toBigInt().toString()
    }
    if ('asBigInt' in value) {
      return (value as { asBigInt: bigint }).asBigInt.toString()
    }
    if ('result' in value) {
      return toSerializableSimulationResult((value as { result: unknown }).result)
    }
    const ctorName = Object.getPrototypeOf(value)?.constructor?.name
    if (ctorName && ctorName !== 'Object' && typeof (value as { toString: () => string }).toString === 'function') {
      const text = (value as { toString: () => string }).toString()
      if (text && !text.startsWith('[object ')) {
        if (/^-?\d+$/.test(text)) {
          return BigInt(text).toString()
        }
        return text
      }
    }
    const record: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      record[key] = toSerializableSimulationResult(entry)
    }
    return record
  }
  return String(value)
}

function assertLiveInteraction(tx: PreparedTransaction): ContractFunctionInteraction {
  if (typeof tx.interaction?.send !== 'function' || typeof tx.interaction?.getFunctionCall !== 'function') {
    throw new TypeError('Transaction interaction is not a live SDK handle. Resolve the AztecTxRequestRef first.')
  }
  return tx.interaction
}

/** Build a prepared transaction calling a method on a smart contract. */
export async function buildTransaction(params: BuildTransactionParams): Promise<PreparedTransaction> {
  const { contract, signer, method, parameters, feePayer } = params
  const subContracts = Array.isArray(params.subContracts) ? params.subContracts : []

  if (!method.trim()) {
    throw new Error('Method is required')
  }
  if (!contract) {
    throw new Error('Contract is required')
  }
  if (!signer) {
    throw new Error('Signer is required')
  }

  const rawParameters = Array.isArray(parameters) ? parameters : []
  const contractAddress = coerceAztecAddress(contract.address)
  const artifact = repairContractArtifact(contract.artifact)
  await ensureContractsRegistered({
    wallet: signer.wallet,
    nodeUrl: signer.nodeUrl,
    contracts: collectContractsToRegister(
      { address: contractAddress, artifact },
      subContracts,
    ),
  })
  const coercedParameters = alignMethodParameters(
    artifact,
    method,
    coerceMethodParameters(artifact, method, rawParameters),
  )

  const boundContract = Contract.at(contractAddress, artifact, signer.wallet)
  const contractMethod = boundContract.methods[method]
  if (!contractMethod || typeof contractMethod !== 'function') {
    throw new Error(`Method "${method}" not found on contract artifact`)
  }

  const interaction = contractMethod(...coercedParameters)
  await interaction.getFunctionCall()

  return {
    interaction,
    from: signer.address,
    feePayer,
    method,
  }
}

/** Simulate a prepared transaction locally via the PXE. */
export async function simulateTransaction(tx: PreparedTransaction): Promise<unknown> {
  const interaction = assertLiveInteraction(tx)

  const simulation = await interaction.simulate({
    from: tx.from,
    skipFeeEnforcement: true,
  })

  const rawResult = simulation.result
  const normalizedResult = toSerializableSimulationResult(rawResult)
  return normalizedResult
}

/** Submit a prepared transaction to the Aztec network. */
export async function submitTransaction(
  tx: PreparedTransaction,
  options: SubmitTransactionOptions = {},
): Promise<SubmitTransactionResult> {
  const { witnesses = [], waitForConfirmation = false } = options
  let interaction = assertLiveInteraction(tx)

  if (witnesses.length > 0) {
    interaction = interaction.with({ authWitnesses: witnesses })
  }

  const feeOptions = tx.feePayer?.paymentMethod
    ? { paymentMethod: tx.feePayer.paymentMethod }
    : undefined

  if (feeOptions?.paymentMethod) {
    await feeOptions.paymentMethod.getExecutionPayload()
  }

  if (waitForConfirmation) {
    const mined = await interaction.send({
      from: tx.from,
      fee: feeOptions,
    })
    const receipt = mined.receipt
    return {
      txHash: receipt.txHash.toString(),
      receipt,
    }
  }

  const immediate = await interaction.send({
    from: tx.from,
    fee: feeOptions,
    wait: NO_WAIT,
  })

  return {
    txHash: immediate.txHash.toString(),
    receipt: undefined,
  }
}
