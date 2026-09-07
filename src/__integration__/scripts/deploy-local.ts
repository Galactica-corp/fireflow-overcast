/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deploy local Aztec fixtures for manual Overcast node testing in the FireFlow UI.
 * Run with: pnpm --filter @persistent-ai/fireflow-overcast deploy:local
 */

import type { AccountCredentials, LocalAztecDeployResult } from '../helpers/local-aztec-deploy'
import process from 'node:process'
import { createAztecNodeClient } from '@aztec/aztec.js/node'
import {

  DEFAULT_MINT_AMOUNT,
  deployLocalAztecFixtures,

} from '../helpers/local-aztec-deploy'

const NODE_URL = process.env.AZTEC_NODE_URL ?? 'http://localhost:8080'

const STEP_LABELS: Record<string, string> = {
  'accounts': 'Load test accounts (Alice + Bob)',
  'sponsored-fpc': 'Register Sponsored FPC',
  'dripper-deploy': 'Deploy Dripper contract',
  'token-deploy': 'Deploy Token contract (Dripper as minter)',
  'mint': 'Drip tokens to Alice',
  'verify-balance': 'Verify Alice balance',
}

let stepCounter = 0
const TOTAL_STEPS = 7

function logStep(message: string): void {
  stepCounter += 1
  console.log(`\n[${stepCounter}/${TOTAL_STEPS}] ${message}`)
}

function logOk(message: string): void {
  console.log(`  ✓ ${message}`)
}

function logDetail(key: string, value: string): void {
  console.log(`    ${key}: ${value}`)
}

function printAccount(label: string, account: AccountCredentials): void {
  console.log(`\n  ${label}`)
  console.log(`    Address:           ${account.address}`)
  console.log(`    Secret:            ${account.secret}`)
  console.log(`    Salt:              ${account.salt}`)
  console.log(`    Signing Key:       ${account.signingKey}`)
  console.log(`    Discover Notes From: ["${account.address}"]`)
}

function printSummary(result: LocalAztecDeployResult): void {
  const line = '═'.repeat(72)
  console.log(`\n${line}`)
  console.log('  FireFlow UI configuration')
  console.log(line)

  console.log('\n  Network / infrastructure')
  console.log(`    AZTEC_NODE_URL:    ${result.nodeUrl}`)
  console.log(`    Network:           ${result.network}`)

  console.log('\n  Token contract (Parse Contract Artifact → Aztec Smart Contract)')
  console.log(`    Address:           ${result.token.address}`)
  console.log(`    Name:              ${result.token.name}`)
  console.log(`    Symbol:            ${result.token.symbol}`)
  console.log(`    Decimals:          ${result.token.decimals}`)
  console.log('    Artifact file:     write JSON.stringify(TokenContract.artifact)')
  console.log('                       to a workspace path, then wire Parse Artifact')
  console.log('                       workspaceId / branch / path (not a JSON port)')

  console.log('\n  Dripper contract (minter — use as primary + Token as Sub Contracts)')
  console.log(`    Address:           ${result.dripper.address}`)
  console.log('    Artifact file:     write JSON.stringify(DripperContract.artifact)')
  console.log('                       to a workspace path, then wire Parse Artifact')

  console.log('\n  Get Fee Payer')
  console.log('    Method:            SponsoredFPC')
  console.log(`    FPC Address:       ${result.sponsoredFpc.address}`)
  console.log('    (no Signer input — fee strategy is data only)')

  printAccount('Alice (payer) — Aztec Account Signer', result.alice)
  printAccount('Bob (recipient) — Aztec Account Signer', result.bob)

  console.log('\n  Balances')
  console.log(`    Alice private balance: ${result.aliceMintedBalance.toString()}`)

  console.log(`\n${line}`)
  console.log('  Suggested test flow')
  console.log('    1. Simulate balance_of_private for Alice (expect minted amount)')
  console.log('    2. Submit drip_to_private on Dripper with Token as Sub Contract')
  console.log('    3. Submit transfer_private_to_private from Alice to Bob')
  console.log('    4. Simulate balances for Alice and Bob')
  console.log(line)
  console.log('')
}

async function checkAztecNodeConnectivity(nodeUrl: string): Promise<void> {
  logStep(`Connecting to Aztec node at ${nodeUrl}`)
  try {
    const node = createAztecNodeClient(nodeUrl)
    const version = await node.getVersion()
    logOk(`Connected (Aztec node version: ${version})`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\n  ✗ Cannot reach Aztec node at ${nodeUrl}`)
    console.error(`    ${message}`)
    console.error('\n  Start a local Aztec sandbox before running this script.')
    process.exit(1)
  }
}

async function main(): Promise<void> {
  console.log('Overcast local deploy — setting up Aztec test fixtures')

  const mintAmount = process.env.MINT_AMOUNT
    ? BigInt(process.env.MINT_AMOUNT)
    : DEFAULT_MINT_AMOUNT

  if (process.env.MINT_AMOUNT) {
    console.log(`  MINT_AMOUNT override: ${mintAmount}`)
  }

  await checkAztecNodeConnectivity(NODE_URL)

  let result: LocalAztecDeployResult
  try {
    result = await deployLocalAztecFixtures({
      nodeUrl: NODE_URL,
      mintAmount,
      onProgress: (progress) => {
        const label = STEP_LABELS[progress.step] ?? progress.message
        logStep(label)
        logOk(progress.message)
        if (progress.detail) {
          for (const [key, value] of Object.entries(progress.detail)) {
            logDetail(key, value)
          }
        }
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\n  ✗ Deployment failed: ${message}`)
    process.exit(1)
  }

  printSummary(result)

  await result.wallet.stop()
  logStep('Done')
  logOk('Local Aztec fixtures are ready for FireFlow UI testing')
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\nUnexpected error: ${message}`)
  process.exit(1)
})
