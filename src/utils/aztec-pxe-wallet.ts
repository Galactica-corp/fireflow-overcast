/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PXE wallet for commitment-based flows.
 *
 * EmbeddedWallet simulates through stub accounts, which breaks x402 commitment
 * payments. This wallet restores real account entrypoint simulation.
 */

import type { AztecNode } from '@aztec/aztec.js/node'
import type { ExecutionPayload } from '@aztec/aztec.js/tx'
import type { SendOptions } from '@aztec/aztec.js/wallet'
import type { EmbeddedWalletOptions } from '@aztec/wallets/embedded'
import { CallAuthorizationRequest } from '@aztec/aztec.js/authorization'
import {
  extractOffchainOutput,
  NO_WAIT,
} from '@aztec/aztec.js/contracts'
import { waitForTx } from '@aztec/aztec.js/node'
import { TxSimulationResultWithAppOffset } from '@aztec/aztec.js/wallet'
import { GasSettings } from '@aztec/stdlib/gas'
import { collectOffchainEffects } from '@aztec/stdlib/tx'
import { getGasLimits } from '@aztec/wallet-sdk/base-wallet'
import { EmbeddedWallet as NodeEmbeddedWallet } from '@aztec/wallets/embedded'

function formatValueForError(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, v) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    )
  } catch {
    return String(value)
  }
}

interface SendTxWithAppReturnValuesResult {
  receipt?: { txHash?: { toString: () => string } }
  txHash?: { toString: () => string }
  offchainEffects?: unknown[]
  offchainMessages?: unknown[]
  appReturnValues?: unknown[]
}

export class PXEWallet extends NodeEmbeddedWallet {
  async sendTxWithAppReturnValues(
    executionPayload: ExecutionPayload,
    opts: SendOptions<any>,
  ): Promise<SendTxWithAppReturnValuesResult> {
    // The embedded wallet's PXE has autoSync disabled and sendTx normally drives
    // the sync. This method bypasses sendTx and calls simulateViaEntrypoint
    // directly, so it must sync itself — otherwise the first simulation fails
    // with "Trying to get block header with a not-yet-synchronized PXE".
    await this.pxe.sync()

    const estimationFeeOptions = await this.completeFeeOptions({
      from: opts.from,
      feePayer: executionPayload.feePayer,
      gasSettings: opts.fee?.gasSettings,
      forEstimation: true,
    })

    const simulationResult = await this.simulateViaEntrypoint(executionPayload, {
      from: opts.from,
      feeOptions: estimationFeeOptions,
      additionalScopes: opts.additionalScopes,
      skipTxValidation: true,
      sendMessagesAs: opts.sendMessagesAs,
    })

    const offchainEffects = collectOffchainEffects(simulationResult.privateExecutionResult)
    const authWitnesses = await Promise.all(
      offchainEffects.map(async (effect) => {
        try {
          const authRequest = await CallAuthorizationRequest.fromFields(effect.data)
          return this.createAuthWit(authRequest.onBehalfOf, {
            consumer: effect.contractAddress,
            innerHash: authRequest.innerHash,
          })
        } catch {
          return undefined
        }
      }),
    )
    for (const authwit of authWitnesses) {
      if (authwit) {
        executionPayload.authWitnesses.push(authwit)
      }
    }

    const maxTxGasLimits = await this.getMaxTxGasLimits()
    const estimated = getGasLimits(
      simulationResult.gasUsed,
      maxTxGasLimits,
      this.estimatedGasPadding,
    )
    const gasSettings = GasSettings.from({
      ...opts.fee?.gasSettings,
      maxFeesPerGas: estimationFeeOptions.gasSettings.maxFeesPerGas,
      maxPriorityFeesPerGas: estimationFeeOptions.gasSettings.maxPriorityFeesPerGas,
      gasLimits: opts.fee?.gasSettings?.gasLimits ?? estimated.gasLimits,
      teardownGasLimits:
        opts.fee?.gasSettings?.teardownGasLimits ?? estimated.teardownGasLimits,
    })

    const feeOptions = await this.completeFeeOptions({
      from: opts.from,
      feePayer: executionPayload.feePayer,
      gasSettings,
    })
    const txRequest = await this.createTxExecutionRequestFromPayloadAndFee(
      executionPayload,
      opts.from,
      feeOptions,
    )
    // `senderForTags` is required: without it any private log this tx emits —
    // including the partial-note completion log that x402 payment verification
    // reads — trips the "Sender for tags is not set" assertion.
    const provenTx = await this.pxe.proveTx(txRequest, {
      scopes: this.scopesFrom(opts.from, opts.additionalScopes),
      senderForTags: this.senderForTagsFrom(opts.from, opts.sendMessagesAs),
    })
    const offchainOutput = extractOffchainOutput(
      provenTx.getOffchainEffects(),
      provenTx.publicInputs.constants.anchorBlockHeader.globalVariables.timestamp,
    )
    const entrypointAppCallOffset = await this.computeAppCallOffset(opts.from, feeOptions)
    const appCallOffset
      = entrypointAppCallOffset === 0
        ? 0
        : entrypointAppCallOffset + Math.max(0, executionPayload.calls.length - 1)
    const provenResult = new TxSimulationResultWithAppOffset(
      provenTx.privateExecutionResult,
      provenTx.publicInputs,
      undefined,
      undefined,
      appCallOffset,
    )
    const appReturnValues
      = provenResult.getPrivateReturnValuesOfAppCall(0)?.values ?? []

    const tx = await provenTx.toTx()
    const txHash = tx.getTxHash()
    if ((await this.aztecNode.getTxReceipt(txHash)).isMined()) {
      throw new Error(`A settled tx with equal hash ${txHash.toString()} exists.`)
    }

    await this.aztecNode.sendTx(tx).catch((err: Error) => {
      throw this.contextualizeError(err, formatValueForError(tx))
    })

    if (opts.wait === NO_WAIT) {
      return { txHash, appReturnValues, ...offchainOutput }
    }

    const waitOpts = typeof opts.wait === 'object' ? opts.wait : undefined
    const receipt = await waitForTx(this.aztecNode, txHash, waitOpts)
    return { receipt, appReturnValues, ...offchainOutput }
  }

  protected override async simulateViaEntrypoint(
    ...args: Parameters<NodeEmbeddedWallet['simulateViaEntrypoint']>
  ) {
    const [executionPayload, opts] = args
    const txRequest = await this.createTxExecutionRequestFromPayloadAndFee(
      executionPayload,
      opts.from,
      opts.feeOptions,
    )
    const result = await this.pxe.simulateTx(txRequest, {
      simulatePublic: true,
      skipTxValidation: opts.skipTxValidation,
      skipFeeEnforcement: opts.skipFeeEnforcement,
      scopes: this.scopesFrom(opts.from, opts.additionalScopes),
      senderForTags: this.senderForTagsFrom(opts.from, opts.sendMessagesAs),
    })
    const appCallOffset = await this.computeAppCallOffset(opts.from, opts.feeOptions)
    return TxSimulationResultWithAppOffset.fromResultAndOffset(result, appCallOffset)
  }
}

export async function createPXEWallet(
  nodeOrUrl: string | AztecNode,
  options: EmbeddedWalletOptions = {},
): Promise<PXEWallet> {
  return PXEWallet.create(nodeOrUrl, options)
}
