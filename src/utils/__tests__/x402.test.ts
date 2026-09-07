/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer'
import { SCHEME } from '@galactica-net/x402-core'
import { PaymentRequiredSchema } from '@galactica-net/x402-mechanism'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPaymentHeader, parseBaseUnitAmount, parseChallenge, requestResource } from '../x402'

function buildPaymentRequired(extra: Record<string, unknown> = {}) {
  return PaymentRequiredSchema.parse({
    x402Version: 2,
    accepts: [{
      scheme: SCHEME,
      network: 'aztec:sandbox',
      asset: `0x${'aa'.repeat(32)}`,
      amount: '1000',
      payTo: `0x${'bb'.repeat(32)}`,
      maxTimeoutSeconds: 600,
      extra: { nonce: 'nonce-1', ...extra },
    }],
  })
}

function buildChallengeResponse(
  overrides: {
    amount?: string
    asset?: string
    payTo?: string
    receivedAt?: number
    maxTimeoutSeconds?: number
  } = {},
) {
  const paymentRequired = buildPaymentRequired({ commitment: `0x${'cc'.repeat(32)}` })
  const accepted = {
    ...paymentRequired.accepts[0],
    amount: overrides.amount ?? paymentRequired.accepts[0].amount,
    asset: overrides.asset ?? paymentRequired.accepts[0].asset,
    payTo: overrides.payTo ?? paymentRequired.accepts[0].payTo,
    maxTimeoutSeconds: overrides.maxTimeoutSeconds ?? paymentRequired.accepts[0].maxTimeoutSeconds,
  }
  const signerAddress = { toString: () => `0x${'dd'.repeat(32)}` }

  return {
    x402Response: {
      status: 402,
      headers: {},
      body: {},
      url: 'http://localhost',
      method: 'GET',
      challenge: {
        accepted,
        x402Version: paymentRequired.x402Version,
        nonce: 'nonce-1',
        commitment: `0x${'cc'.repeat(32)}`,
        amount: accepted.amount,
        asset: accepted.asset,
        payTo: accepted.payTo,
        senderAddress: signerAddress.toString(),
        receivedAt: overrides.receivedAt,
      },
    },
    signer: { address: signerAddress } as any,
  }
}

describe('x402 utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildPaymentHeader', () => {
    it('encodes a PAYMENT-SIGNATURE header', () => {
      const paymentRequired = buildPaymentRequired({ commitment: `0x${'cc'.repeat(32)}` })
      const header = buildPaymentHeader({
        txHash: '0xtxhash',
        paymentContext: {
          accepted: paymentRequired.accepts[0],
          x402Version: paymentRequired.x402Version,
          senderAddress: `0x${'dd'.repeat(32)}`,
        },
      })

      expect(header.name).toBe('PAYMENT-SIGNATURE')
      const decoded = JSON.parse(Buffer.from(header.value, 'base64').toString())
      expect(decoded.payload.txHash).toBe('0xtxhash')
      expect(decoded.payload.senderAddress).toBe(`0x${'dd'.repeat(32)}`)
      expect(decoded.accepted.scheme).toBe(SCHEME)
    })

    it('throws when tx hash is missing', () => {
      expect(() => buildPaymentHeader({
        txHash: '',
        paymentContext: {
          accepted: buildPaymentRequired().accepts[0],
          x402Version: 2,
          senderAddress: `0x${'dd'.repeat(32)}`,
        },
      })).toThrow('Transaction hash is required')
    })
  })

  describe('requestResource', () => {
    it('returns a non-402 response unchanged', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestResource({
        url: 'http://localhost:4402/api/resource',
        method: 'GET',
      })

      expect(result.status).toBe(200)
      expect(result.body).toEqual({ ok: true })
      expect(result.challenge).toBeUndefined()
    })

    it('performs prepare round-trip when signer is provided', async () => {
      const initialRequired = buildPaymentRequired()
      const preparedRequired = buildPaymentRequired({
        commitment: `0x${'cc'.repeat(32)}`,
        prepareTxHash: `0x${'ee'.repeat(32)}`,
      })

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(null, {
          status: 402,
          headers: {
            'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(initialRequired)).toString('base64'),
          },
        }))
        .mockResolvedValueOnce(new Response(null, {
          status: 402,
          headers: {
            'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(preparedRequired)).toString('base64'),
          },
        }))
      vi.stubGlobal('fetch', fetchMock)

      const signer = {
        address: { toString: () => `0x${'dd'.repeat(32)}` },
      } as any

      const result = await requestResource({
        url: 'http://localhost:4402/api/resource',
        method: 'GET',
        signer,
      })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const prepareCall = fetchMock.mock.calls[1]
      expect(prepareCall[1].headers['X-402-PREPARE']).toBeTruthy()
      expect(result.challenge?.commitment).toBe(`0x${'cc'.repeat(32)}`)
      expect(result.challenge?.senderAddress).toBe(`0x${'dd'.repeat(32)}`)
      expect(result.challenge?.receivedAt).toBeTypeOf('number')
    })

    it('throws when prepare returns a 402 without commitment', async () => {
      const initialRequired = buildPaymentRequired()
      const failedRequired = {
        ...buildPaymentRequired(),
        error: 'commitment preparation failed: Tx dropped by P2P node',
      }

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(null, {
          status: 402,
          headers: {
            'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(initialRequired)).toString('base64'),
          },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify(failedRequired), {
          status: 402,
          headers: {
            'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(failedRequired)).toString('base64'),
            'content-type': 'application/json',
          },
        }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(requestResource({
        url: 'http://localhost:4402/api/resource',
        method: 'GET',
        signer: { address: { toString: () => `0x${'dd'.repeat(32)}` } } as any,
      })).rejects.toThrow(
        'x402 prepare failed: commitment preparation failed: Tx dropped by P2P node',
      )
    })
  })

  describe('parseBaseUnitAmount', () => {
    it('parses non-negative integer strings', () => {
      expect(parseBaseUnitAmount('1000')).toBe(1000n)
      expect(parseBaseUnitAmount('0')).toBe(0n)
    })

    it('rejects decimal, negative, and empty amounts', () => {
      expect(() => parseBaseUnitAmount('1.5')).toThrow('invalid payment amount')
      expect(() => parseBaseUnitAmount('-500')).toThrow('invalid payment amount')
      expect(() => parseBaseUnitAmount('')).toThrow('invalid payment amount')
      expect(() => parseBaseUnitAmount('abc')).toThrow('invalid payment amount')
    })
  })

  describe('parseChallenge', () => {
    it('throws when maxAmount is missing', async () => {
      const { x402Response, signer } = buildChallengeResponse()

      await expect(parseChallenge({
        x402Response,
        signer,
      } as any)).rejects.toThrow('maxAmount is required')
    })

    it('throws when challenge is missing', async () => {
      await expect(parseChallenge({
        x402Response: {
          status: 200,
          headers: {},
          body: {},
          url: 'http://localhost',
          method: 'GET',
        },
        signer: { address: { toString: () => '0xalice' } } as any,
        maxAmount: '1000',
      })).rejects.toThrow('x402 response does not contain a payment challenge')
    })

    it('returns settlement method and parameters', async () => {
      const { x402Response, signer } = buildChallengeResponse()

      const result = await parseChallenge({
        x402Response,
        signer,
        maxAmount: '1000',
      })

      expect(result.method).toBe('transfer_private_to_commitment')
      expect(result.parameters[1]).toBe(`0x${'cc'.repeat(32)}`)
      expect(result.parameters[2]).toBe(1000n)
      expect(result.paymentContext.senderAddress).toBe(signer.address.toString())
    })

    it('rejects when amount exceeds maxAmount', async () => {
      const { x402Response, signer } = buildChallengeResponse()

      await expect(parseChallenge({
        x402Response,
        signer,
        maxAmount: '999',
      })).rejects.toThrow('payment amount 1000 exceeds maxAmount 999')
    })

    it('rejects malformed challenge amounts', async () => {
      for (const amount of ['1.5', '-500', '']) {
        const { x402Response, signer } = buildChallengeResponse({ amount })

        await expect(parseChallenge({
          x402Response,
          signer,
          maxAmount: '1000',
        })).rejects.toThrow('invalid payment amount')
      }
    })

    it('rejects expectedAsset mismatch when provided', async () => {
      const { x402Response, signer } = buildChallengeResponse()

      await expect(parseChallenge({
        x402Response,
        signer,
        maxAmount: '1000',
        expectedAsset: '0xwrong',
      })).rejects.toThrow('does not match expected asset')
    })

    it('rejects expectedPayTo mismatch when provided', async () => {
      const { x402Response, signer } = buildChallengeResponse()

      await expect(parseChallenge({
        x402Response,
        signer,
        maxAmount: '1000',
        expectedPayTo: '0xwrong',
      })).rejects.toThrow('does not match expected payTo')
    })

    it('allows omitting expectedAsset and expectedPayTo', async () => {
      const { x402Response, signer } = buildChallengeResponse()

      const result = await parseChallenge({
        x402Response,
        signer,
        maxAmount: '1000',
      })

      expect(result.parameters[2]).toBe(1000n)
    })

    it('accepts matching expectedAsset and expectedPayTo', async () => {
      const { x402Response, signer } = buildChallengeResponse()

      const result = await parseChallenge({
        x402Response,
        signer,
        maxAmount: '1000',
        expectedAsset: x402Response.challenge!.asset,
        expectedPayTo: x402Response.challenge!.payTo,
      })

      expect(result.parameters[2]).toBe(1000n)
    })

    it('rejects stale challenges past maxTimeoutSeconds', async () => {
      const { x402Response, signer } = buildChallengeResponse({
        receivedAt: Date.now() - 601_000,
        maxTimeoutSeconds: 600,
      })

      await expect(parseChallenge({
        x402Response,
        signer,
        maxAmount: '1000',
      })).rejects.toThrow('payment challenge expired')
    })
  })
})
