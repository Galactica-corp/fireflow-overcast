/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { InitialAccountData } from '@aztec/accounts/testing'
import type { EmbeddedWallet } from '@aztec/wallets/embedded'
import type { Signer } from '../../shared/types'
import process from 'node:process'
import { DripperContract } from '@aztec-foundation/aztec-standards/dist/src/artifacts/Dripper.js'
import { TokenContract } from '@aztec-foundation/aztec-standards/dist/src/artifacts/Token.js'
import { getInitialTestAccountsData } from '@aztec/accounts/testing'
import { AztecAddress } from '@aztec/aztec.js/addresses'
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts'
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee'
import { Fr } from '@aztec/aztec.js/fields'
import { createAztecNodeClient } from '@aztec/aztec.js/node'
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC'
import { EmbeddedWallet as EmbeddedWalletClass } from '@aztec/wallets/embedded'
import { parseAztecAddress } from '../../shared/fields'
import { LOCAL_MIN_FEE_PADDING } from '../../utils/aztec-fee'

export const DEFAULT_TOKEN_NAME = 'TestToken'
export const DEFAULT_TOKEN_SYMBOL = 'TT'
export const DEFAULT_TOKEN_DECIMALS = 18n
export const DEFAULT_MINT_AMOUNT = 1000n
export const DEFAULT_WAIT_TIMEOUT = 180
export { LOCAL_MIN_FEE_PADDING }

export interface AccountCredentials {
  address: string
  secret: string
  salt: string
  signingKey: string
}

export interface LocalAztecDeployResult {
  nodeUrl: string
  network: 'Local'
  alice: AccountCredentials
  bob: AccountCredentials
  aliceAccount: Signer['account']
  bobAccount: Signer['account']
  token: {
    address: string
    name: string
    symbol: string
    decimals: bigint
  }
  dripper: {
    address: string
  }
  sponsoredFpc: {
    address: string
  }
  aliceMintedBalance: bigint
  wallet: EmbeddedWallet
  paymentMethod: SponsoredFeePaymentMethod
}

export type DeployProgressStep
  = | 'accounts'
    | 'sponsored-fpc'
    | 'dripper-deploy'
    | 'token-deploy'
    | 'mint'
    | 'verify-balance'

export interface DeployProgress {
  step: DeployProgressStep
  message: string
  detail?: Record<string, string>
}

export interface DeployLocalAztecFixturesOptions {
  nodeUrl?: string
  mintAmount?: bigint
  waitTimeout?: number
  onProgress?: (progress: DeployProgress) => void
}

function fieldToInput(value: { toString: () => string }): string {
  return value.toString()
}

function toAccountCredentials(data: InitialAccountData): AccountCredentials {
  return {
    address: data.address.toString(),
    secret: fieldToInput(data.secret),
    salt: fieldToInput(data.salt),
    signingKey: fieldToInput(data.signingKey),
  }
}

/** Coerce a contract simulate() return value into a bigint balance. */
export function normalizeSimulateResult(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return BigInt(value)
  }
  if (typeof value === 'string' && value.trim()) {
    return BigInt(value)
  }
  if (value !== null && typeof value === 'object' && 'result' in value) {
    return normalizeSimulateResult((value as { result: unknown }).result)
  }
  if (value !== null && typeof value === 'object' && 'toBigInt' in value
    && typeof (value as { toBigInt: () => bigint }).toBigInt === 'function') {
    return (value as { toBigInt: () => bigint }).toBigInt()
  }
  if (value !== null && typeof value === 'object' && 'asBigInt' in value) {
    return BigInt((value as { asBigInt: bigint }).asBigInt)
  }
  if (value !== null && typeof value === 'object' && 'toString' in value) {
    const text = (value as { toString: () => string }).toString()
    if (text && !text.startsWith('[object ')) {
      return BigInt(text)
    }
  }
  throw new Error(`Unexpected simulation result: ${String(value)}`)
}

async function readPrivateBalance(
  token: Awaited<ReturnType<typeof TokenContract.at>>,
  account: Signer['account'],
): Promise<bigint> {
  const simulation = await token.methods.balance_of_private(account.address).simulate({
    from: account.address,
    skipFeeEnforcement: true,
  })
  return normalizeSimulateResult(simulation)
}

async function registerDeployedTokenContract(
  wallet: EmbeddedWallet,
  nodeUrl: string,
  tokenAddress: string,
): Promise<Awaited<ReturnType<typeof TokenContract.at>>> {
  const parsedAddress = parseAztecAddress(tokenAddress)
  const node = createAztecNodeClient(nodeUrl)
  const instance = await node.getContract(parsedAddress)
  if (!instance) {
    throw new Error(`Token contract not found on chain at ${tokenAddress}`)
  }
  await wallet.registerContract(instance, TokenContract.artifact)
  return TokenContract.at(parsedAddress, wallet)
}

async function registerDeployedDripperContract(
  wallet: EmbeddedWallet,
  nodeUrl: string,
  dripperAddress: string,
): Promise<Awaited<ReturnType<typeof DripperContract.at>>> {
  const parsedAddress = parseAztecAddress(dripperAddress)
  const node = createAztecNodeClient(nodeUrl)
  const instance = await node.getContract(parsedAddress)
  if (!instance) {
    throw new Error(`Dripper contract not found on chain at ${dripperAddress}`)
  }
  await wallet.registerContract(instance, DripperContract.artifact)
  return DripperContract.at(parsedAddress, wallet)
}

async function setupSponsoredFpc(wallet: EmbeddedWallet): Promise<{
  address: string
  paymentMethod: SponsoredFeePaymentMethod
}> {
  const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) },
  )
  await wallet.registerContract(sponsoredFPCInstance, SponsoredFPCContract.artifact)
  return {
    address: sponsoredFPCInstance.address.toString(),
    paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPCInstance.address),
  }
}

/**
 * Deploy local Aztec test fixtures: Alice/Bob accounts, Sponsored FPC,
 * Dripper, Token (Dripper as minter), and a private drip mint to Alice.
 */
export async function deployLocalAztecFixtures(
  options: DeployLocalAztecFixturesOptions = {},
): Promise<LocalAztecDeployResult> {
  const nodeUrl = options.nodeUrl ?? process.env.AZTEC_NODE_URL ?? 'http://localhost:8080'
  const mintAmount = options.mintAmount
    ?? (process.env.MINT_AMOUNT ? BigInt(process.env.MINT_AMOUNT) : DEFAULT_MINT_AMOUNT)
  const waitTimeout = options.waitTimeout ?? DEFAULT_WAIT_TIMEOUT
  const onProgress = options.onProgress

  const testAccounts = await getInitialTestAccountsData()
  const aliceData = testAccounts[0]
  const bobData = testAccounts[1]
  const alice = toAccountCredentials(aliceData)
  const bob = toAccountCredentials(bobData)

  onProgress?.({
    step: 'accounts',
    message: 'Creating Alice and Bob Schnorr accounts',
    detail: {
      alice: alice.address,
      bob: bob.address,
    },
  })

  const wallet = await EmbeddedWalletClass.create(nodeUrl, { ephemeral: true })
  wallet.setMinFeePadding(LOCAL_MIN_FEE_PADDING)
  // Genesis test accounts are schnorr_initializerless — see createSigner.
  const aliceAccount = await wallet.createSchnorrInitializerlessAccount(
    aliceData.secret,
    aliceData.salt,
    aliceData.signingKey,
  )
  await wallet.registerSender(aliceAccount.address, 'alice')

  const bobAccount = await wallet.createSchnorrInitializerlessAccount(
    bobData.secret,
    bobData.salt,
    bobData.signingKey,
  )
  await wallet.registerSender(bobAccount.address, 'bob')

  onProgress?.({
    step: 'sponsored-fpc',
    message: 'Registering Sponsored FPC contract',
  })

  const { address: sponsoredFpcAddress, paymentMethod } = await setupSponsoredFpc(wallet)

  onProgress?.({
    step: 'dripper-deploy',
    message: 'Deploying Dripper contract',
  })

  const dripperDeploy = DripperContract.deploy(wallet)
  const dripperDeployResult = await dripperDeploy.send({
    from: aliceAccount.address,
    fee: { paymentMethod },
    wait: { timeout: waitTimeout },
  })
  const dripperAddress = dripperDeployResult.contract.address.toString()
  const dripper = await DripperContract.at(dripperDeployResult.contract.address, wallet)

  onProgress?.({
    step: 'token-deploy',
    message: 'Deploying Token contract (constructor_with_minter)',
    detail: { minter: dripperAddress },
  })

  const tokenDeploy = TokenContract.deployWithOpts(
    { wallet, method: 'constructor_with_minter' },
    DEFAULT_TOKEN_NAME,
    DEFAULT_TOKEN_SYMBOL,
    DEFAULT_TOKEN_DECIMALS,
    dripperDeployResult.contract.address,
    // auth_contract: the token's optional authorization hook, which must implement
    // Wonderland's own interface. Zero disables it. Do NOT pass the standard auth
    // registry here — it has no matching selector, so every transfer reverts.
    AztecAddress.ZERO,
  )
  const deployResult = await tokenDeploy.send({
    from: aliceAccount.address,
    fee: { paymentMethod },
    wait: { timeout: waitTimeout },
  })
  const tokenAddress = deployResult.contract.address.toString()

  onProgress?.({
    step: 'mint',
    message: `Dripping ${mintAmount} tokens privately to Alice via Dripper`,
    detail: { token: tokenAddress, dripper: dripperAddress },
  })

  const token = await TokenContract.at(deployResult.contract.address, wallet)
  await dripper.methods.drip_to_private(deployResult.contract.address, mintAmount).send({
    from: aliceAccount.address,
    fee: { paymentMethod },
    wait: { timeout: waitTimeout },
  })

  onProgress?.({
    step: 'verify-balance',
    message: 'Verifying Alice private balance',
  })

  const aliceMintedBalance = await readPrivateBalance(token, aliceAccount)

  return {
    nodeUrl,
    network: 'Local',
    alice,
    bob,
    aliceAccount,
    bobAccount,
    token: {
      address: tokenAddress,
      name: DEFAULT_TOKEN_NAME,
      symbol: DEFAULT_TOKEN_SYMBOL,
      decimals: DEFAULT_TOKEN_DECIMALS,
    },
    dripper: {
      address: dripperAddress,
    },
    sponsoredFpc: {
      address: sponsoredFpcAddress,
    },
    aliceMintedBalance,
    wallet,
    paymentMethod,
  }
}

export interface ReadPrivateBalancesOptions {
  nodeUrl?: string
  tokenAddress: string
}

export interface PrivateBalancesResult {
  nodeUrl: string
  tokenAddress: string
  alice: { address: string, balance: bigint }
  bob: { address: string, balance: bigint }
}

/**
 * Deploy local fixtures once per process. Both integration suites share one
 * sandbox; a second mint of the same shape collides on nullifiers when the
 * suites run back-to-back. Stored on globalThis so Vitest's per-file module
 * graph still sees a single promise.
 */
interface OvercastIntegrationGlobals {
  __fireflowOvercastLocalFixtures?: Promise<LocalAztecDeployResult>
}

export function getSharedLocalAztecFixtures(
  options: DeployLocalAztecFixturesOptions = {},
): Promise<LocalAztecDeployResult> {
  const globals = globalThis as typeof globalThis & OvercastIntegrationGlobals
  globals.__fireflowOvercastLocalFixtures ??= deployLocalAztecFixtures(options).catch((error) => {
    globals.__fireflowOvercastLocalFixtures = undefined
    throw error
  })
  return globals.__fireflowOvercastLocalFixtures
}

/**
 * Register an already-deployed token into a wallet's PXE (e.g. a fresh PXEWallet
 * that did not perform the original deploy).
 */
export async function registerDeployedTokenOnWallet(
  wallet: EmbeddedWallet,
  nodeUrl: string,
  tokenAddress: string,
): Promise<Awaited<ReturnType<typeof TokenContract.at>>> {
  return registerDeployedTokenContract(wallet, nodeUrl, tokenAddress)
}

/**
 * Register an already-deployed dripper into a wallet's PXE (e.g. a fresh PXEWallet
 * that did not perform the original deploy).
 */
export async function registerDeployedDripperOnWallet(
  wallet: EmbeddedWallet,
  nodeUrl: string,
  dripperAddress: string,
): Promise<Awaited<ReturnType<typeof DripperContract.at>>> {
  return registerDeployedDripperContract(wallet, nodeUrl, dripperAddress)
}

/**
 * Read private token balances for Alice and Bob test accounts.
 * Requires TOKEN_CONTRACT_ADDRESS from a prior deploy:local run.
 */
export async function readAliceBobPrivateBalances(
  options: ReadPrivateBalancesOptions,
): Promise<PrivateBalancesResult> {
  const nodeUrl = options.nodeUrl ?? process.env.AZTEC_NODE_URL ?? 'http://localhost:8080'
  const tokenAddress = options.tokenAddress.trim()
  if (!tokenAddress) {
    throw new Error('Token contract address is required (set TOKEN_CONTRACT_ADDRESS)')
  }

  const testAccounts = await getInitialTestAccountsData()
  const aliceData = testAccounts[0]
  const bobData = testAccounts[1]

  const wallet = await EmbeddedWalletClass.create(nodeUrl, { ephemeral: true })
  try {
    const aliceAccount = await wallet.createSchnorrInitializerlessAccount(
      aliceData.secret,
      aliceData.salt,
      aliceData.signingKey,
    )
    await wallet.registerSender(aliceAccount.address, 'alice')

    const bobAccount = await wallet.createSchnorrInitializerlessAccount(
      bobData.secret,
      bobData.salt,
      bobData.signingKey,
    )
    await wallet.registerSender(bobAccount.address, 'bob')

    const token = await registerDeployedTokenContract(wallet, nodeUrl, tokenAddress)
    const aliceBalance = await readPrivateBalance(token, aliceAccount)
    const bobBalance = await readPrivateBalance(token, bobAccount)

    return {
      nodeUrl,
      tokenAddress,
      alice: { address: aliceAccount.address.toString(), balance: aliceBalance },
      bob: { address: bobAccount.address.toString(), balance: bobBalance },
    }
  } finally {
    await wallet.stop()
  }
}
