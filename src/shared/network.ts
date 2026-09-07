/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process'

export const NETWORK_OPTIONS = ['Local', 'Sandbox', 'Testnet'] as const

export type NetworkEnum = (typeof NETWORK_OPTIONS)[number]

export const DEFAULT_NETWORK: NetworkEnum = 'Local'

/** Default Aztec node RPC URLs per network (see https://docs.aztec.network/networks). */
export const NETWORK_NODE_URLS = {
  Local: 'http://localhost:8080',
  Sandbox: 'http://localhost:8080',
  Testnet: 'https://v5.testnet.rpc.aztec-labs.com',
} as const satisfies Record<NetworkEnum, string>

/**
 * Resolve the node RPC URL for a network. Local/Sandbox honor `AZTEC_NODE_URL`
 * when set; Testnet honors `AZTEC_TESTNET_NODE_URL` — Aztec has already moved
 * the testnet endpoint once (rpc.testnet → v5.testnet.rpc), and an override
 * turns the next move into a deploy-time change instead of a release.
 */
export function resolveNetworkNodeUrl(network: NetworkEnum): string {
  if (network === 'Local' || network === 'Sandbox') {
    return process.env.AZTEC_NODE_URL ?? NETWORK_NODE_URLS[network]
  }
  return process.env.AZTEC_TESTNET_NODE_URL ?? NETWORK_NODE_URLS[network]
}
