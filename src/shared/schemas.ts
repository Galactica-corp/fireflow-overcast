/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FeePaymentMethodEnum } from './fee'
import type { NetworkEnum } from './network'
import {
  ObjectSchema,
  PortAny,
  PortArrayObject,
  PortArrayString,
  PortObject,
  PortString,
  StringEnum,
} from '@persistent-ai/fireflow-types'
import { DEFAULT_FEE_PAYMENT_METHOD, FEE_PAYMENT_METHOD_OPTIONS } from './fee'
import { DEFAULT_NETWORK, NETWORK_OPTIONS } from './network'

export const SECRET_SCOPE_OPTIONS = ['owner', 'caller'] as const
export type SecretScope = (typeof SECRET_SCOPE_OPTIONS)[number]
export const DEFAULT_SECRET_SCOPE: SecretScope = 'caller'

@ObjectSchema({
  type: 'AztecAccountRef',
  description: 'Pointer coordinates + public address of an Aztec account',
})
export class AztecAccountRef {
  @PortString({ title: 'Workspace ID', required: true })
  workspaceId: string = ''

  @PortString({ title: 'Branch', required: true })
  branch: string = ''

  @PortString({ title: 'Pointer Path', required: true })
  pointerPath: string = ''

  @PortString({ title: 'Address', required: true })
  address: string = ''

  @PortString({ title: 'Network', required: true })
  network: string = ''

  @PortString({ title: 'Label', required: true, defaultValue: 'default' })
  label: string = 'default'
}

@ObjectSchema({
  type: 'AztecArtifactRef',
  description: 'VFS coordinates of a contract artifact JSON file',
})
export class AztecArtifactRef {
  @PortString({ title: 'Workspace ID', required: true })
  workspaceId: string = ''

  @PortString({ title: 'Branch', required: true })
  branch: string = ''

  @PortString({ title: 'Path', required: true })
  path: string = ''

  @PortString({ title: 'Name' })
  name: string = ''
}

@ObjectSchema({
  type: 'AztecSignerRef',
  description: 'Serializable signing context — consumers rehydrate the live wallet locally',
})
export class AztecSignerRef {
  @PortObject({
    title: 'Account',
    schema: AztecAccountRef,
    required: true,
  })
  account?: AztecAccountRef

  @StringEnum([...SECRET_SCOPE_OPTIONS], {
    title: 'Secret Scope',
    defaultValue: DEFAULT_SECRET_SCOPE,
    options: SECRET_SCOPE_OPTIONS.map(opt => ({
      id: opt,
      type: 'string',
      defaultValue: opt,
      title: opt,
    })),
  })
  secretScope: SecretScope = DEFAULT_SECRET_SCOPE

  @PortArrayString({
    title: 'Discover Notes From',
    defaultValue: [],
  })
  discoverNotesFrom: string[] = []
}

@ObjectSchema({
  type: 'AztecFeePayerRef',
  description: 'Serializable fee strategy — consumers build the SDK payment method locally',
})
export class AztecFeePayerRef {
  @StringEnum([...FEE_PAYMENT_METHOD_OPTIONS], {
    title: 'Method',
    defaultValue: DEFAULT_FEE_PAYMENT_METHOD,
    options: FEE_PAYMENT_METHOD_OPTIONS.map(opt => ({
      id: opt,
      type: 'string',
      defaultValue: opt,
      title: opt,
    })),
  })
  method: FeePaymentMethodEnum = DEFAULT_FEE_PAYMENT_METHOD

  @PortString({ title: 'FPC Address' })
  fpcAddress: string = ''
}

@ObjectSchema({
  type: 'AztecSmartContractRef',
  description: 'Deployed contract address + artifact VFS coordinates',
})
export class AztecSmartContractRef {
  @PortString({ title: 'Address', required: true })
  address: string = ''

  @StringEnum([...NETWORK_OPTIONS], {
    title: 'Network',
    defaultValue: DEFAULT_NETWORK,
    options: NETWORK_OPTIONS.map(opt => ({
      id: opt,
      type: 'string',
      defaultValue: opt,
      title: opt,
    })),
  })
  network: NetworkEnum = DEFAULT_NETWORK

  @PortObject({
    title: 'Artifact',
    schema: AztecArtifactRef,
    required: true,
  })
  artifact?: AztecArtifactRef
}

@ObjectSchema({
  type: 'AztecTxRequestRef',
  description: 'Serializable contract call — consumers rebuild the live interaction locally',
})
export class AztecTxRequestRef {
  @PortObject({
    title: 'Signer',
    schema: AztecSignerRef,
    required: true,
  })
  signer?: AztecSignerRef

  @PortObject({
    title: 'Contract',
    schema: AztecSmartContractRef,
    required: true,
  })
  contract?: AztecSmartContractRef

  @PortArrayObject(AztecSmartContractRef, {
    title: 'Sub Contracts',
    defaultValue: [],
  })
  subContracts: AztecSmartContractRef[] = []

  @PortString({ title: 'Method', required: true })
  method: string = ''

  @PortAny({
    title: 'Parameters',
    defaultValue: [],
  })
  parameters: unknown[] = []

  @PortObject({
    title: 'Fee Payer',
    schema: AztecFeePayerRef,
  })
  feePayer?: AztecFeePayerRef
}

@ObjectSchema({ type: 'AztecTxReceipt', description: 'Transaction confirmation receipt' })
export class AztecTxReceiptSchema {}

@ObjectSchema({ type: 'HttpHeader', description: 'HTTP header name/value pair' })
export class HttpHeaderSchema {}

@ObjectSchema({ type: 'X402Challenge', description: 'Parsed x402 payment challenge' })
export class X402ChallengeSchema {}

@ObjectSchema({ type: 'X402Response', description: 'HTTP response from x402 resource request' })
export class X402ResponseSchema {}

@ObjectSchema({ type: 'X402PaymentContext', description: 'x402 payment context for header building' })
export class X402PaymentContextSchema {}
