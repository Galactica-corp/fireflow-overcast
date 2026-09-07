/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PaymentPayload } from '@galactica-net/x402-mechanism'
import type {
  Header,
  HttpMethod,
  Signer,
  SmartContractDescriptor,
  X402Challenge,
  X402PaymentContext,
  X402Response,
} from '../shared/types'
import { Buffer } from 'node:buffer'
import { Contract } from '@aztec/aztec.js/contracts'
import { TxHash } from '@aztec/aztec.js/tx'
import { generateCorrelationId, parseAztecPaymentExtra, SCHEME } from '@galactica-net/x402-core'
import { PaymentRequiredSchema } from '@galactica-net/x402-mechanism'

export interface RequestResourceParams {
  url: string
  method: HttpMethod
  headers?: Header[]
  body?: unknown
  signer?: Signer
}

export interface ParseChallengeParams {
  x402Response: X402Response
  signer: Signer
  contract?: SmartContractDescriptor
  /** Maximum allowed payment amount in token base units (required spend cap). */
  maxAmount: bigint | string | number
  /** When set, challenge asset must match this value. */
  expectedAsset?: string
  /** When set, challenge payTo must match this value. */
  expectedPayTo?: string
}

export interface ParseChallengeResult {
  method: string
  parameters: unknown[]
  paymentContext: X402PaymentContext
}

export interface BuildPaymentHeaderParams {
  txHash: string
  paymentContext: X402PaymentContext
}

interface OffchainReceiveInput {
  ciphertext: unknown[]
  recipient: string
  tx_hash: unknown
  anchor_block_timestamp: number
}

function headersToRecord(headers?: Header[]): Record<string, string> {
  const record: Record<string, string> = {}
  if (!headers) {
    return record
  }
  for (const header of headers) {
    if (header?.name) {
      record[header.name] = header.value
    }
  }
  return record
}

function responseHeadersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

function toFieldLike(value: unknown): unknown {
  if (typeof value === 'bigint' || typeof value === 'number' || Buffer.isBuffer(value)) {
    return value
  }
  if (value != null && typeof value === 'object' && 'toField' in value) {
    return value
  }
  return String(value)
}

function normalizeCiphertext(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload.map(toFieldLike)
  }
  if (typeof payload === 'string') {
    if (payload.includes(',')) {
      return payload.split(',').map(field => field.trim()).filter(Boolean)
    }
    return payload ? [payload] : []
  }
  return payload == null ? [] : [toFieldLike(payload)]
}

const BASE_UNIT_AMOUNT_PATTERN = /^\d+$/

/** Parse a non-negative integer amount string in token base units. */
export function parseBaseUnitAmount(amount: string): bigint {
  if (!BASE_UNIT_AMOUNT_PATTERN.test(amount)) {
    throw new Error(`invalid payment amount: expected non-negative integer base-unit string, got "${amount}"`)
  }
  return BigInt(amount)
}

function normalizeMaxAmount(maxAmount: bigint | string | number): bigint {
  if (typeof maxAmount === 'bigint') {
    if (maxAmount < 0n) {
      throw new Error('maxAmount must be a non-negative integer')
    }
    return maxAmount
  }
  if (typeof maxAmount === 'number') {
    if (!Number.isInteger(maxAmount) || maxAmount < 0) {
      throw new Error('maxAmount must be a non-negative integer')
    }
    return BigInt(maxAmount)
  }
  if (!maxAmount.trim()) {
    throw new Error('maxAmount is required')
  }
  return parseBaseUnitAmount(maxAmount)
}

function assertChallengeNotStale(challenge: X402Challenge): void {
  const { receivedAt, accepted } = challenge
  const maxTimeoutSeconds = accepted.maxTimeoutSeconds
  if (receivedAt == null || maxTimeoutSeconds == null || maxTimeoutSeconds <= 0) {
    return
  }

  const elapsedMs = Date.now() - receivedAt
  if (elapsedMs > maxTimeoutSeconds * 1000) {
    throw new Error(
      `payment challenge expired: received ${Math.floor(elapsedMs / 1000)}s ago, maxTimeoutSeconds is ${maxTimeoutSeconds}`,
    )
  }
}

function validateChallengeAgainstPolicy(
  challenge: X402Challenge,
  maxAmount: bigint | string | number,
  expectedAsset?: string,
  expectedPayTo?: string,
): bigint {
  const amount = parseBaseUnitAmount(challenge.amount)
  const maxAllowed = normalizeMaxAmount(maxAmount)

  if (amount > maxAllowed) {
    throw new Error(
      `payment amount ${amount.toString()} exceeds maxAmount ${maxAllowed.toString()}`,
    )
  }

  if (expectedAsset?.trim() && challenge.asset !== expectedAsset) {
    throw new Error(
      `payment asset "${challenge.asset}" does not match expected asset "${expectedAsset}"`,
    )
  }

  if (expectedPayTo?.trim() && challenge.payTo !== expectedPayTo) {
    throw new Error(
      `payment payTo "${challenge.payTo}" does not match expected payTo "${expectedPayTo}"`,
    )
  }

  assertChallengeNotStale(challenge)

  return amount
}

function buildChallenge(
  accepted: X402Challenge['accepted'],
  x402Version: number,
  senderAddress?: string,
): X402Challenge {
  const extra = parseAztecPaymentExtra(accepted.extra)
  return {
    accepted,
    x402Version,
    nonce: extra.nonce ?? '',
    commitment: extra.commitment,
    offchainMessage: extra.offchainMessage,
    prepareTxHash: extra.prepareTxHash,
    amount: accepted.amount,
    asset: accepted.asset,
    payTo: accepted.payTo,
    senderAddress,
    receivedAt: Date.now(),
  }
}

function decodePaymentRequiredHeader(header: string): {
  parsed?: ReturnType<typeof PaymentRequiredSchema.parse>
  error?: string
} {
  const raw = JSON.parse(Buffer.from(header, 'base64').toString()) as {
    error?: unknown
  }
  const error = typeof raw.error === 'string' && raw.error.trim()
    ? raw.error
    : undefined
  let parsed: ReturnType<typeof PaymentRequiredSchema.parse> | undefined
  try {
    parsed = PaymentRequiredSchema.parse(raw)
  } catch {
    parsed = undefined
  }
  return { parsed, error }
}

function prepareFailureMessage(status: number, error?: string, hasHeader?: boolean): string {
  if (error) {
    return `x402 prepare failed: ${error}`
  }
  if (status !== 402) {
    return `x402 prepare request returned HTTP ${status}`
  }
  if (!hasHeader) {
    return 'x402 prepare response missing PAYMENT-REQUIRED header'
  }
  return 'x402 prepare did not return a commitment'
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  const text = await response.text()
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function buildFetchResponse(
  response: Response,
  url: string,
  method: string,
  challenge?: X402Challenge,
): Promise<X402Response> {
  return {
    status: response.status,
    headers: responseHeadersToRecord(response.headers),
    body: await parseResponseBody(response),
    url,
    method,
    challenge,
  }
}

async function tryPrepareChallenge(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  existingHeaders: Record<string, string>,
  matching: X402Challenge['accepted'],
  signer: Signer,
): Promise<{ challenge: X402Challenge, response: Response } | undefined> {
  const nonce = parseAztecPaymentExtra(matching.extra).nonce
  if (!nonce) {
    return undefined
  }

  const senderAddress = signer.address.toString()
  const prepareData = Buffer.from(
    JSON.stringify({ nonce, senderAddress }),
  ).toString('base64')

  const prepareHeaders = {
    ...existingHeaders,
    'X-402-PREPARE': prepareData,
  }

  const prepareResponse = await fetch(input, {
    ...init,
    headers: prepareHeaders,
  })

  const prepareHeader = prepareResponse.headers.get('PAYMENT-REQUIRED')
  let decoded: ReturnType<typeof decodePaymentRequiredHeader> | undefined
  try {
    decoded = prepareHeader ? decodePaymentRequiredHeader(prepareHeader) : undefined
  } catch {
    decoded = undefined
  }
  const preparedMatch = decoded?.parsed?.accepts.find(accept => accept.scheme === SCHEME)
  const commitment = preparedMatch
    ? parseAztecPaymentExtra(preparedMatch.extra).commitment
    : undefined

  if (prepareResponse.status === 402 && commitment && preparedMatch && decoded?.parsed) {
    return {
      challenge: buildChallenge(preparedMatch, decoded.parsed.x402Version, senderAddress),
      response: prepareResponse,
    }
  }

  throw new Error(prepareFailureMessage(
    prepareResponse.status,
    decoded?.error,
    Boolean(prepareHeader),
  ))
}

/** Perform an HTTP request to an x402 resource endpoint, optionally running the prepare round-trip. */
export async function requestResource(params: RequestResourceParams): Promise<X402Response> {
  const { url, method, headers, body, signer } = params

  if (!url.trim()) {
    throw new Error('URL is required')
  }

  const headerRecord = headersToRecord(headers)
  const init: RequestInit = {
    method,
    headers: headerRecord,
  }

  if (body !== undefined && body !== null && method !== 'GET' && method !== 'DELETE') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
    if (!init.headers) {
      init.headers = {}
    }
    const headersObj = init.headers as Record<string, string>
    if (!headersObj['content-type'] && !headersObj['Content-Type']) {
      headersObj['content-type'] = 'application/json'
    }
  }

  const response = await fetch(url, init)

  if (response.status !== 402 || !signer) {
    return buildFetchResponse(response, url, method)
  }

  const paymentRequiredHeader = response.headers.get('PAYMENT-REQUIRED')
  if (!paymentRequiredHeader) {
    return buildFetchResponse(response, url, method)
  }

  let paymentRequired: ReturnType<typeof PaymentRequiredSchema.parse>
  try {
    paymentRequired = PaymentRequiredSchema.parse(
      JSON.parse(Buffer.from(paymentRequiredHeader, 'base64').toString()),
    )
  } catch {
    return buildFetchResponse(response, url, method)
  }

  const matching = paymentRequired.accepts.find(accept => accept.scheme === SCHEME)
  if (!matching) {
    return buildFetchResponse(response, url, method)
  }

  const prepared = await tryPrepareChallenge(url, init, headerRecord, matching, signer)
  if (!prepared) {
    return buildFetchResponse(response, url, method)
  }
  return buildFetchResponse(prepared.response, url, method, prepared.challenge)
}

async function processOffchainMessage(
  signer: Signer,
  contract: SmartContractDescriptor,
  offchainMessage: string,
  prepareTxHash: string,
): Promise<void> {
  const boundContract = Contract.at(contract.address, contract.artifact, signer.wallet)
  const offchainReceive = boundContract.methods.offchain_receive
  if (!offchainReceive || typeof offchainReceive !== 'function') {
    return
  }

  const clientAddr = signer.address

  let messages: Array<{
    payload?: unknown
    ciphertext?: unknown
    recipient?: string
    anchorBlockTimestamp?: number
  }>
  try {
    messages = JSON.parse(offchainMessage)
  } catch {
    messages = [{ payload: offchainMessage }]
  }

  const receiveInputs: OffchainReceiveInput[] = messages.map(msg => ({
    ciphertext: normalizeCiphertext(msg.payload ?? msg.ciphertext),
    recipient: msg.recipient ?? clientAddr.toString(),
    tx_hash: TxHash.fromString(prepareTxHash).hash,
    anchor_block_timestamp: msg.anchorBlockTimestamp ?? 0,
  }))

  const interaction = offchainReceive(receiveInputs)
  await interaction.simulate({
    from: clientAddr,
    skipFeeEnforcement: true,
  })
}

/** Parse an x402 challenge and produce settlement method/parameters for the transaction builder. */
export async function parseChallenge(params: ParseChallengeParams): Promise<ParseChallengeResult> {
  const { x402Response, signer, contract, maxAmount, expectedAsset, expectedPayTo } = params

  if (!x402Response) {
    throw new Error('x402 response is required')
  }
  if (!signer) {
    throw new Error('Signer is required')
  }
  if (maxAmount === undefined || maxAmount === null || (typeof maxAmount === 'string' && !maxAmount.trim())) {
    throw new Error('maxAmount is required')
  }

  const challenge = x402Response.challenge
  if (!challenge) {
    throw new Error('x402 response does not contain a payment challenge')
  }

  const commitment = challenge.commitment
  if (!commitment) {
    throw new Error('missing commitment in payment challenge — server must include commitment')
  }

  const amount = validateChallengeAgainstPolicy(
    challenge,
    maxAmount,
    expectedAsset,
    expectedPayTo,
  )

  const senderAddress = challenge.senderAddress ?? signer.address.toString()

  if (challenge.offchainMessage && challenge.prepareTxHash && contract) {
    await processOffchainMessage(
      signer,
      contract,
      challenge.offchainMessage,
      challenge.prepareTxHash,
    )
  }

  const paymentContext: X402PaymentContext = {
    accepted: challenge.accepted,
    x402Version: challenge.x402Version,
    senderAddress,
  }

  return {
    method: 'transfer_private_to_commitment',
    parameters: [signer.address, commitment, amount, 0],
    paymentContext,
  }
}

/** Build the PAYMENT-SIGNATURE header from a submitted settlement transaction. */
export function buildPaymentHeader(params: BuildPaymentHeaderParams): Header {
  const { txHash, paymentContext } = params

  if (!txHash.trim()) {
    throw new Error('Transaction hash is required')
  }
  if (!paymentContext) {
    throw new Error('Payment context is required')
  }

  const fullPayload: PaymentPayload = {
    x402Version: paymentContext.x402Version,
    accepted: paymentContext.accepted,
    payload: {
      senderAddress: paymentContext.senderAddress,
      correlationId: generateCorrelationId(),
      txHash,
      timestamp: new Date().toISOString(),
    },
  }

  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64')

  return {
    name: 'PAYMENT-SIGNATURE',
    value: encoded,
  }
}
