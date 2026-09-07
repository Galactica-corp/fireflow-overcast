/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { AztecClientBackend } from '@aztec/bb.js'

/**
 * Aztec 5.0.1 `AztecClientBackend.prove` fire-and-forgets `chonkStart` /
 * `chonkLoad` / `chonkAccumulate` and only awaits `chonkProve`. Native NAPI
 * does not serialize those calls; they race, unhandled-reject, and ChonkProve
 * sees an empty IVC stack ("No circuits accumulated").
 *
 * Await the accumulate sequence first, then run the stock prove body with
 * those three calls stubbed so it is not started twice.
 */
interface ChonkQueueApi {
  chonkStart: (command: { numCircuits: number }) => Promise<unknown>
  chonkLoad: (command: {
    circuit: { name: string, bytecode: Uint8Array, verificationKey: Uint8Array }
  }) => Promise<unknown>
  chonkAccumulate: (command: { witness: Uint8Array }) => Promise<unknown>
}

interface AztecClientBackendInternals {
  api: ChonkQueueApi
  acirBuf: Uint8Array[]
  circuitNames: string[]
}

export function installAztecChonkProveAwait(): void {
  const g = globalThis as typeof globalThis & { __ffAztecChonkProvePatched?: boolean }
  if (g.__ffAztecChonkProvePatched) {
    return
  }
  g.__ffAztecChonkProvePatched = true

  const origProve = AztecClientBackend.prototype.prove
  AztecClientBackend.prototype.prove = async function patchedProve(witnessBuf, vksBuf, options) {
    const self = this as unknown as AztecClientBackendInternals
    const api = self.api
    const vks = vksBuf ?? []
    await api.chonkStart({ numCircuits: self.acirBuf.length })
    for (let i = 0; i < self.acirBuf.length; i++) {
      await api.chonkLoad({
        circuit: {
          name: self.circuitNames[i] || `circuit_${i}`,
          bytecode: self.acirBuf[i],
          verificationKey: vks[i] || new Uint8Array(0),
        },
      })
      await api.chonkAccumulate({
        witness: witnessBuf[i] || new Uint8Array(0),
      })
    }

    const origStart = api.chonkStart
    const origLoad = api.chonkLoad
    const origAccumulate = api.chonkAccumulate
    api.chonkStart = async () => ({})
    api.chonkLoad = async () => ({})
    api.chonkAccumulate = async () => ({})
    try {
      return await origProve.call(this, witnessBuf, vksBuf, options)
    } finally {
      api.chonkStart = origStart
      api.chonkLoad = origLoad
      api.chonkAccumulate = origAccumulate
    }
  }
}
