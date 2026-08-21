import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import decompress from '@xhmikosr/decompress'

// Cap on total extracted bytes. Compressed input is already capped at download
// time, but a small zip bomb can still expand enormously on disk.
export const MAX_EXTRACT_BYTES = 1024 * 1024 * 1024 // 1 GB

/**
 * Entry path safety check. Returns true when the entry is safe to extract.
 *
 * Rejects:
 *  - absolute paths (POSIX, Windows drive letter, UNC)
 *  - paths containing NUL bytes
 *  - paths that resolve outside the destination (zip-slip / ../ traversal)
 *  - symlink and hard-link entries
 */
function isSafeEntry (entry, destDir) {
  if (!entry) return false
  if (entry.type === 'symlink' || entry.type === 'link') return false

  const entryPath = entry.path

  if (typeof entryPath !== 'string') return false
  if (entryPath.includes('\0')) return false

  // Reject absolute paths inside the archive.
  if (
    entryPath.startsWith('/') ||
    entryPath.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(entryPath)
  ) {
    return false
  }

  // Reject traversal sequences.
  const resolvedDest = resolve(destDir)
  const base = resolvedDest.endsWith(sep) ? resolvedDest : resolvedDest + sep
  const resolved = resolve(join(resolvedDest, entryPath))

  return resolved === resolvedDest || resolved.startsWith(base)
}

/**
 * Total size of all regular files under dir, stopping early once the cap is
 * exceeded. Symlinks are ignored (the entry filter already rejects them).
 */
async function directorySize (dir, cap) {
  let total = 0
  const stack = [dir]

  while (stack.length > 0) {
    const current = stack.pop()
    let dirents
    try {
      dirents = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const dirent of dirents) {
      const full = join(current, dirent.name)
      if (dirent.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!dirent.isFile()) continue

      try {
        const info = await stat(full)
        total += info.size
        if (total > cap) return total
      } catch {}
    }
  }

  return total
}

/**
 * Extract an archive to destDir, skipping unsafe entries.
 *
 * Skipped entries are reported on stderr so the user knows the archive was
 * not fully extracted, without aborting the whole operation. If the extracted
 * output exceeds maxBytes, the destination is removed and an error is thrown.
 */
export async function extract (archivePath, destDir, { maxBytes = MAX_EXTRACT_BYTES } = {}) {
  await mkdir(destDir, { recursive: true })

  const entries = await decompress(archivePath, destDir, {
    filter (entry) {
      if (isSafeEntry(entry, destDir)) return true

      process.stderr.write(
        `filebud: skipping unsafe archive entry: ${entry.path}\n`
      )
      return false
    }
  })

  const totalBytes = await directorySize(destDir, maxBytes)
  if (totalBytes > maxBytes) {
    await rm(destDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(
      'archive expands beyond the extracted size limit; extraction aborted'
    )
  }

  return entries
}

/**
 * Export for unit testing only.
 */
export { isSafeEntry }
