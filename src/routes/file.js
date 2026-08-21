import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { resolveSafePath } from '../lib/pathsafe.js'
import { formatHumanSize } from '../lib/humansize.js'
import {
  getFileType,
  hasLongLine,
  isBinaryBuffer,
  MAX_FILE_SIZE
} from '../lib/filetype.js'

function normalizeRelPath (rel) {
  if (!rel || rel === '.' || rel === './') return ''
  return rel.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '').replace(/\\/g, '/')
}

export async function fileRoutes (fastify, options) {
  const { root } = options

  fastify.get('/api/file', async (request, reply) => {
    const rawPath = request.query.path || ''
    const safePath = await resolveSafePath(root, rawPath)
    const normalizedPath = normalizeRelPath(rawPath)
    const force = request.query.force === '1' || request.query.force === 'true'

    let fileStats
    try {
      fileStats = await stat(safePath)
    } catch {
      return reply.code(404).send({ error: 'File not found' })
    }

    if (fileStats.isDirectory()) {
      return reply.code(400).send({ error: 'Path is a directory' })
    }

    const size = fileStats.size
    const sizeHuman = formatHumanSize(size)
    const fileType = getFileType(safePath)

    // 1. Known image files
    if (fileType.kind === 'image') {
      return {
        path: normalizedPath,
        size,
        sizeHuman,
        kind: 'image',
        language: null
      }
    }

    // 2. Known binary files
    if (fileType.kind === 'binary') {
      return {
        path: normalizedPath,
        size,
        sizeHuman,
        kind: 'binary',
        language: null
      }
    }

    // 3. File size cap (> 10 MB) unless force=1
    if (!force && size > MAX_FILE_SIZE) {
      return {
        path: normalizedPath,
        size,
        sizeHuman,
        kind: 'too-large',
        reason: 'size'
      }
    }

    // 4. Read file buffer
    const buffer = await readFile(safePath)

    // 5. Binary sniff (NUL byte or invalid UTF-8 in first 8 KB)
    if (isBinaryBuffer(buffer)) {
      return {
        path: normalizedPath,
        size,
        sizeHuman,
        kind: 'binary',
        language: null
      }
    }

    // 6. Long lines cap (> 500 KB on a single line) unless force=1
    if (!force && hasLongLine(buffer)) {
      return {
        path: normalizedPath,
        size,
        sizeHuman,
        kind: 'too-large',
        reason: 'long-lines'
      }
    }

    // 7. Text content
    const content = buffer.toString('utf8')

    return {
      path: normalizedPath,
      size,
      sizeHuman,
      kind: 'text',
      language: fileType.language,
      content
    }
  })

  fastify.get('/api/raw', async (request, reply) => {
    const rawPath = request.query.path || ''
    const safePath = await resolveSafePath(root, rawPath)

    let fileStats
    try {
      fileStats = await stat(safePath)
    } catch {
      return reply.code(404).send({ error: 'File not found' })
    }

    if (fileStats.isDirectory()) {
      return reply.code(400).send({ error: 'Path is a directory' })
    }

    const { mime } = getFileType(safePath)
    const stream = createReadStream(safePath)

    return reply
      .type(mime)
      .header('content-disposition', 'inline')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'")
      .send(stream)
  })
}
