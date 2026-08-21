import { mkdtemp, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirs = new Set()
const shutdownHooks = []
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

/**
 * Register an async function to run before temp cleanup on shutdown.
 * Used so `fastify.close()` finishes before any temp dir is removed.
 */
export function onShutdown (fn) {
  shutdownHooks.push(fn)
}

async function runShutdownHooks () {
  for (const hook of shutdownHooks) {
    try {
      await hook()
    } catch {}
  }
}

function fatal (error, exitCode) {
  const message = error instanceof Error ? (error.stack || error.message) : String(error)
  process.stderr.write(`filebud: unexpected error: ${message}\n`)

  // Best effort: let async hooks (server close) settle, then clean up and exit.
  runShutdownHooks()
    .catch(() => {})
    .finally(() => {
      cleanupAll()
      process.exit(exitCode)
    })
}

/**
 * Register exit/signal listeners once. Called automatically by createTempDir,
 * and explicitly by the CLI entry so a folder-only session still shuts down
 * gracefully.
 */
export function registerCleanupListeners () {
  if (listenersRegistered) return
  listenersRegistered = true

  process.on('exit', cleanupAll)

  process.on('SIGINT', () => {
    runShutdownHooks()
      .catch(() => {})
      .finally(() => {
        cleanupAll()
        process.exit(130)
      })
  })

  process.on('SIGTERM', () => {
    runShutdownHooks()
      .catch(() => {})
      .finally(() => {
        cleanupAll()
        process.exit(143)
      })
  })

  process.on('uncaughtException', (error) => fatal(error, 1))
  process.on('unhandledRejection', (error) => fatal(error, 1))
}

/**
 * Create a temp dir and register it for cleanup on exit.
 * Only dirs returned by this function are ever deleted.
 */
export async function createTempDir () {
  registerCleanupListeners()

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
