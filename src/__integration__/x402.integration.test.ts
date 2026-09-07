/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration test for the x402 commerce node pipeline against a local Aztec sandbox.
 * Run with: pnpm --filter @persistent-ai/fireflow-overcast test:integration
 */

import type { InitialAccountData } from '@aztec/accounts/testing'
import type { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee'
import type { EmbeddedWallet } from '@aztec/wallets/embedded'
import type AztecAccountSignerNode from '../nodes/account/account-signer.node'
import type { Signer } from '../shared/types'
import type { AppReturnValuesWallet } from './helpers/x402-facilitator-signer'
import type { X402TestServer } from './helpers/x402-test-server'
import { DripperContract } from '@aztec-foundation/aztec-standards/dist/src/artifacts/Dripper.js'
import { TokenContract } from '@aztec-foundation/aztec-standards/dist/src/artifacts/Token.js'
import { getInitialTestAccountsData } from '@aztec/accounts/testing'
import { createAztecNodeClient } from '@aztec/aztec.js/node'
import { AZTEC_NETWORKS } from '@galactica-net/x402-core'
import { ExactAztecFacilitatorScheme } from '@galactica-net/x402-mechanism/exact/facilitator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import AztecSmartContractNode from '../nodes/contract/smart-contract.node'
import AztecGetFeePayerNode from '../nodes/fee/get-fee-payer.node'
import AztecSimulateTransactionNode from '../nodes/transaction/simulate-transaction.node'
import AztecSubmitTransactionNode from '../nodes/transaction/submit-transaction.node'
import AztecTransactionBuilderNode from '../nodes/transaction/transaction-builder.node'
import BuildX402PaymentHeaderNode from '../nodes/x402/build-payment-header.node'
import ParseX402ChallengeNode from '../nodes/x402/parse-challenge.node'
import RequestX402ResourceNode from '../nodes/x402/request-resource.node'
import { ensureSponsoredFpcRegistered } from '../utils/aztec-fee'
import { createSigner } from '../utils/aztec-wallet'
import { clearAztecObjectCaches } from '../utils/resolve-aztec'
import {
  bindSignerToWallet,
  executeParseArtifact,
  INTEGRATION_EXECUTION_ID,
  makeIntegrationContext,
  makeIntegrationVfs,
} from './helpers/integration-context'
import {
  DEFAULT_WAIT_TIMEOUT,
  getSharedLocalAztecFixtures,
  normalizeSimulateResult,
  registerDeployedDripperOnWallet,
  registerDeployedTokenOnWallet,
} from './helpers/local-aztec-deploy'
import { executeAccountSignerNode } from './helpers/run-account-signer'
import { RealFacilitatorAztecSigner } from './helpers/x402-facilitator-signer'
import { startX402TestServer } from './helpers/x402-test-server'

const NODE_URL = process.env.AZTEC_NODE_URL ?? 'http://localhost:8080'
const PAYMENT_AMOUNT = '100'
const DRIP_AMOUNT = 25n
const WAIT_TIMEOUT = DEFAULT_WAIT_TIMEOUT

function fieldToInput(value: { toString: () => string }): string {
  return value.toString()
}

async function runAccountSignerNode(
  id: string,
  accountData: InitialAccountData,
  discoverNotesFrom: string[] = [],
): Promise<{ node: AztecAccountSignerNode, live: Signer }> {
  const credentials = {
    secret: fieldToInput(accountData.secret),
    salt: fieldToInput(accountData.salt),
    signingKey: fieldToInput(accountData.signingKey),
  }
  const { node } = await executeAccountSignerNode({
    id,
    credentials,
    address: accountData.address.toString(),
    discoverNotesFrom,
    executionId: INTEGRATION_EXECUTION_ID,
  })
  const live = await createSigner({
    network: 'Local',
    ...credentials,
    discoverNotesFrom,
    usePXEWallet: true,
  })
  bindSignerToWallet(node, live)
  return { node, live }
}

async function readPrivateBalance(
  aliceSignerNode: AztecAccountSignerNode,
  tokenAddress: string,
  sponsoredFpcAddress: string,
  context: ReturnType<typeof makeIntegrationContext>,
  files: Map<string, string>,
): Promise<bigint> {
  const artifactNode = await executeParseArtifact('balance-artifact', TokenContract.artifact, context, files)

  const contractNode = new AztecSmartContractNode('balance-contract')
  contractNode.initialize()
  contractNode.address = tokenAddress
  contractNode.network = 'Local'
  contractNode.artifact = artifactNode.artifact
  await contractNode.execute(context)

  const feeNode = new AztecGetFeePayerNode('balance-fee')
  feeNode.initialize()
  feeNode.method = 'SponsoredFPC'
  feeNode.fpcAddress = sponsoredFpcAddress
  await feeNode.execute(context)

  const builderNode = new AztecTransactionBuilderNode('balance-builder')
  builderNode.initialize()
  builderNode.contract = contractNode.contract
  builderNode.signer = aliceSignerNode.signer
  builderNode.method = 'balance_of_private'
  builderNode.parameters = [aliceSignerNode.address]
  builderNode.feePayer = feeNode.feePayer
  await builderNode.execute(context)

  const simulateNode = new AztecSimulateTransactionNode('balance-simulate')
  simulateNode.initialize()
  simulateNode.transaction = builderNode.transaction
  await simulateNode.execute(context)

  return normalizeSimulateResult(simulateNode.result)
}

describe('x402 integration', () => {
  let aliceData: InitialAccountData
  let bobData: InitialAccountData
  let aliceSignerNode: AztecAccountSignerNode
  let bobSignerNode: AztecAccountSignerNode
  let aliceLive: Signer
  let bobLive: Signer
  let sponsoredFpcAddress: string
  let paymentMethod: SponsoredFeePaymentMethod
  let tokenAddress: string
  let dripperAddress: string
  let sharedWallet: EmbeddedWallet
  let x402Server: X402TestServer
  let files: Map<string, string>
  let context: ReturnType<typeof makeIntegrationContext>

  beforeAll(async () => {
    clearAztecObjectCaches()
    const testAccounts = await getInitialTestAccountsData()
    aliceData = testAccounts[0]
    bobData = testAccounts[1]

    const fixtures = await getSharedLocalAztecFixtures({ nodeUrl: NODE_URL })
    sponsoredFpcAddress = fixtures.sponsoredFpc.address
    paymentMethod = fixtures.paymentMethod
    tokenAddress = fixtures.token.address
    dripperAddress = fixtures.dripper.address

    files = new Map()
    context = makeIntegrationContext(makeIntegrationVfs(files))

    const alice = await runAccountSignerNode(
      'x402-alice',
      aliceData,
      [aliceData.address.toString()],
    )
    aliceSignerNode = alice.node
    aliceLive = alice.live
    sharedWallet = aliceLive.wallet

    const bobAccount = await sharedWallet.createSchnorrInitializerlessAccount(
      bobData.secret,
      bobData.salt,
      bobData.signingKey,
    )
    const bob = await runAccountSignerNode(
      'x402-bob',
      bobData,
      [bobData.address.toString()],
    )
    bobSignerNode = bob.node
    bobLive = bob.live
    bindSignerToWallet(bobSignerNode, {
      wallet: sharedWallet,
      account: bobAccount,
      address: bobAccount.address,
      nodeUrl: NODE_URL,
    })

    await ensureSponsoredFpcRegistered({
      wallet: sharedWallet,
      nodeUrl: NODE_URL,
      fpcAddress: sponsoredFpcAddress,
    })
    const boundToken = await registerDeployedTokenOnWallet(sharedWallet, NODE_URL, tokenAddress)
    await registerDeployedDripperOnWallet(sharedWallet, NODE_URL, dripperAddress)

    await sharedWallet.registerSender(bobLive.address, 'bob-server')
    await sharedWallet.registerSender(aliceLive.address, 'alice-payer')

    const node = createAztecNodeClient(NODE_URL)
    const facilitatorSigner = new RealFacilitatorAztecSigner(
      bobAccount,
      node,
      boundToken,
      { fee: { paymentMethod } },
      sharedWallet as unknown as AppReturnValuesWallet,
    )
    const facilitator = new ExactAztecFacilitatorScheme(facilitatorSigner, [AZTEC_NETWORKS.SANDBOX])
    await facilitator.initialize()

    x402Server = await startX402TestServer({
      network: AZTEC_NETWORKS.SANDBOX,
      tokenAddress,
      serverAddress: bobLive.address.toString(),
      priceAmount: PAYMENT_AMOUNT,
      facilitator,
    })
  }, WAIT_TIMEOUT * 1000)

  afterAll(async () => {
    clearAztecObjectCaches()
    await x402Server?.stop()
    await sharedWallet?.stop()
  })

  it('returns a prepared x402 challenge from the gated resource', async () => {
    const resourceUrl = `${x402Server.url}/api/resource/test-resource`

    const initialRequest = new RequestX402ResourceNode('x402-request-initial')
    initialRequest.initialize()
    initialRequest.url = resourceUrl
    initialRequest.method = 'GET'
    initialRequest.signer = aliceSignerNode.signer
    await initialRequest.execute(context)

    expect(initialRequest.response?.status).toBe(402)
    expect(initialRequest.response?.challenge?.commitment).toBeTruthy()
    expect(initialRequest.response?.challenge?.prepareTxHash).toBeTruthy()
  })

  it('drips tokens via Dripper with Token registered as a sub-contract', async () => {
    const balanceBefore = await readPrivateBalance(
      aliceSignerNode,
      tokenAddress,
      sponsoredFpcAddress,
      context,
      files,
    )

    const dripperArtifact = await executeParseArtifact('dripper-artifact', DripperContract.artifact, context, files)
    const tokenArtifact = await executeParseArtifact('token-sub-artifact', TokenContract.artifact, context, files)

    const dripperNode = new AztecSmartContractNode('dripper-contract')
    dripperNode.initialize()
    dripperNode.address = dripperAddress
    dripperNode.network = 'Local'
    dripperNode.artifact = dripperArtifact.artifact
    await dripperNode.execute(context)

    const tokenNode = new AztecSmartContractNode('token-sub-contract')
    tokenNode.initialize()
    tokenNode.address = tokenAddress
    tokenNode.network = 'Local'
    tokenNode.artifact = tokenArtifact.artifact
    await tokenNode.execute(context)

    const feeNode = new AztecGetFeePayerNode('dripper-fee')
    feeNode.initialize()
    feeNode.method = 'SponsoredFPC'
    feeNode.fpcAddress = sponsoredFpcAddress
    await feeNode.execute(context)

    const builderNode = new AztecTransactionBuilderNode('dripper-builder')
    builderNode.initialize()
    builderNode.contract = dripperNode.contract
    builderNode.subContracts = [tokenNode.contract!]
    builderNode.signer = aliceSignerNode.signer
    builderNode.method = 'drip_to_private'
    builderNode.parameters = [tokenAddress, DRIP_AMOUNT]
    builderNode.feePayer = feeNode.feePayer
    await builderNode.execute(context)

    const submitNode = new AztecSubmitTransactionNode('dripper-submit')
    submitNode.initialize()
    submitNode.transaction = builderNode.transaction
    submitNode.waitForConfirmation = true
    await submitNode.execute(context)

    expect(submitNode.txHash).toBeTruthy()
    expect(submitNode.receipt).toBeTruthy()

    const balanceAfter = await readPrivateBalance(
      aliceSignerNode,
      tokenAddress,
      sponsoredFpcAddress,
      context,
      files,
    )
    expect(balanceAfter).toBe(balanceBefore + DRIP_AMOUNT)
  }, WAIT_TIMEOUT * 1000)

  it('pays for a gated resource via the x402 node pipeline', async () => {
    const resourceUrl = `${x402Server.url}/api/resource/test-resource`
    const balanceBefore = await readPrivateBalance(
      aliceSignerNode,
      tokenAddress,
      sponsoredFpcAddress,
      context,
      files,
    )

    const initialRequest = new RequestX402ResourceNode('x402-request-initial')
    initialRequest.initialize()
    initialRequest.url = resourceUrl
    initialRequest.method = 'GET'
    initialRequest.signer = aliceSignerNode.signer
    await initialRequest.execute(context)

    expect(initialRequest.response?.status).toBe(402)
    expect(initialRequest.response?.challenge?.commitment).toBeTruthy()

    const tokenArtifact = await executeParseArtifact('x402-token-artifact', TokenContract.artifact, context, files)
    const contractNode = new AztecSmartContractNode('x402-contract')
    contractNode.initialize()
    contractNode.address = tokenAddress
    contractNode.network = 'Local'
    contractNode.artifact = tokenArtifact.artifact
    await contractNode.execute(context)

    const parseNode = new ParseX402ChallengeNode('x402-parse')
    parseNode.initialize()
    parseNode.x402Response = initialRequest.response
    parseNode.signer = aliceSignerNode.signer
    parseNode.contract = contractNode.contract
    parseNode.maxAmount = PAYMENT_AMOUNT
    await parseNode.execute(context)

    expect(parseNode.method).toBe('transfer_private_to_commitment')
    expect(parseNode.parameters.length).toBe(4)
    expect(parseNode.paymentContext).toBeTruthy()

    const feeNode = new AztecGetFeePayerNode('x402-fee')
    feeNode.initialize()
    feeNode.method = 'SponsoredFPC'
    feeNode.fpcAddress = sponsoredFpcAddress
    await feeNode.execute(context)

    const builderNode = new AztecTransactionBuilderNode('x402-builder')
    builderNode.initialize()
    builderNode.contract = contractNode.contract
    builderNode.signer = aliceSignerNode.signer
    builderNode.method = parseNode.method
    builderNode.parameters = parseNode.parameters
    builderNode.feePayer = feeNode.feePayer
    await builderNode.execute(context)

    const submitNode = new AztecSubmitTransactionNode('x402-submit')
    submitNode.initialize()
    submitNode.transaction = builderNode.transaction
    submitNode.waitForConfirmation = true
    await submitNode.execute(context)

    expect(submitNode.txHash).toBeTruthy()
    expect(submitNode.receipt).toBeTruthy()

    const headerNode = new BuildX402PaymentHeaderNode('x402-header')
    headerNode.initialize()
    headerNode.txHash = submitNode.txHash
    headerNode.receipt = submitNode.receipt
    headerNode.paymentContext = parseNode.paymentContext
    await headerNode.execute(context)

    expect(headerNode.paymentHeader?.name).toBe('PAYMENT-SIGNATURE')

    const finalRequest = new RequestX402ResourceNode('x402-request-final')
    finalRequest.initialize()
    finalRequest.url = resourceUrl
    finalRequest.method = 'GET'
    finalRequest.headers = headerNode.paymentHeader ? [headerNode.paymentHeader] : []
    await finalRequest.execute(context)

    expect(finalRequest.response?.status).toBe(200)
    expect(finalRequest.response?.body).toMatchObject({
      paid: true,
      message: 'resource delivered',
    })

    const balanceAfter = await readPrivateBalance(
      aliceSignerNode,
      tokenAddress,
      sponsoredFpcAddress,
      context,
      files,
    )
    expect(balanceAfter).toBe(balanceBefore - BigInt(PAYMENT_AMOUNT))
  }, WAIT_TIMEOUT * 1000)
})
