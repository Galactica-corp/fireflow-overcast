/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Facilitator signer for x402 integration tests — adapted from the demo reference.
 */

import type { InteractionFeeOptions, SendInteractionOptions, WaitOpts } from '@aztec/aztec.js/contracts'
import type { LogResult } from '@aztec/stdlib/logs'
import type {
  FacilitatorAztecSigner,
  PaymentNoteVerification,
  PrepareCommitmentResult,
} from '@galactica-net/x402-core'
import { AztecAddress } from '@aztec/aztec.js/addresses'
import { toSendOptions } from '@aztec/aztec.js/contracts'
import { Fr } from '@aztec/aztec.js/fields'
import { TxHash, TxStatus } from '@aztec/aztec.js/tx'
import { DomainSeparator } from '@aztec/constants'
import { computeLogTag, computeSiloedPrivateLogFirstField } from '@aztec/stdlib/hash'
import { SiloedTag, Tag } from '@aztec/stdlib/logs'
import {
  AztecOffchainMessagesSchema,
  unwrapAztecSdkResult,
} from '@galactica-net/x402-core'

/**
 * Receipts split block lifecycle (`status`) from execution outcome
 * (`executionResult`), and the tag-based log lookups take a query object and
 * return `LogResult[][]` — one bucket per requested tag.
 */
interface AztecNode {
  getTxReceipt: (txHash: TxHash) => Promise<{ status: string, executionResult?: string }>
  getPrivateLogsByTags: (query: { tags: SiloedTag[] }) => Promise<LogResult[][]>
  getPublicLogsByTags: (query: {
    contractAddress: AztecAddress
    tags: Tag[]
  }) => Promise<LogResult[][]>
}

/** `TxStatus` values that mean the tx made it into a block. */
const MINED_STATUSES = ['proposed', 'checkpointed', 'proven', 'finalized']

interface AztecAccount {
  address: AztecAddress
}

interface OffchainMessage {
  payload: unknown
  recipient?: unknown
  /** Reported as a bigint; the x402 core schema coerces it to a number. */
  anchorBlockTimestamp?: number | bigint
}

interface SendResult {
  receipt?: { txHash?: { toString: () => string }, status?: string }
  offchainEffects?: unknown[]
  offchainMessages?: OffchainMessage[]
  appReturnValues?: unknown[]
  txHash?: { toString: () => string }
}

interface SimulateResult {
  result?: unknown
  offchainEffects?: unknown[]
  offchainMessages?: OffchainMessage[]
}

interface TokenContract {
  address?: { toString: () => string }
  methods: {
    initialize_transfer_commitment: (
      to: AztecAddress,
      completer: AztecAddress,
    ) => {
      simulate: (opts: { from: AztecAddress }) => Promise<SimulateResult | unknown>
      request?: (opts: any) => Promise<unknown>
      send: (opts: any) => Promise<SendResult>
    }
  }
}

/**
 * Wallet able to surface the proven tx's private app return values.
 *
 * `ContractFunctionInteraction.wallet` is protected, so the wallet is handed to
 * the signer explicitly. {@link PXEWallet} implements this.
 */
export interface AppReturnValuesWallet {
  sendTxWithAppReturnValues: (
    executionPayload: unknown,
    opts: unknown,
  ) => Promise<SendResult>
}

interface CompletionLog {
  txHash: TxHash
  storageSlot: Fr
  value: bigint
}

function extractCommitmentFromSimulate(result: unknown): string {
  const value = unwrapAztecSdkResult(result)
  return normalizeCommitment(value)
}

function extractCommitmentFromSendResult(sendResult: SendResult): string | undefined {
  const value = sendResult.appReturnValues?.[0]
  if (value == null)
    return undefined
  return normalizeCommitment(value)
}

function extractTxHash(sendResult: SendResult): string {
  const txHash = (sendResult.receipt?.txHash ?? sendResult.txHash)?.toString()
  if (!txHash) {
    throw new Error('send() result did not include a transaction hash')
  }
  return txHash
}

function isNonZeroFieldString(value: string): boolean {
  const trimmed = value.trim()
  if (/^0x[0-9a-fA-F]{1,64}$/.test(trimmed)) {
    return !/^0x0*$/i.test(trimmed)
  }
  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed) > 0n
  }
  return false
}

function normalizeCommitment(value: unknown): string {
  const commitment = value == null ? '' : String(value)
  if (!isNonZeroFieldString(commitment)) {
    throw new Error('invalid commitment returned by token contract')
  }
  return commitment
}

function addressesEqual(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function serializeOffchainMessage(messages: OffchainMessage[]): string | undefined {
  if (!messages || messages.length === 0)
    return undefined
  const parsedMessages = AztecOffchainMessagesSchema.parse(messages)
  return JSON.stringify(parsedMessages, (_key, value) => {
    if (typeof value === 'bigint')
      return value.toString()
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ctor = value.constructor?.name
      if (ctor && ctor !== 'Object')
        return String(value)
    }
    return value
  })
}

export class RealFacilitatorAztecSigner implements FacilitatorAztecSigner {
  constructor(
    private readonly account: AztecAccount,
    private readonly node: AztecNode,
    private readonly token: TokenContract,
    private readonly sendOpts?: { fee?: InteractionFeeOptions },
    private readonly wallet?: AppReturnValuesWallet,
  ) {}

  async getAddresses(): Promise<string[]> {
    return [this.account.address.toString()]
  }

  async prepareCommitment(
    _tokenAddress: string,
    completerAddress: string,
  ): Promise<PrepareCommitmentResult> {
    const facilitatorAddr = this.account.address
    const completerAddr = AztecAddress.fromStringUnsafe(completerAddress)
    const interaction
      = this.token.methods.initialize_transfer_commitment(facilitatorAddr, completerAddr)

    const opts: SendInteractionOptions<WaitOpts> = {
      from: facilitatorAddr,
      wait: { timeout: 240, waitForStatus: TxStatus.CHECKPOINTED },
    }
    if (this.sendOpts?.fee) {
      opts.fee = this.sendOpts.fee
    }

    let simulateResult: unknown
    let sendResult: SendResult
    const wallet = this.wallet
    if (interaction.request && wallet) {
      const executionPayload = await interaction.request(opts)
      sendResult = await wallet.sendTxWithAppReturnValues(
        executionPayload,
        toSendOptions(opts),
      )
    } else {
      simulateResult = await interaction.simulate({ from: facilitatorAddr })
      sendResult = await interaction.send(opts)
    }

    const txHash = extractTxHash(sendResult)
    const finalCommitment
      = extractCommitmentFromSendResult(sendResult)
        ?? extractCommitmentFromSimulate(simulateResult)

    const result: PrepareCommitmentResult = {
      commitment: finalCommitment,
      prepareTxHash: txHash,
    }
    if (sendResult.offchainMessages && sendResult.offchainMessages.length > 0) {
      result.offchainMessage = serializeOffchainMessage(sendResult.offchainMessages)
    }
    return result
  }

  async verifyPayment(
    txHashStr: string,
    tokenAddress: string,
    requiredAmount: bigint,
    commitment?: string,
  ): Promise<PaymentNoteVerification> {
    try {
      const txHash = TxHash.fromString(txHashStr)
      const actualTokenAddress = this.token.address?.toString()
      if (actualTokenAddress && !addressesEqual(actualTokenAddress, tokenAddress)) {
        return {
          isValid: false,
          amountFound: 0n,
          error: `wrong token: expected ${actualTokenAddress}, got ${tokenAddress}`,
        }
      }

      if (!commitment || !isNonZeroFieldString(commitment)) {
        return {
          isValid: false,
          amountFound: 0n,
          error: 'missing or invalid commitment',
        }
      }

      let commitmentFr: Fr
      try {
        commitmentFr = Fr.fromString(commitment)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          isValid: false,
          amountFound: 0n,
          error: `invalid commitment: ${message}`,
        }
      }

      const receipt = await this.node.getTxReceipt(txHash)
      if (!MINED_STATUSES.includes(receipt.status)) {
        return {
          isValid: false,
          amountFound: 0n,
          error: `transaction status is '${receipt.status}'`,
        }
      }
      if (receipt.executionResult && receipt.executionResult !== 'success') {
        return {
          isValid: false,
          amountFound: 0n,
          error: `transaction execution ${receipt.executionResult}`,
        }
      }

      const tokenAddr = AztecAddress.fromStringUnsafe(tokenAddress)
      const completion = await this.findCompletionLog(tokenAddr, commitmentFr)
      if (!completion) {
        return {
          isValid: false,
          amountFound: 0n,
          error: 'no completion log found for commitment',
        }
      }

      if (!completion.txHash.equals(txHash)) {
        return {
          isValid: false,
          amountFound: 0n,
          error: `completion log belongs to tx ${completion.txHash.toString()}, not ${txHashStr}`,
        }
      }

      if (completion.value < requiredAmount) {
        return {
          isValid: false,
          amountFound: completion.value,
          error: `insufficient payment: received ${completion.value}, required ${requiredAmount}`,
        }
      }

      return { isValid: true, amountFound: completion.value }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        isValid: false,
        amountFound: 0n,
        error: `verification failed: ${message}`,
      }
    }
  }

  private async findCompletionLog(
    tokenAddr: AztecAddress,
    commitmentFr: Fr,
  ): Promise<CompletionLog | null> {
    const logTag = await computeLogTag(
      commitmentFr,
      DomainSeparator.NOTE_COMPLETION_LOG_TAG,
    )
    const siloedTag = await computeSiloedPrivateLogFirstField(tokenAddr, logTag)

    const privateBuckets = await this.node.getPrivateLogsByTags({
      tags: [new SiloedTag(siloedTag)],
    })
    const candidates: LogResult[]
      = privateBuckets[0] && privateBuckets[0].length > 0
        ? privateBuckets[0]
        : (await this.node.getPublicLogsByTags({
            contractAddress: tokenAddr,
            tags: [new Tag(logTag)],
          }))[0] ?? []

    if (candidates.length === 0)
      return null
    if (candidates.length > 1)
      return null

    const log = candidates[0]
    return {
      txHash: log.txHash,
      storageSlot: log.logData[1],
      value: log.logData[2].toBigInt(),
    }
  }
}
