import { mkdir } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import decompress from '@xhmikosr/decompress'

/**
 * Entry path safety check. Returns true when the entry is safe to extract.
 *
 * Rejects:
 *  - absolute paths
 *  - paths that resolve outside the destination (zip-slip / ../ traversal)
 *  - symlink and hard-link entries
 */
function isSafeEntry (entry, destDir) {
  if (entry.type === 'symlink' || entry.type === 'link') return false

  const entryPath = entry.path

  if (typeof entryPath !== 'string') return false

  // Reject absolute paths inside the archive.
  if (entryPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entryPath)) return false

  // Reject traversal sequences.
  const resolved = resolve(join(destDir, entryPath))
  const base = destDir.endsWith(sep) ? destDir : destDir + sep

  return resolved === destDir || resolved.startsWith(base)
}

/**
 * Extract an archive to destDir, skipping unsafe entries.
 *
 * Skipped entries are reported on stderr so the user knows the archive was
 * not fully extracted, without aborting the whole operation.
 */
export async function extract (archivePath, destDir) {
  await mkdir(destDir, { recursive: true })

  await decompress(archivePath, destDir, {
    filter (entry) {
      if (isSafeEntry(entry, destDir)) return true

      process.stderr.write(
        `filebud: skipping unsafe archive entry: ${entry.path}\n`
      )
      return false
    }
  })
}

/**
 * Export for unit testing only.
 */
export { isSafeEntry }
