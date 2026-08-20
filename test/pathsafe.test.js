import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveSafePath, PathSafetyError } from '../src/lib/pathsafe.js'

test('resolveSafePath allows safe relative paths inside root', async () => {
  const root = join(tmpdir(), `filebud-pathsafe-${Date.now()}`)
  mkdirSync(join(root, 'sub'), { recursive: true })
  writeFileSync(join(root, 'file.txt'), 'hello')
  writeFileSync(join(root, 'sub', 'nested.txt'), 'nested')

  try {
    assert.equal(await resolveSafePath(root, 'file.txt'), join(root, 'file.txt'))
    assert.equal(await resolveSafePath(root, 'sub/nested.txt'), join(root, 'sub', 'nested.txt'))
    assert.equal(await resolveSafePath(root, 'sub/../file.txt'), join(root, 'file.txt'))
    assert.equal(await resolveSafePath(root, ''), root)
    assert.equal(await resolveSafePath(root, '.'), root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveSafePath rejects traversal paths escaping root', async () => {
  const root = join(tmpdir(), `filebud-pathsafe-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    await assert.rejects(
      () => resolveSafePath(root, '../outside.txt'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    await assert.rejects(
      () => resolveSafePath(root, '../../etc/passwd'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    await assert.rejects(
      () => resolveSafePath(root, 'sub/../../outside.txt'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveSafePath rejects absolute paths', async () => {
  const root = join(tmpdir(), `filebud-pathsafe-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    await assert.rejects(
      () => resolveSafePath(root, '/etc/passwd'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    await assert.rejects(
      () => resolveSafePath(root, 'C:\\Windows\\system32'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    await assert.rejects(
      () => resolveSafePath(root, 'C:/Windows/system32'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    await assert.rejects(
      () => resolveSafePath(root, '\\\\server\\share'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveSafePath rejects null bytes and non-string inputs', async () => {
  const root = join(tmpdir(), `filebud-pathsafe-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    await assert.rejects(
      () => resolveSafePath(root, 'file\0.txt'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    await assert.rejects(
      () => resolveSafePath(root, null),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveSafePath rejects symlinks escaping root', async () => {
  const root = join(tmpdir(), `filebud-pathsafe-${Date.now()}`)
  const outside = join(tmpdir(), `filebud-outside-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'secret.txt'), 'secret')

  try {
    // Symlink file pointing outside
    symlinkSync(join(outside, 'secret.txt'), join(root, 'escape_file'))
    // Symlink directory pointing outside
    symlinkSync(outside, join(root, 'escape_dir'))
    // Broken symlink pointing outside
    symlinkSync('/nonexistent/outside', join(root, 'broken_outside'))
    // Safe internal symlink
    writeFileSync(join(root, 'internal.txt'), 'ok')
    symlinkSync(join(root, 'internal.txt'), join(root, 'safe_link'))

    // Safe link works
    assert.equal(await resolveSafePath(root, 'safe_link'), join(root, 'safe_link'))

    // Escaping file symlink rejected
    await assert.rejects(
      () => resolveSafePath(root, 'escape_file'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    // Escaping directory symlink rejected
    await assert.rejects(
      () => resolveSafePath(root, 'escape_dir/secret.txt'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    // Broken outside symlink rejected
    await assert.rejects(
      () => resolveSafePath(root, 'broken_outside'),
      (err) => {
        assert.ok(err instanceof PathSafetyError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('resolveSafePath returns resolved path for non-existent safe files without throwing', async () => {
  const root = join(tmpdir(), `filebud-pathsafe-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const resolved = await resolveSafePath(root, 'does-not-exist.txt')
    assert.equal(resolved, join(root, 'does-not-exist.txt'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
