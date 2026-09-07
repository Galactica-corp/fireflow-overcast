/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { canConnectVerbose } from '@persistent-ai/fireflow-types'
import { describe, expect, it } from 'vitest'
import ParseContractArtifactNode from '../parse-artifact.node'
import AztecSmartContractNode from '../smart-contract.node'
import 'reflect-metadata'

describe('artifact port compatibility', () => {
  it('parse Contract Artifact output connects to Aztec Smart Contract artifact input', () => {
    const parse = new ParseContractArtifactNode('parse')
    parse.initialize()
    const contract = new AztecSmartContractNode('contract')
    contract.initialize()

    const sourcePort = parse.getPort('artifact')!
    const targetPort = contract.getPort('artifact')!

    const verdict = canConnectVerbose(sourcePort.getConfig(), targetPort.getConfig())

    expect(sourcePort.getConfig().type).toBe('object')
    expect(targetPort.getConfig().type).toBe('object')
    expect(verdict).toMatchObject({ ok: true, kind: 'nominal-exact' })
  })
})
