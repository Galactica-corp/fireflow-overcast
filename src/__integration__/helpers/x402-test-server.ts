/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AztecNetwork } from '@galactica-net/x402-core'
import type { ExactAztecFacilitatorScheme } from '@galactica-net/x402-mechanism/exact/facilitator'
import type {
  MiddlewareRequest,
  MiddlewareResponse,
  NextFunction,
  RoutesConfig,
} from '@galactica-net/x402-middleware'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { createPaymentMiddleware } from '@galactica-net/x402-middleware'

export interface X402TestServerConfig {
  network: AztecNetwork
  tokenAddress: string
  serverAddress: string
  priceAmount: string
  facilitator: ExactAztecFacilitatorScheme
  routePath?: string
}

export interface X402TestServer {
  url: string
  stop: () => Promise<void>
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function handleMiddlewareRequest(
  req: IncomingMessage,
  res: ServerResponse,
  middleware: ReturnType<typeof createPaymentMiddleware>,
  routePath: string,
): Promise<void> {
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `http://${host}`)
  const body = await readRequestBody(req)

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers[key] = value
    } else if (Array.isArray(value)) {
      headers[key] = value.join(', ')
    }
  }

  const mwReq: MiddlewareRequest = {
    path: url.pathname,
    method: req.method ?? 'GET',
    url: url.toString(),
    headers,
    body: body.length > 0 ? body.toString() : undefined,
  }

  let statusCode = 200
  const responseHeaders: Record<string, string> = {}

  const mwRes: MiddlewareResponse = {
    statusCode,
    status(code: number) {
      statusCode = code
      return mwRes
    },
    setHeader(key: string, value: string) {
      responseHeaders[key] = value
      return mwRes
    },
    json(data: unknown) {
      const payload = JSON.stringify(data)
      res.writeHead(statusCode, {
        'content-type': 'application/json',
        ...responseHeaders,
      })
      res.end(payload)
      return mwRes
    },
    end() {
      res.writeHead(statusCode, responseHeaders)
      res.end()
      return mwRes
    },
  }

  const next: NextFunction = () => {
    const resourceId = url.pathname.split('/').pop()
    res.writeHead(200, {
      'content-type': 'application/json',
      ...responseHeaders,
    })
    res.end(JSON.stringify({
      resource: resourceId,
      paid: true,
      message: 'resource delivered',
    }))
  }

  await new Promise<void>((resolve) => {
    const originalJson = mwRes.json.bind(mwRes)
    const originalEnd = mwRes.end.bind(mwRes)

    mwRes.json = (data: unknown) => {
      originalJson(data)
      resolve()
      return mwRes
    }
    mwRes.end = () => {
      originalEnd()
      resolve()
      return mwRes
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', routePath }))
      resolve()
      return
    }

    middleware(mwReq, mwRes, next)
  })
}

/** Start a minimal node:http x402 test server for integration tests. */
export async function startX402TestServer(config: X402TestServerConfig): Promise<X402TestServer> {
  const routePath = config.routePath ?? '/api/resource/:id'
  const routes: RoutesConfig = {
    [routePath]: {
      network: config.network,
      asset: config.tokenAddress,
      amount: config.priceAmount,
      payTo: config.serverAddress,
      maxTimeoutSeconds: 600,
      description: 'Integration test resource',
    },
  }

  const middleware = createPaymentMiddleware(routes, { facilitator: config.facilitator })

  const server: Server = createServer((req, res) => {
    handleMiddlewareRequest(req, res, middleware, routePath).catch((error) => {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(error instanceof Error ? error.message : 'Internal Server Error')
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine x402 test server port')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()))
      })
    },
  }
}
