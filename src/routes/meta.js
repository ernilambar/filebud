import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
)

/**
 * GET /api/meta — small route so the client can show the source label,
 * root path, and app version in the header without baking them into
 * index.html at build time.
 */
export async function metaRoutes (fastify, options) {
  const { root, label } = options

  fastify.get('/api/meta', async () => {
    return { root, label, version: pkg.version }
  })
}
