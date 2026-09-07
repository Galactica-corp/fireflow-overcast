/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionContext, NodeExecutionResult } from '@persistent-ai/fireflow-types'
import type { Header, HttpMethod, X402Response } from '../../shared/types'
import {
  BaseNode,
  Input,
  Node,
  Output,
  PortAny,
  PortObject,
  PortString,
  StringEnum,
} from '@persistent-ai/fireflow-types'
import { DEFAULT_HTTP_METHOD, HTTP_METHOD_OPTIONS } from '../../shared/http'
import { AztecSignerRef, X402ResponseSchema } from '../../shared/schemas'
import { getOvercastRuntime } from '../runtime-registry'

@Node({
  type: 'RequestX402ResourceNode',
  title: 'Request x402 Resource',
  description: 'Perform an HTTP request to a resource endpoint that may require x402 payment',
  category: 'overcast',
  tags: ['aztec', 'overcast', 'x402', 'http'],
})
export default class RequestX402ResourceNode extends BaseNode {
  @Input()
  @PortString({
    title: 'URL',
    description: 'Resource endpoint',
    required: true,
    defaultValue: '',
  })
  url: string = ''

  @Input()
  @StringEnum([...HTTP_METHOD_OPTIONS], {
    title: 'Method',
    description: 'HTTP request method',
    defaultValue: DEFAULT_HTTP_METHOD,
    options: HTTP_METHOD_OPTIONS.map(opt => ({
      id: opt,
      type: 'string',
      defaultValue: opt,
      title: opt,
    })),
  })
  method: HttpMethod = DEFAULT_HTTP_METHOD

  @Input()
  @PortAny({
    title: 'Headers',
    description: 'Request headers; may include a single x402 payment header from Build x402 Payment Header',
  })
  // Accepts Header[] or a single Header (when paymentHeader is wired in).
  // Do not default to [] — an array value with object underlyingType from that
  // edge bricks SuperJSON serialization of the flow.
  headers: Header | Header[] | undefined = undefined

  @Input()
  @PortAny({
    title: 'Body',
    description: 'Optional request body',
  })
  body: unknown = undefined

  @Input()
  @PortObject({
    title: 'Signer',
    description: 'Paying account used for the x402 prepare round-trip when a 402 is returned',
    schema: AztecSignerRef,
  })
  signer?: AztecSignerRef

  @Output()
  @PortObject({
    title: 'Response',
    description: 'HTTP response including parsed x402 challenge when applicable',
    schema: X402ResponseSchema,
  })
  response: X402Response | null = null

  async execute(context: ExecutionContext): Promise<NodeExecutionResult> {
    if (!this.url) {
      throw new Error('URL is required')
    }

    const runtime = getOvercastRuntime()
    const signer = this.signer
      ? await runtime.resolveSigner(this.signer, context)
      : undefined

    this.response = await runtime.requestResource({
      url: this.url,
      method: this.method,
      headers: normalizeHeaders(this.headers),
      body: this.body,
      signer,
    })

    return {}
  }
}

function normalizeHeaders(headers: Header | Header[] | undefined): Header[] {
  if (headers == null) {
    return []
  }
  if (Array.isArray(headers)) {
    return headers
  }
  return [headers]
}
