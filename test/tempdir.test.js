import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createTempDir, cleanupAll, sweepStaleDirs, _resetForTest } from '../src/tempdir.js'

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Run cleanup and reset the module's internal state for isolated tests.
 * Because tempdir.js guards with module-level flags, we exercise the public API
 * rather than resetting internals directly.
 */
function teardown () {
  cleanupAll()
  _resetForTest()
}

// ── createTempDir ─────────────────────────────────────────────────────────────

test('createTempDir creates a directory under os.tmpdir()', async () => {
  const dir = await createTempDir()

  try {
    assert.ok(existsSync(dir), 'directory should exist after creation')
    assert.ok(dir.startsWith(tmpdir()), 'directory should be under os.tmpdir()')
    assert.match(dir, /filebud-/, 'directory should carry the filebud- prefix')
  } finally {
    teardown()
  }
})

test('createTempDir returns a different path on each call', async () => {
  const a = await createTempDir()
  const b = await createTempDir()

  try {
    assert.notEqual(a, b)
  } finally {
    teardown()
  }
})

// ── cleanupAll ────────────────────────────────────────────────────────────────

test('cleanupAll removes all created temp dirs', async () => {
  const a = await createTempDir()
  const b = await createTempDir()

  cleanupAll()

  assert.ok(!existsSync(a), 'first dir should be gone after cleanupAll')
  assert.ok(!existsSync(b), 'second dir should be gone after cleanupAll')
})

test('cleanupAll is idempotent: calling it twice does not throw', async () => {
  await createTempDir()

  cleanupAll()

  assert.doesNotThrow(() => cleanupAll())
})

test('cleanupAll does not remove a dir that was not created by createTempDir', () => {
  // This is the most safety-critical property: a user-supplied folder must never
  // be deleted. createTempDir is the only registration point, so any dir that
  // bypasses it is safe.
  const external = mkdtempSync(join(tmpdir(), 'filebud-external-'))

  try {
    // Do not call createTempDir for this path — it is not registered.
    cleanupAll()

    assert.ok(
      existsSync(external),
      'externally created dir must survive cleanupAll'
    )
  } finally {
    // Clean up the test fixture manually.
    rmSync(external, { recursive: true, force: true })
  }
})

// ── sweepStaleDirs ────────────────────────────────────────────────────────────

test('sweepStaleDirs removes filebud-* dirs older than maxAgeMs', async () => {
  // Create a real dir under tmpdir with the filebud- prefix and backdate its
  // mtime by setting it to a known past timestamp via utimes.
  const { utimes } = await import('node:fs/promises')

  const stale = mkdtempSync(join(tmpdir(), 'filebud-stale-'))
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago

  await utimes(stale, past, past)

  await sweepStaleDirs(60 * 60 * 1000) // 1 hour threshold

  assert.ok(!existsSync(stale), 'stale dir should be removed by sweep')
})

test('sweepStaleDirs leaves recent filebud-* dirs alone', async () => {
  const recent = mkdtempSync(join(tmpdir(), 'filebud-recent-'))

  try {
    await sweepStaleDirs(24 * 60 * 60 * 1000)

    assert.ok(existsSync(recent), 'recent dir should survive sweep')
  } finally {
    rmSync(recent, { recursive: true, force: true })
  }
})

test('sweepStaleDirs leaves non-filebud dirs alone', async () => {
  const other = mkdtempSync(join(tmpdir(), 'other-tool-'))

  try {
    const { utimes } = await import('node:fs/promises')
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000)
    await utimes(other, past, past)

    await sweepStaleDirs(60 * 1000) // 1 minute threshold — everything looks stale

    assert.ok(existsSync(other), 'non-filebud dir must not be touched')
  } finally {
    rmSync(other, { recursive: true, force: true })
  }
})
