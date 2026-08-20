import { resolveSafePath } from '../lib/pathsafe.js'

export async function fileRoutes (fastify, options) {
  const { root } = options

  fastify.get('/api/file', async (request, reply) => {
    const relPath = request.query.path || ''
    const safePath = await resolveSafePath(root, relPath)
    return { path: relPath, fullPath: safePath }
  })

  fastify.get('/api/raw', async (request, reply) => {
    const relPath = request.query.path || ''
    const safePath = await resolveSafePath(root, relPath)
    return { path: relPath, fullPath: safePath }
  })
}
