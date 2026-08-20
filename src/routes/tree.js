import { resolveSafePath } from '../lib/pathsafe.js'

export async function treeRoutes (fastify, options) {
  const { root } = options

  fastify.get('/api/tree', async (request, reply) => {
    const relPath = request.query.path || ''
    const safePath = await resolveSafePath(root, relPath)
    return { path: relPath, fullPath: safePath, entries: [] }
  })
}
