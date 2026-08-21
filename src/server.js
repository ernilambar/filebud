import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { treeRoutes } from './routes/tree.js'
import { fileRoutes } from './routes/file.js'
import { metaRoutes } from './routes/meta.js'

const publicDir = fileURLToPath(new URL('../public', import.meta.url))
const TOKEN_PLACEHOLDER = '__FILEBUD_TOKEN__'

let cachedIndexHtml = null

function getIndexHtml () {
  if (cachedIndexHtml === null) {
    cachedIndexHtml = readFileSync(join(publicDir, 'index.html'), 'utf8')
  }
  return cachedIndexHtml
}

export class PortInUseError extends Error {
  constructor (port) {
    super(`port ${port} is already in use; pass --port <n> to choose another`)
    this.name = 'PortInUseError'
    this.code = 'EADDRINUSE'
    this.port = port
  }
}

/**
 * Build the Fastify server instance.
 */
export async function createServer (config) {
  const { root, label, all = false, token = '' } = config

  const app = fastify({
    logger: false
  })

  // Global error handler: never leak stack traces, always return JSON { error }
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500

    reply.code(statusCode).send({
      error: error.message || 'Internal Server Error'
    })
  })

  // Session token gate. Every /api/* request must carry the token generated at
  // boot, via ?t=... (how the browser is opened) or the x-filebud-token header.
  // Without it, any local process or any page you visit could read the tree.
  // No token configured (tests) means the gate is off.
  if (token) {
    app.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/api/')) return

      const query = request.query || {}
      const supplied = query.t ?? request.headers['x-filebud-token']

      if (supplied !== token) {
        return reply.code(403).send({ error: 'missing or invalid session token' })
      }
    })
  }

  // Serve static assets from public/. index: false because / is handled below
  // so the session token can be injected into the HTML.
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    index: false
  })

  // index.html with the token baked in, so app.js can attach it to API calls.
  app.get('/', (request, reply) => {
    const html = token
      ? getIndexHtml().replaceAll(TOKEN_PLACEHOLDER, token)
      : getIndexHtml()
    return reply.type('text/html').send(html)
  })

  // Register API routes
  await app.register(treeRoutes, { root, label, all })
  await app.register(fileRoutes, { root, label, all })
  await app.register(metaRoutes, { root, label })

  return app
}

/**
 * Start listening on 127.0.0.1:<port>.
 */
export async function startServer (app, port) {
  try {
    const address = await app.listen({ port, host: '127.0.0.1' })
    return address
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      throw new PortInUseError(port)
    }
    throw error
  }
}
