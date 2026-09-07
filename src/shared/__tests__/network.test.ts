/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest'
import { NETWORK_NODE_URLS, resolveNetworkNodeUrl } from '../network'

describe('resolveNetworkNodeUrl', () => {
  afterEach(() => {
    delete process.env.AZTEC_NODE_URL
    delete process.env.AZTEC_TESTNET_NODE_URL
  })

  it('resolves Local to localhost by default', () => {
    expect(resolveNetworkNodeUrl('Local')).toBe(NETWORK_NODE_URLS.Local)
  })

  it('resolves Sandbox to localhost by default', () => {
    expect(resolveNetworkNodeUrl('Sandbox')).toBe(NETWORK_NODE_URLS.Sandbox)
  })

  it('resolves Testnet to the public RPC endpoint', () => {
    expect(NETWORK_NODE_URLS.Testnet).toBe('https://v5.testnet.rpc.aztec-labs.com')
    expect(resolveNetworkNodeUrl('Testnet')).toBe(NETWORK_NODE_URLS.Testnet)
  })

  it('honors AZTEC_NODE_URL for Local and Sandbox', () => {
    process.env.AZTEC_NODE_URL = 'http://custom:9090'
    expect(resolveNetworkNodeUrl('Local')).toBe('http://custom:9090')
    expect(resolveNetworkNodeUrl('Sandbox')).toBe('http://custom:9090')
  })

  it('ignores AZTEC_NODE_URL for Testnet', () => {
    process.env.AZTEC_NODE_URL = 'http://custom:9090'
    expect(resolveNetworkNodeUrl('Testnet')).toBe(NETWORK_NODE_URLS.Testnet)
  })

  it('honors AZTEC_TESTNET_NODE_URL for Testnet only', () => {
    process.env.AZTEC_TESTNET_NODE_URL = 'https://v6.testnet.rpc.example.com'
    expect(resolveNetworkNodeUrl('Testnet')).toBe('https://v6.testnet.rpc.example.com')
    expect(resolveNetworkNodeUrl('Local')).toBe(NETWORK_NODE_URLS.Local)
    expect(resolveNetworkNodeUrl('Sandbox')).toBe(NETWORK_NODE_URLS.Sandbox)
  })
})
