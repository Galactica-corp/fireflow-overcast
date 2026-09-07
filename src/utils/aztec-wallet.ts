/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NetworkEnum } from '../shared/network'
import type { Signer } from '../shared/types'
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields'
import { EmbeddedWallet } from '@aztec/wallets/embedded'
import { parseAztecAddress, parseFq, parseFr } from '../shared/fields'
import { DEFAULT_NETWORK, resolveNetworkNodeUrl } from '../shared/network'
import { LOCAL_MIN_FEE_PADDING } from './aztec-fee'
import { createPXEWallet } from './aztec-pxe-wallet'

export interface AccountCredentials {
  secret: string
  salt: string
  signingKey: string
}

/**
 * Draw a fresh account secret, deployment salt and Grumpkin signing key.
 * Pure — no network. Unit-testable on its own.
 */
export function generateAccountCredentials(): AccountCredentials {
  return {
    secret: Fr.random().toString(),
    salt: Fr.random().toString(),
    signingKey: GrumpkinScalar.random().toString(),
  }
}

export interface CreateSignerParams {
  network?: NetworkEnum
  secret: string
  salt: string
  /**
   * Grumpkin scalar signing key. The signing key is the root of the key
   * hierarchy, so it cannot be derived from the secret and must be supplied.
   */
  signingKey: string
  discoverNotesFrom?: string[]
  /** Use PXEWallet instead of EmbeddedWallet (required for x402 commitment flows). */
  usePXEWallet?: boolean
}

export type ResolveAccountParams = CreateSignerParams

/**
 * Resolve an Aztec account from the three credential values (given or generated).
 * Delegates to {@link createSigner} so the account contract type cannot drift
 * away from the Account Signer's `createSchnorrInitializerlessAccount`.
 */
export async function resolveAccount(params: ResolveAccountParams): Promise<Signer> {
  return createSigner(params)
}

export interface DeriveAccountAddressParams {
  network?: NetworkEnum
  secret: string
  salt: string
  signingKey: string
}

/**
 * Derive the Aztec address from the three credential values.
 * Uses the same account-contract type as {@link createSigner} so the address
 * cannot drift. Opens a PXE connection today (not a chain transaction); isolated
 * so a later pure-local derive can drop in.
 */
export async function deriveAccountAddress(params: DeriveAccountAddressParams): Promise<string> {
  const signer = await createSigner(params)
  return signer.address.toString()
}

/**
 * Connect to an Aztec node, create an embedded wallet with PXE context,
 * derive an initializerless Schnorr account, and register sender addresses
 * for note discovery.
 */
export async function createSigner(params: CreateSignerParams): Promise<Signer> {
  const network = params.network ?? DEFAULT_NETWORK
  const nodeUrl = resolveNetworkNodeUrl(network)

  if (!params.signingKey?.trim()) {
    throw new Error(
      'Signing key is required: it is the root of the key hierarchy, so it cannot '
      + 'be derived from the account secret.',
    )
  }

  const wallet = params.usePXEWallet
    ? await createPXEWallet(nodeUrl, { ephemeral: true })
    : await EmbeddedWallet.create(nodeUrl, { ephemeral: true })

  // Local/sandbox L2 fees can spike ~20× after a heavy tx while predicted min
  // fees lag; default padding (0.5) is not enough for back-to-back sends.
  // Keep testnet on the SDK default so FeeJuice users are not overcharged.
  if (network === 'Local' || network === 'Sandbox') {
    wallet.setMinFeePadding(LOCAL_MIN_FEE_PADDING)
  }

  // Sandbox genesis accounts (and the recommended v5 account type) are
  // initializerless: keys are materialised locally via constructor simulation,
  // so there is no signing_public_key note to discover. createSchnorrAccount
  // uses the note-backed contract and fails with "Failed to get a note".
  const account = await wallet.createSchnorrInitializerlessAccount(
    parseFr(params.secret),
    parseFr(params.salt),
    parseFq(params.signingKey),
  )

  for (const [index, addr] of (params.discoverNotesFrom ?? []).entries()) {
    if (addr.trim()) {
      await wallet.registerSender(parseAztecAddress(addr), `sender-${index}`)
    }
  }

  return {
    wallet,
    account,
    address: account.address,
    nodeUrl,
  }
}
