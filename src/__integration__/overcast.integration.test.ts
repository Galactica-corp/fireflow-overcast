/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration test against a local Aztec sandbox (http://localhost:8080).
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
import { clearAztecObjectCaches } from '../utils/resolve-aztec'
import {
  bindSignerToWallet,
  executeParseArtifact,
  INTEGRATION_EXECUTION_ID,
  makeIntegrationContext,
  makeIntegrationVfs,
} from './helpers/integration-context'
import { DEFAULT_MINT_AMOUNT, DEFAULT_WAIT_TIMEOUT, getSharedLocalAztecFixtures } from './helpers/local-aztec-deploy'
import { executeAccountSignerNode } from './helpers/run-account-signer'

const NODE_URL = process.env.AZTEC_NODE_URL ?? 'http://localhost:8080'
const MINT_AMOUNT = DEFAULT_MINT_AMOUNT
const TRANSFER_AMOUNT = 250n
const WAIT_TIMEOUT = DEFAULT_WAIT_TIMEOUT

function fieldToInput(value: { toString: () => string }): string {
  return value.toString()
}

async function runAccountSignerNode(
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

describe('overcast integration', () => {
  let aliceData: InitialAccountData
  let bobData: InitialAccountData
  let aliceSignerNode: AztecAccountSignerNode
  let bobSignerNode: AztecAccountSignerNode
  let sponsoredFpcAddress: string
  let tokenAddress: string
  let sharedWallet: EmbeddedWallet
  let files: Map<string, string>
  let context: ReturnType<typeof makeIntegrationContext>

  beforeAll(async () => {
    clearAztecObjectCaches()
    const testAccounts = await getInitialTestAccountsData()
    aliceData = testAccounts[0]
    bobData = testAccounts[1]

    const fixtures = await getSharedLocalAztecFixtures({ nodeUrl: NODE_URL })
    sharedWallet = fixtures.wallet
    sponsoredFpcAddress = fixtures.sponsoredFpc.address
    tokenAddress = fixtures.token.address

    files = new Map()
    context = makeIntegrationContext(makeIntegrationVfs(files))

    aliceSignerNode = await runAccountSignerNode(
      'setup-alice',
      aliceData,
      [aliceData.address.toString()],
    )
    bindSignerToWallet(aliceSignerNode, {
      wallet: sharedWallet,
      account: fixtures.aliceAccount,
      address: fixtures.aliceAccount.address,
      nodeUrl: NODE_URL,
    } satisfies Signer)

    bobSignerNode = await runAccountSignerNode(
      'setup-bob',
      bobData,
      [bobData.address.toString()],
    )
    bindSignerToWallet(bobSignerNode, {
      wallet: sharedWallet,
      account: fixtures.bobAccount,
      address: fixtures.bobAccount.address,
      nodeUrl: NODE_URL,
    } satisfies Signer)
  }, WAIT_TIMEOUT * 1000)

  afterAll(async () => {
    clearAztecObjectCaches()
    await sharedWallet?.stop()
  })

  it('account Signer loads alice with note discovery', async () => {
    expect(aliceSignerNode.address).toBe(aliceData.address.toString())
    expect(aliceSignerNode.signer).toBeTruthy()
    expect(aliceSignerNode.discoverNotesFrom).toContain(aliceData.address.toString())
  })

  it('reads alice private balance via builder + simulate', async () => {
    const artifactNode = await executeParseArtifact('artifact', TokenContract.artifact, context, files)

    const contractNode = new AztecSmartContractNode('contract')
    contractNode.initialize()
    contractNode.address = tokenAddress
    contractNode.network = 'Local'
    contractNode.artifact = artifactNode.artifact
    await contractNode.execute(context)

    const feeNode = new AztecGetFeePayerNode('fee')
    feeNode.initialize()
    feeNode.method = 'SponsoredFPC'
    feeNode.fpcAddress = sponsoredFpcAddress
    await feeNode.execute(context)

    const builderNode = new AztecTransactionBuilderNode('builder-balance')
    builderNode.initialize()
    builderNode.contract = contractNode.contract
    builderNode.signer = aliceSignerNode.signer
    builderNode.method = 'balance_of_private'
    builderNode.parameters = [aliceSignerNode.address]
    builderNode.feePayer = feeNode.feePayer
    await builderNode.execute(context)

    const simulateNode = new AztecSimulateTransactionNode('simulate-balance')
    simulateNode.initialize()
    simulateNode.transaction = builderNode.transaction
    await simulateNode.execute(context)

    expect(simulateNode.result).toBe(String(MINT_AMOUNT))
  })

  it('transfers tokens from alice to bob via builder + submit', async () => {
    const artifactNode = await executeParseArtifact('artifact-transfer', TokenContract.artifact, context, files)

    const contractNode = new AztecSmartContractNode('contract-transfer')
    contractNode.initialize()
    contractNode.address = tokenAddress
    contractNode.network = 'Local'
    contractNode.artifact = artifactNode.artifact
    await contractNode.execute(context)

    const feeNode = new AztecGetFeePayerNode('fee-transfer')
    feeNode.initialize()
    feeNode.method = 'SponsoredFPC'
    feeNode.fpcAddress = sponsoredFpcAddress
    await feeNode.execute(context)

    const builderNode = new AztecTransactionBuilderNode('builder-transfer')
    builderNode.initialize()
    builderNode.contract = contractNode.contract
    builderNode.signer = aliceSignerNode.signer
    builderNode.method = 'transfer_private_to_private'
    builderNode.parameters = [
      aliceSignerNode.address,
      bobSignerNode.address,
      TRANSFER_AMOUNT,
      0,
    ]
    builderNode.feePayer = feeNode.feePayer
    await builderNode.execute(context)

    const submitNode = new AztecSubmitTransactionNode('submit-transfer')
    submitNode.initialize()
    submitNode.transaction = builderNode.transaction
    submitNode.waitForConfirmation = true
    await submitNode.execute(context)

    expect(submitNode.txHash).toBeTruthy()
    expect(submitNode.receipt).toBeTruthy()

    const bobArtifactNode = await executeParseArtifact(
      'artifact-bob-balance',
      TokenContract.artifact,
      context,
      files,
    )

    const bobContractNode = new AztecSmartContractNode('contract-bob-balance')
    bobContractNode.initialize()
    bobContractNode.address = tokenAddress
    bobContractNode.network = 'Local'
    bobContractNode.artifact = bobArtifactNode.artifact
    await bobContractNode.execute(context)

    const bobBuilder = new AztecTransactionBuilderNode('builder-bob-balance')
    bobBuilder.initialize()
    bobBuilder.contract = bobContractNode.contract
    bobBuilder.signer = bobSignerNode.signer
    bobBuilder.method = 'balance_of_private'
    bobBuilder.parameters = [bobSignerNode.address]
    await bobBuilder.execute(context)

    const bobSimulate = new AztecSimulateTransactionNode('simulate-bob-balance')
    bobSimulate.initialize()
    bobSimulate.transaction = bobBuilder.transaction
    await bobSimulate.execute(context)

    expect(bobSimulate.result).toBe(String(TRANSFER_AMOUNT))

    const aliceBuilder = new AztecTransactionBuilderNode('builder-alice-after')
    aliceBuilder.initialize()
    aliceBuilder.contract = contractNode.contract
    aliceBuilder.signer = aliceSignerNode.signer
    aliceBuilder.method = 'balance_of_private'
    aliceBuilder.parameters = [aliceSignerNode.address]
    await aliceBuilder.execute(context)

    const aliceSimulate = new AztecSimulateTransactionNode('simulate-alice-after')
    aliceSimulate.initialize()
    aliceSimulate.transaction = aliceBuilder.transaction
    await aliceSimulate.execute(context)

    expect(aliceSimulate.result).toBe(String(MINT_AMOUNT - TRANSFER_AMOUNT))
  })
})
