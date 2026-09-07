/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Print Alice and Bob private token balances on the local Aztec sandbox.
 * Run with: pnpm --filter @persistent-ai/fireflow-overcast balances:local 0x<token-address>
 */

import process from 'node:process'
import { createAztecNodeClient } from '@aztec/aztec.js/node'
import { readAliceBobPrivateBalances } from '../helpers/local-aztec-deploy'

const NODE_URL = process.env.AZTEC_NODE_URL ?? 'http://localhost:8080'

let stepCounter = 0
const TOTAL_STEPS = 3

function logStep(message: string): void {
  stepCounter += 1
  console.log(`\n[${stepCounter}/${TOTAL_STEPS}] ${message}`)
}

function logOk(message: string): void {
  console.log(`  ✓ ${message}`)
}

function resolveTokenAddress(): string {
  const cliAddress = process.argv[2]?.trim() ?? ''
  const envAddress = process.env.TOKEN_CONTRACT_ADDRESS?.trim() ?? ''
  return cliAddress || envAddress
}

function printUsage(): void {
  console.error('\n  ✗ Token contract address is required')
  console.error('    Pass it from deploy:local output, e.g.:')
  console.error('    pnpm --filter @persistent-ai/fireflow-overcast balances:local 0x...')
  console.error('    # or')
  console.error('    TOKEN_CONTRACT_ADDRESS=0x... pnpm --filter @persistent-ai/fireflow-overcast balances:local')
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
  console.log('Overcast local balances — reading Alice and Bob private token balances')

  const tokenAddress = resolveTokenAddress()
  if (!tokenAddress) {
    printUsage()
    process.exit(1)
  }

  await checkAztecNodeConnectivity(NODE_URL)

  let result
  try {
    logStep('Reading private token balances')
    result = await readAliceBobPrivateBalances({
      nodeUrl: NODE_URL,
      tokenAddress,
    })
    logOk(`Alice: ${result.alice.balance.toString()}, Bob: ${result.bob.balance.toString()}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\n  ✗ Failed to read balances: ${message}`)
    process.exit(1)
  }

  const line = '═'.repeat(72)
  console.log(`\n${line}`)
  console.log('  Private token balances')
  console.log(line)
  console.log(`\n  Token contract: ${result.tokenAddress}`)
  console.log(`\n  Alice (${result.alice.address})`)
  console.log(`    Balance: ${result.alice.balance.toString()}`)
  console.log(`\n  Bob (${result.bob.address})`)
  console.log(`    Balance: ${result.bob.balance.toString()}`)
  console.log(`\n${line}`)

  logStep('Done')
  logOk('Balances read successfully')
  console.log('')
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\nUnexpected error: ${message}`)
  process.exit(1)
})
