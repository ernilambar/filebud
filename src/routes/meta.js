/**
 * GET /api/meta — small route so the client can show the source label and
 * root path in the header without baking them into index.html at build time.
 */
export async function metaRoutes (fastify, options) {
  const { root, label } = options

  fastify.get('/api/meta', async () => {
    return { root, label }
  })
}
