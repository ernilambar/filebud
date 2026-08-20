import { fileURLToPath } from 'node:url'
import fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { treeRoutes } from './routes/tree.js'
import { fileRoutes } from './routes/file.js'

const publicDir = fileURLToPath(new URL('../public', import.meta.url))

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
  const { root, label, all = false } = config

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

  // Serve static assets from public/
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/'
  })

  // Register API routes
  await app.register(treeRoutes, { root, label, all })
  await app.register(fileRoutes, { root, label, all })

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
