import { mkdtemp, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirs = new Set()
let listenersRegistered = false
let cleanedUp = false

/** Reset internal state. Test use only. */
export function _resetForTest () {
  tempDirs.clear()
  cleanedUp = false
}

export function cleanupAll () {
  if (cleanedUp) return
  cleanedUp = true

  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  }

  tempDirs.clear()
}

function registerListeners () {
  if (listenersRegistered) return
  listenersRegistered = true

  process.on('exit', cleanupAll)

  process.on('SIGINT', () => {
    cleanupAll()
    process.exit(130)
  })

  process.on('SIGTERM', () => {
    cleanupAll()
    process.exit(143)
  })
}

/**
 * Create a temp dir and register it for cleanup on exit.
 * Only dirs returned by this function are ever deleted.
 */
export async function createTempDir () {
  registerListeners()

  return new Promise((resolve, reject) => {
    mkdtemp(join(tmpdir(), 'filebud-'), (error, dir) => {
      if (error) return reject(error)
      tempDirs.add(dir)
      resolve(dir)
    })
  })
}

/**
 * Best-effort sweep of stale filebud-* dirs older than maxAgeMs.
 * Runs at startup to reclaim dirs left by a killed process.
 */
export async function sweepStaleDirs (maxAgeMs = 24 * 60 * 60 * 1000) {
  const { readdir, stat } = await import('node:fs/promises')
  const base = tmpdir()
  let entries

  try {
    entries = await readdir(base)
  } catch {
    return
  }

  const now = Date.now()

  await Promise.all(
    entries
      .filter((name) => name.startsWith('filebud-'))
      .map(async (name) => {
        const full = join(base, name)
        try {
          const info = await stat(full)
          if (now - info.mtimeMs > maxAgeMs) {
            rmSync(full, { recursive: true, force: true })
          }
        } catch {}
      })
  )
}
