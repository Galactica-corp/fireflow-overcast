/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fresh Aztec account integration — address determinism, receive, and the
 * undeployed-account fee-paying measurement that decides open question 4.
 * Run with: pnpm --filter @persistent-ai/fireflow-overcast test:integration
 */

import type { InitialAccountData } from '@aztec/accounts/testing'
import type { EmbeddedWallet } from '@aztec/wallets/embedded'
import type AztecAccountSignerNode from '../nodes/account/account-signer.node'
import type { Signer } from '../shared/types'
import { TokenContract } from '@aztec-foundation/aztec-standards/dist/src/artifacts/Token.js'
import { getInitialTestAccountsData } from '@aztec/accounts/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import AztecSmartContractNode from '../nodes/contract/smart-contract.node'
import AztecGetFeePayerNode from '../nodes/fee/get-fee-payer.node'
import AztecSimulateTransactionNode from '../nodes/transaction/simulate-transaction.node'
import AztecSubmitTransactionNode from '../nodes/transaction/submit-transaction.node'
import AztecTransactionBuilderNode from '../nodes/transaction/transaction-builder.node'
import { createSigner, deriveAccountAddress, generateAccountCredentials } from '../utils/aztec-wallet'
import { clearAztecObjectCaches } from '../utils/resolve-aztec'
import {
  bindSignerToWallet,
  executeParseArtifact,
  INTEGRATION_EXECUTION_ID,
  makeIntegrationContext,
  makeIntegrationVfs,
} from './helpers/integration-context'
import { DEFAULT_WAIT_TIMEOUT, getSharedLocalAztecFixtures } from './helpers/local-aztec-deploy'
import { executeAccountSignerNode } from './helpers/run-account-signer'

const NODE_URL = process.env.AZTEC_NODE_URL ?? 'http://localhost:8080'
const FUND_AMOUNT = 100n
const RETURN_AMOUNT = 25n
const WAIT_TIMEOUT = DEFAULT_WAIT_TIMEOUT

function fieldToInput(value: { toString: () => string }): string {
  return value.toString()
}

async function runGenesisSignerNode(
  id: string,
  accountData: InitialAccountData,
  discoverNotesFrom: string[] = [],
): Promise<AztecAccountSignerNode> {
  const { node } = await executeAccountSignerNode({
    id,
    credentials: {
      secret: fieldToInput(accountData.secret),
      salt: fieldToInput(accountData.salt),
      signingKey: fieldToInput(accountData.signingKey),
    },
    address: accountData.address.toString(),
    discoverNotesFrom,
    executionId: INTEGRATION_EXECUTION_ID,
  })
  return node
}

async function runFreshSignerNode(
  id: string,
  discoverNotesFrom: string[] = [],
): Promise<{ node: AztecAccountSignerNode, address: string, live: Signer }> {
  const credentials = generateAccountCredentials()
  const address = await deriveAccountAddress({
    network: 'Local',
    secret: credentials.secret,
    salt: credentials.salt,
    signingKey: credentials.signingKey,
  })
  const { node } = await executeAccountSignerNode({
    id,
    credentials,
    address,
    discoverNotesFrom,
    executionId: INTEGRATION_EXECUTION_ID,
  })
  const live = await createSigner({
    network: 'Local',
    secret: credentials.secret,
    salt: credentials.salt,
    signingKey: credentials.signingKey,
    discoverNotesFrom,
  })
  bindSignerToWallet(node, live)
  return { node, address, live }
}

describe('fresh aztec account integration', () => {
  let aliceData: InitialAccountData
  let aliceSignerNode: AztecAccountSignerNode
  let sponsoredFpcAddress: string
  let tokenAddress: string
  let sharedWallet: EmbeddedWallet
  let bobAddress: string
  let files: Map<string, string>
  let context: ReturnType<typeof makeIntegrationContext>

  beforeAll(async () => {
    clearAztecObjectCaches()
    const testAccounts = await getInitialTestAccountsData()
    aliceData = testAccounts[0]
    bobAddress = testAccounts[1].address.toString()

    const fixtures = await getSharedLocalAztecFixtures({ nodeUrl: NODE_URL })
    sharedWallet = fixtures.wallet
    sponsoredFpcAddress = fixtures.sponsoredFpc.address
    tokenAddress = fixtures.token.address

    files = new Map()
    context = makeIntegrationContext(makeIntegrationVfs(files))

    aliceSignerNode = await runGenesisSignerNode(
      'create-acct-alice',
      aliceData,
      [aliceData.address.toString()],
    )
    bindSignerToWallet(aliceSignerNode, {
      wallet: sharedWallet,
      account: fixtures.aliceAccount,
      address: fixtures.aliceAccount.address,
      nodeUrl: NODE_URL,
    } satisfies Signer)
  }, WAIT_TIMEOUT * 1000)

  afterAll(async () => {
    clearAztecObjectCaches()
    await sharedWallet?.stop()
  })

  it('address determinism: signer address equals deriveAccountAddress from the same credentials', async () => {
    const { node, address, live } = await runFreshSignerNode('signer-det')

    expect(node.address).toBe(address)
    expect(node.signer).toBeTruthy()
    expect(live.address.toString()).toBe(address)

    await live.wallet.stop()
  }, WAIT_TIMEOUT * 1000)

  it('a fresh account can receive a private transfer and read its balance', async () => {
    const { node: freshSigner, live } = await runFreshSignerNode(
      'fresh-recv',
      [aliceSignerNode.address],
    )

    const artifactNode = await executeParseArtifact('artifact-recv', TokenContract.artifact, context, files)

    const contractNode = new AztecSmartContractNode('contract-recv')
    contractNode.initialize()
    contractNode.address = tokenAddress
    contractNode.network = 'Local'
    contractNode.artifact = artifactNode.artifact
    await contractNode.execute(context)

    const feeNode = new AztecGetFeePayerNode('fee-recv')
    feeNode.initialize()
    feeNode.method = 'SponsoredFPC'
    feeNode.fpcAddress = sponsoredFpcAddress
    await feeNode.execute(context)

    const transferBuilder = new AztecTransactionBuilderNode('builder-fund')
    transferBuilder.initialize()
    transferBuilder.contract = contractNode.contract
    transferBuilder.signer = aliceSignerNode.signer
    transferBuilder.method = 'transfer_private_to_private'
    transferBuilder.parameters = [
      aliceSignerNode.address,
      freshSigner.address,
      FUND_AMOUNT,
      0,
    ]
    transferBuilder.feePayer = feeNode.feePayer
    await transferBuilder.execute(context)

    const submitFund = new AztecSubmitTransactionNode('submit-fund')
    submitFund.initialize()
    submitFund.transaction = transferBuilder.transaction
    submitFund.waitForConfirmation = true
    await submitFund.execute(context)
    expect(submitFund.txHash).toBeTruthy()

    const balanceBuilder = new AztecTransactionBuilderNode('builder-fresh-bal')
    balanceBuilder.initialize()
    balanceBuilder.contract = contractNode.contract
    balanceBuilder.signer = freshSigner.signer
    balanceBuilder.method = 'balance_of_private'
    balanceBuilder.parameters = [freshSigner.address]
    await balanceBuilder.execute(context)

    const simulateBal = new AztecSimulateTransactionNode('sim-fresh-bal')
    simulateBal.initialize()
    simulateBal.transaction = balanceBuilder.transaction
    await simulateBal.execute(context)

    expect(simulateBal.result).toBe(String(FUND_AMOUNT))

    await live.wallet.stop()
  }, WAIT_TIMEOUT * 1000)

  it('undeployed fresh account can fee-pay via SponsoredFPC (open question 4)', async () => {
    const { node: freshSigner, live } = await runFreshSignerNode(
      'fresh-send',
      [aliceSignerNode.address],
    )

    const artifactNode = await executeParseArtifact('artifact-send', TokenContract.artifact, context, files)

    const contractNode = new AztecSmartContractNode('contract-send')
    contractNode.initialize()
    contractNode.address = tokenAddress
    contractNode.network = 'Local'
    contractNode.artifact = artifactNode.artifact
    await contractNode.execute(context)

    const aliceFee = new AztecGetFeePayerNode('fee-alice-fund')
    aliceFee.initialize()
    aliceFee.method = 'SponsoredFPC'
    aliceFee.fpcAddress = sponsoredFpcAddress
    await aliceFee.execute(context)

    const fundBuilder = new AztecTransactionBuilderNode('builder-fund-send')
    fundBuilder.initialize()
    fundBuilder.contract = contractNode.contract
    fundBuilder.signer = aliceSignerNode.signer
    fundBuilder.method = 'transfer_private_to_private'
    fundBuilder.parameters = [
      aliceSignerNode.address,
      freshSigner.address,
      FUND_AMOUNT,
      0,
    ]
    fundBuilder.feePayer = aliceFee.feePayer
    await fundBuilder.execute(context)

    const submitFund = new AztecSubmitTransactionNode('submit-fund-send')
    submitFund.initialize()
    submitFund.transaction = fundBuilder.transaction
    submitFund.waitForConfirmation = true
    await submitFund.execute(context)

    const freshFee = new AztecGetFeePayerNode('fee-fresh')
    freshFee.initialize()
    freshFee.method = 'SponsoredFPC'
    freshFee.fpcAddress = sponsoredFpcAddress
    await freshFee.execute(context)

    const sendBuilder = new AztecTransactionBuilderNode('builder-fresh-send')
    sendBuilder.initialize()
    sendBuilder.contract = contractNode.contract
    sendBuilder.signer = freshSigner.signer
    sendBuilder.method = 'transfer_private_to_private'
    sendBuilder.parameters = [
      freshSigner.address,
      bobAddress,
      RETURN_AMOUNT,
      0,
    ]
    sendBuilder.feePayer = freshFee.feePayer
    await sendBuilder.execute(context)

    const submitSend = new AztecSubmitTransactionNode('submit-fresh-send')
    submitSend.initialize()
    submitSend.transaction = sendBuilder.transaction
    submitSend.waitForConfirmation = true
    await submitSend.execute(context)

    expect(submitSend.txHash).toBeTruthy()
    expect(submitSend.receipt).toBeTruthy()

    await live.wallet.stop()
  }, WAIT_TIMEOUT * 1000)
})
