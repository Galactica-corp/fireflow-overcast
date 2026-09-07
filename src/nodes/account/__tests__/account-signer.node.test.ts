/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OvercastRuntime } from '../../runtime-registry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerOvercastRuntime } from '../../runtime-registry'
import AztecAccountSignerNode from '../account-signer.node'
import { makeAccountSignerHarness } from './support/mock-aztec-account-vault'

const mockCreateSigner = vi.fn()
const DERIVED_ADDRESS = 'aztec1:test-address'

registerOvercastRuntime({
  createSigner: mockCreateSigner,
} as unknown as OvercastRuntime)

const CREDENTIALS = {
  secret: '0x0a',
  salt: '0x0b',
  signingKey: '0x0c',
}

describe('aztecAccountSignerNode', () => {
  let node: AztecAccountSignerNode

  beforeEach(() => {
    node = new AztecAccountSignerNode('test-id')
    node.initialize()
    mockCreateSigner.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('instantiation', () => {
    it('initializes with default values', () => {
      expect(node.account).toBeUndefined()
      expect(node.discoverNotesFrom).toEqual([])
      expect(node.secretScope).toBe('caller')
      expect(node.signer).toBeUndefined()
      expect(node.address).toBe('')
      expect(node.findPortByKey('secret')).toBeUndefined()
      expect(node.findPortByKey('salt')).toBeUndefined()
      expect(node.findPortByKey('signingKey')).toBeUndefined()
      const accountPort = node.getPort('account')
      expect(accountPort?.getConfig().key).toBe('account')
      const accountNetwork = [...node.ports.values()].find(
        port => port.getConfig().key === 'network' && port.getConfig().parentId === accountPort?.id,
      )
      expect(accountNetwork).toBeTruthy()
    })
  })

  describe('input validation', () => {
    it('throws when account is missing', async () => {
      const harness = await makeAccountSignerHarness({
        credentials: CREDENTIALS,
        address: DERIVED_ADDRESS,
      })
      await expect(node.execute(harness.context)).rejects.toThrow('Account is required')
      expect(mockCreateSigner).not.toHaveBeenCalled()
    })
  })

  describe('execute', () => {
    it('assembles AztecSignerRef without vault or createSigner I/O', async () => {
      const harness = await makeAccountSignerHarness({
        credentials: CREDENTIALS,
        address: DERIVED_ADDRESS,
        network: 'Testnet',
      })
      node.account = harness.account
      node.secretScope = 'owner'
      node.discoverNotesFrom = ['aztec1:sender']

      await node.execute(harness.context)

      expect(mockCreateSigner).not.toHaveBeenCalled()
      expect(node.address).toBe(DERIVED_ADDRESS)
      expect(node.signer?.account?.workspaceId).toBe(harness.account.workspaceId)
      expect(node.signer?.account?.pointerPath).toBe(harness.account.pointerPath)
      expect(node.signer?.account?.address).toBe(harness.account.address)
      expect(node.signer?.account?.network).toBe('Testnet')
      expect(node.signer?.secretScope).toBe('owner')
      expect(node.signer?.discoverNotesFrom).toEqual(['aztec1:sender'])
      expect(node.signer?.discoverNotesFrom).not.toBe(node.discoverNotesFrom)
    })

    it('copies account.address onto the address output', async () => {
      const harness = await makeAccountSignerHarness({
        credentials: CREDENTIALS,
        address: DERIVED_ADDRESS,
      })
      node.account = harness.account

      await node.execute(harness.context)

      expect(node.address).toBe(harness.account.address)
      expect(mockCreateSigner).not.toHaveBeenCalled()
    })
  })
})
