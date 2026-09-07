/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Opt-in Testnet measurement for open question 4: can a freshly created,
 * undeployed schnorr_initializerless account submit a SponsoredFPC-paid
 * transfer? Run with:
 *   pnpm --filter @persistent-ai/fireflow-overcast measure:testnet-account
 *
 * Requires AZTEC_NODE_URL pointing at Testnet (or leave unset for the default
 * Testnet RPC). Sponsored FPC + a funded sender on Testnet are environment-
 * specific — set:
 *   TESTNET_TOKEN_ADDRESS
 *   TESTNET_SPONSORED_FPC_ADDRESS
 *   TESTNET_FUNDER_SECRET / TESTNET_FUNDER_SALT / TESTNET_FUNDER_SIGNING_KEY
 *   TESTNET_RECIPIENT_ADDRESS (optional; defaults to the funder)
 */

import process from 'node:process'
import { TokenContract } from '@aztec-foundation/aztec-standards/dist/src/artifacts/Token.js'
import AztecSmartContractNode from '../../nodes/contract/smart-contract.node'
import AztecGetFeePayerNode from '../../nodes/fee/get-fee-payer.node'
import AztecSubmitTransactionNode from '../../nodes/transaction/submit-transaction.node'
import AztecTransactionBuilderNode from '../../nodes/transaction/transaction-builder.node'
import { createSigner, deriveAccountAddress, generateAccountCredentials } from '../../utils/aztec-wallet'
import { clearAztecObjectCaches } from '../../utils/resolve-aztec'
import {
  bindSignerToWallet,
  executeParseArtifact,
  INTEGRATION_EXECUTION_ID,
  makeIntegrationContext,
  makeIntegrationVfs,
} from '../helpers/integration-context'
import { executeAccountSignerNode } from '../helpers/run-account-signer'
import '../../server.ts'

const NETWORK = 'Testnet' as const
const TRANSFER_AMOUNT = 1n

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required env ${name}`)
  }
  return value
}

async function main(): Promise<void> {
  console.log('Overcast Testnet — undeployed fresh-account fee-pay measurement (open question 4)')
  clearAztecObjectCaches()

  const tokenAddress = requireEnv('TESTNET_TOKEN_ADDRESS')
  const sponsoredFpcAddress = requireEnv('TESTNET_SPONSORED_FPC_ADDRESS')
  const funderSecret = requireEnv('TESTNET_FUNDER_SECRET')
  const funderSalt = requireEnv('TESTNET_FUNDER_SALT')
  const funderSigningKey = requireEnv('TESTNET_FUNDER_SIGNING_KEY')
  const recipientAddress = process.env.TESTNET_RECIPIENT_ADDRESS?.trim() || undefined

  const files = new Map<string, string>()
  const context = makeIntegrationContext(makeIntegrationVfs(files), INTEGRATION_EXECUTION_ID)

  console.log('\n[1/5] Generate fresh account credentials')
  const freshCredentials = generateAccountCredentials()
  const freshAddress = await deriveAccountAddress({
    network: NETWORK,
    secret: freshCredentials.secret,
    salt: freshCredentials.salt,
    signingKey: freshCredentials.signingKey,
  })
  console.log(`  address=${freshAddress}`)

  console.log('\n[2/5] Account Signer (fresh + funder)')
  const { node: freshSigner } = await executeAccountSignerNode({
    id: 'fresh',
    credentials: freshCredentials,
    address: freshAddress,
    network: NETWORK,
    executionId: INTEGRATION_EXECUTION_ID,
  })
  const freshLive = await createSigner({
    network: NETWORK,
    secret: freshCredentials.secret,
    salt: freshCredentials.salt,
    signingKey: freshCredentials.signingKey,
  })
  bindSignerToWallet(freshSigner, freshLive)
  console.log(`  fresh signer address=${freshSigner.address}`)

  const funderAddress = await deriveAccountAddress({
    network: NETWORK,
    secret: funderSecret,
    salt: funderSalt,
    signingKey: funderSigningKey,
  })
  const funderCredentials = {
    secret: funderSecret,
    salt: funderSalt,
    signingKey: funderSigningKey,
  }
  const { node: funderSigner } = await executeAccountSignerNode({
    id: 'funder',
    credentials: funderCredentials,
    address: funderAddress,
    network: NETWORK,
    discoverNotesFrom: [funderAddress],
    executionId: INTEGRATION_EXECUTION_ID,
  })
  const funderLive = await createSigner({
    network: NETWORK,
    ...funderCredentials,
    discoverNotesFrom: [funderAddress],
  })
  bindSignerToWallet(funderSigner, funderLive)
  console.log(`  funder address=${funderSigner.address}`)

  const payTo = recipientAddress ?? funderSigner.address

  console.log('\n[3/5] Bind token artifact')
  const artifactNode = await executeParseArtifact('artifact', TokenContract.artifact, context, files)

  const contractNode = new AztecSmartContractNode('contract')
  contractNode.initialize()
  contractNode.address = tokenAddress
  contractNode.network = NETWORK
  contractNode.artifact = artifactNode.artifact
  await contractNode.execute(context)

  console.log('\n[4/5] Get Fee Payer (SponsoredFPC) for fresh account — no deploy step')
  const feeNode = new AztecGetFeePayerNode('fee')
  feeNode.initialize()
  feeNode.method = 'SponsoredFPC'
  feeNode.fpcAddress = sponsoredFpcAddress
  await feeNode.execute(context)
  console.log(`  fee payer ready (FPC ${sponsoredFpcAddress})`)

  console.log('\n[5/5] Submit transfer_private_to_private from undeployed account')
  const builder = new AztecTransactionBuilderNode('builder')
  builder.initialize()
  builder.contract = contractNode.contract
  builder.signer = freshSigner.signer
  builder.method = 'transfer_private_to_private'
  builder.parameters = [
    freshSigner.address,
    payTo,
    TRANSFER_AMOUNT,
    0,
  ]
  builder.feePayer = feeNode.feePayer
  await builder.execute(context)

  const submit = new AztecSubmitTransactionNode('submit')
  submit.initialize()
  submit.transaction = builder.transaction
  submit.waitForConfirmation = true

  try {
    await submit.execute(context)
    console.log('\n  ✓ SUCCESS — undeployed account submitted a SponsoredFPC-paid tx')
    console.log(`    txHash=${submit.txHash}`)
    console.log('    Open question 4: no Deploy Aztec Account node needed on Testnet.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('\n  ✗ FAILED — undeployed account could not submit')
    console.error(`    ${message}`)
    console.error('    If the error names a missing publication / undeployed contract,')
    console.error('    open question 4 resolves toward building Deploy Aztec Account.')
    process.exitCode = 1
  } finally {
    clearAztecObjectCaches()
    await freshLive.wallet.stop()
    await funderLive.wallet.stop()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
