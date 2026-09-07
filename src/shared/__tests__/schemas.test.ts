/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ObjectPortConfig } from '@persistent-ai/fireflow-types'
import { copyPortValue, shouldPassPortValueByReference } from '@persistent-ai/fireflow-types'
import { describe, expect, it } from 'vitest'
import {
  AztecAccountRef,
  AztecArtifactRef,
  AztecFeePayerRef,
  AztecSignerRef,
  AztecSmartContractRef,
  AztecTxRequestRef,
} from '../schemas'
import '../schemas'

function objectPortConfig(type: string): ObjectPortConfig {
  return {
    type: 'object',
    schema: {
      type,
      properties: {},
    },
  }
}

function sampleSignerRef(): AztecSignerRef {
  const account = new AztecAccountRef()
  account.workspaceId = 'ws-1'
  account.branch = 'main'
  account.pointerPath = 'secrets/aztec-account.Local.default.ffsecret'
  account.address = '0xabc'
  account.network = 'Local'
  account.label = 'default'

  const signer = new AztecSignerRef()
  signer.account = account
  signer.secretScope = 'caller'
  signer.discoverNotesFrom = ['0xsender']
  return signer
}

describe('overcast object schemas', () => {
  it('does not pass AztecSignerRef by reference', () => {
    const signer = sampleSignerRef()
    const config = objectPortConfig('AztecSignerRef')

    expect(shouldPassPortValueByReference(signer, config)).toBe(false)

    const transferred = copyPortValue(signer, config) as AztecSignerRef
    expect(transferred).not.toBe(signer)
    expect(transferred.account).not.toBe(signer.account)
    expect(transferred.account?.workspaceId).toBe('ws-1')
    expect(transferred.account?.pointerPath).toBe('secrets/aztec-account.Local.default.ffsecret')
    expect(transferred.account?.address).toBe('0xabc')
  })

  it('deep-copies AztecFeePayerRef as plain data', () => {
    const feePayer = new AztecFeePayerRef()
    feePayer.method = 'SponsoredFPC'
    feePayer.fpcAddress = '0xfpc'

    const transferred = copyPortValue(feePayer, objectPortConfig('AztecFeePayerRef')) as AztecFeePayerRef
    expect(transferred).not.toBe(feePayer)
    expect(transferred.method).toBe('SponsoredFPC')
    expect(transferred.fpcAddress).toBe('0xfpc')
    expect(shouldPassPortValueByReference(feePayer, objectPortConfig('AztecFeePayerRef'))).toBe(false)
  })

  it('aztecArtifactRef never carries ABI fields', () => {
    const artifact = new AztecArtifactRef()
    artifact.workspaceId = 'ws-1'
    artifact.branch = 'main'
    artifact.path = 'artifacts/Token.json'
    artifact.name = 'Token'

    const transferred = copyPortValue(artifact, objectPortConfig('AztecArtifactRef')) as Record<string, unknown>
    expect(Object.keys(transferred).sort()).toEqual(['branch', 'name', 'path', 'workspaceId'])
    expect(transferred).not.toHaveProperty('functions')
    expect(transferred).not.toHaveProperty('bytecode')
  })

  it('aztecTxRequestRef is JSON-round-trippable without ABI', () => {
    const artifact = new AztecArtifactRef()
    artifact.workspaceId = 'ws-1'
    artifact.branch = 'main'
    artifact.path = 'artifacts/Token.json'
    artifact.name = 'Token'

    const contract = new AztecSmartContractRef()
    contract.address = '0xtoken'
    contract.network = 'Local'
    contract.artifact = artifact

    const feePayer = new AztecFeePayerRef()
    feePayer.method = 'SponsoredFPC'
    feePayer.fpcAddress = '0xfpc'

    const tx = new AztecTxRequestRef()
    tx.signer = sampleSignerRef()
    tx.contract = contract
    tx.method = 'balance_of_private'
    tx.parameters = ['0xabc']
    tx.feePayer = feePayer
    tx.subContracts = []

    const json = JSON.parse(JSON.stringify(tx)) as Record<string, unknown>
    expect(json).not.toHaveProperty('functions')
    expect(JSON.stringify(json)).not.toContain('"functions"')
    expect(JSON.stringify(json)).not.toContain('bytecode')
    expect(json.method).toBe('balance_of_private')
    expect((json.signer as { account: { address: string } }).account.address).toBe('0xabc')
    expect((json.contract as { artifact: { path: string } }).artifact.path).toBe('artifacts/Token.json')
  })
})
