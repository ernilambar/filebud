import { lstat, readlink, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

export class PathSafetyError extends Error {
  constructor (message = 'Forbidden') {
    super(message)
    this.name = 'PathSafetyError'
    this.statusCode = 403
  }
}

/**
 * Resolve a relative path against a root directory and ensure it stays contained.
 *
 * 1. Reject null bytes.
 * 2. Reject absolute paths.
 * 3. Resolve relative to root and assert result is inside root.
 * 4. Check for symlinks and assert realpath is inside root.
 *
 * Throws PathSafetyError (403) on any violation.
 */
export async function resolveSafePath (root, rel = '') {
  if (typeof rel !== 'string') {
    throw new PathSafetyError('Invalid path')
  }

  // 1. Reject null bytes
  if (rel.includes('\0')) {
    throw new PathSafetyError('Path contains null bytes')
  }

  // 2. Reject absolute paths across platforms
  if (
    rel.startsWith('/') ||
    rel.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(rel)
  ) {
    throw new PathSafetyError('Absolute paths are not allowed')
  }

  const resolvedRoot = resolve(root)
  const realRoot = await realpath(resolvedRoot).catch(() => resolvedRoot)

  const base = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep
  const realBase = realRoot.endsWith(sep) ? realRoot : realRoot + sep

  // 3. Resolve relative to root
  const resolved = resolve(resolvedRoot, rel)

  if (resolved !== resolvedRoot && !resolved.startsWith(base)) {
    throw new PathSafetyError('Path escapes root directory')
  }

  // 4. Symlink containment check
  try {
    const real = await realpath(resolved)
    if (real !== realRoot && !real.startsWith(realBase)) {
      throw new PathSafetyError('Symlink escapes root directory')
    }
  } catch (error) {
    if (error instanceof PathSafetyError) throw error

    // If realpath failed (e.g. broken symlink or non-existent file), check if it's a symlink
    try {
      const stats = await lstat(resolved)
      if (stats.isSymbolicLink()) {
        const linkTarget = await readlink(resolved)
        const resolvedTarget = resolve(dirname(resolved), linkTarget)
        if (
          (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(base)) &&
          (resolvedTarget !== realRoot && !resolvedTarget.startsWith(realBase))
        ) {
          throw new PathSafetyError('Symlink escapes root directory')
        }
      }
    } catch (lstatErr) {
      if (lstatErr instanceof PathSafetyError) throw lstatErr
      // Path does not exist on disk, safe to return resolved for 404 handling
    }
  }

  return resolved
}
