import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveSafePath } from '../lib/pathsafe.js'
import { formatHumanSize } from '../lib/humansize.js'
import { getFileKind } from '../lib/filetype.js'

function sortEntries (a, b) {
  if (a.type !== b.type) {
    return a.type === 'dir' ? -1 : 1
  }

  const cmp = a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: 'base'
  })

  if (cmp !== 0) return cmp
  return a.name.localeCompare(b.name)
}

function normalizeRelPath (rel) {
  if (!rel || rel === '.' || rel === './') return ''
  return rel.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '').replace(/\\/g, '/')
}

export async function treeRoutes (fastify, options) {
  const { root, all = false } = options

  fastify.get('/api/tree', async (request, reply) => {
    const rawPath = request.query.path || ''
    const safePath = await resolveSafePath(root, rawPath)
    const normalizedPath = normalizeRelPath(rawPath)

    let dirStats
    try {
      dirStats = await stat(safePath)
    } catch {
      return reply.code(404).send({ error: 'Directory not found' })
    }

    if (!dirStats.isDirectory()) {
      return reply.code(400).send({ error: 'Path is not a directory' })
    }

    const dirents = await readdir(safePath, { withFileTypes: true })
    const entries = []

    for (const dirent of dirents) {
      const name = dirent.name

      // Skip .git and node_modules unless --all
      if (!all && (name === '.git' || name === 'node_modules')) {
        continue
      }

      const childRelPath = normalizedPath ? `${normalizedPath}/${name}` : name
      const fullChildPath = join(safePath, name)

      if (dirent.isDirectory()) {
        entries.push({
          name,
          path: childRelPath,
          type: 'dir'
        })
      } else if (dirent.isFile()) {
        try {
          const fileInfo = await stat(fullChildPath)
          entries.push({
            name,
            path: childRelPath,
            type: 'file',
            size: fileInfo.size,
            sizeHuman: formatHumanSize(fileInfo.size),
            kind: getFileKind(name)
          })
        } catch {
          // If file disappeared or unreadable, still report with 0 size
          entries.push({
            name,
            path: childRelPath,
            type: 'file',
            size: 0,
            sizeHuman: '0 B',
            kind: getFileKind(name)
          })
        }
      } else if (dirent.isSymbolicLink()) {
        try {
          const symInfo = await stat(fullChildPath)
          if (symInfo.isDirectory()) {
            entries.push({
              name,
              path: childRelPath,
              type: 'dir'
            })
          } else if (symInfo.isFile()) {
            entries.push({
              name,
              path: childRelPath,
              type: 'file',
              size: symInfo.size,
              sizeHuman: formatHumanSize(symInfo.size),
              kind: getFileKind(name)
            })
          }
        } catch {
          // Dangling or unresolvable symlink, skip
        }
      }
    }

    entries.sort(sortEntries)

    return {
      path: normalizedPath,
      entries
    }
  })
}
