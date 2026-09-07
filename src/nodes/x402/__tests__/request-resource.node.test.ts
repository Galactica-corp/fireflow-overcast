/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OvercastRuntime } from '../../runtime-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AztecAccountRef, AztecSignerRef } from '../../../shared/schemas'
import { registerOvercastRuntime } from '../../runtime-registry'
import RequestX402ResourceNode from '../request-resource.node'

const mockResolveSigner = vi.fn()
const mockRequestResource = vi.fn()

registerOvercastRuntime({
  resolveSigner: mockResolveSigner,
  requestResource: mockRequestResource,
} as unknown as OvercastRuntime)

function makeSignerRef(): AztecSignerRef {
  const account = new AztecAccountRef()
  account.workspaceId = 'ws-1'
  account.branch = 'main'
  account.pointerPath = 'secrets/a.ffsecret'
  account.address = 'aztec1:alice'
  account.network = 'Local'
  account.label = 'default'
  const signer = new AztecSignerRef()
  signer.account = account
  return signer
}

describe('requestX402ResourceNode', () => {
  let node: RequestX402ResourceNode
  let mockContext: { startTime: Date, executionId: string }
  const mockResponse = {
    status: 402,
    headers: {},
    body: { message: 'payment required' },
    url: 'http://localhost:4402/api/resource',
    method: 'GET',
  }

  beforeEach(() => {
    node = new RequestX402ResourceNode('test-id')
    node.initialize()
    mockContext = { startTime: new Date(), executionId: 'x402-req-1' }
    mockResolveSigner.mockReset()
    mockRequestResource.mockReset()
    mockRequestResource.mockResolvedValue(mockResponse)
  })

  it('throws when url is missing', async () => {
    await expect(node.execute(mockContext as never)).rejects.toThrow('URL is required')
  })

  it('resolves signer and requests the resource', async () => {
    const liveSigner = { address: {}, wallet: {} }
    mockResolveSigner.mockResolvedValue(liveSigner)
    const signerRef = makeSignerRef()
    const headers = [{ name: 'Authorization', value: 'Bearer test' }]

    node.url = 'http://localhost:4402/api/resource'
    node.method = 'POST'
    node.headers = headers
    node.body = { foo: 'bar' }
    node.signer = signerRef

    await node.execute(mockContext as never)

    expect(mockResolveSigner).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({
          workspaceId: 'ws-1',
          address: 'aztec1:alice',
        }),
      }),
      mockContext,
    )
    expect(node.response).toStrictEqual(mockResponse)
    expect(mockRequestResource).toHaveBeenCalledWith({
      url: 'http://localhost:4402/api/resource',
      method: 'POST',
      headers,
      body: { foo: 'bar' },
      signer: liveSigner,
    })
  })

  it('wraps a single payment header object into a headers array', async () => {
    const paymentHeader = { name: 'PAYMENT-SIGNATURE', value: 'x402-payload' }

    node.url = 'http://localhost:4402/api/resource'
    node.headers = paymentHeader

    await node.execute(mockContext as never)

    expect(mockResolveSigner).not.toHaveBeenCalled()
    expect(mockRequestResource).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: [paymentHeader],
        signer: undefined,
      }),
    )
  })
})
