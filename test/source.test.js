import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { resolveSource, isArchiveExt } from '../src/source.js'
import { cleanupAll, _resetForTest } from '../src/tempdir.js'

const execFileAsync = promisify(execFile)

function teardown () {
  cleanupAll()
  _resetForTest()
}

// ── isArchiveExt ──────────────────────────────────────────────────────────────

test('isArchiveExt recognizes supported archive extensions', () => {
  assert.equal(isArchiveExt('file.zip'), true)
  assert.equal(isArchiveExt('file.tar'), true)
  assert.equal(isArchiveExt('file.tar.gz'), true)
  assert.equal(isArchiveExt('file.tgz'), true)
  assert.equal(isArchiveExt('file.tar.bz2'), true)
  assert.equal(isArchiveExt('file.tbz2'), true)

  // Case-insensitivity
  assert.equal(isArchiveExt('FILE.ZIP'), true)
  assert.equal(isArchiveExt('file.TAR.GZ'), true)
  assert.equal(isArchiveExt('file.TGZ'), true)
})

test('isArchiveExt rejects unsupported or non-archive extensions', () => {
  assert.equal(isArchiveExt('file.7z'), false)
  assert.equal(isArchiveExt('file.rar'), false)
  assert.equal(isArchiveExt('file.gz'), false)
  assert.equal(isArchiveExt('file.bz2'), false)
  assert.equal(isArchiveExt('file.tar.xz'), false)
  assert.equal(isArchiveExt('file.txt'), false)
  assert.equal(isArchiveExt('file.zip.bak'), false)
  assert.equal(isArchiveExt(''), false)
  assert.equal(isArchiveExt(null), false)
})

// ── resolveSource: folder branch ──────────────────────────────────────────────

test('resolveSource with folder returns realpath and isTemp: false', async () => {
  const workDir = join(tmpdir(), `filebud-test-folder-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })

  try {
    const result = await resolveSource(workDir)

    assert.equal(result.isTemp, false)
    assert.equal(typeof result.root, 'string')
    assert.ok(existsSync(result.root))
    assert.equal(result.label, result.root)

    // User folder must never be cleaned up by cleanupAll
    teardown()
    assert.ok(existsSync(workDir), 'user folder must survive cleanup')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    teardown()
  }
})

// ── resolveSource: local archive branch ───────────────────────────────────────

test('resolveSource with zip archive extracts and unwraps single root', async () => {
  const workDir = join(tmpdir(), `filebud-test-zipsrc-${Date.now()}`)
  const srcDir = join(workDir, 'src', 'my-pkg')
  const archivePath = join(workDir, 'archive.zip')

  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'index.js'), 'console.log("hello")')

  try {
    await execFileAsync('zip', ['-r', archivePath, 'my-pkg'], { cwd: join(workDir, 'src') })

    const result = await resolveSource(archivePath)

    assert.equal(result.isTemp, true)
    assert.equal(result.label, archivePath)
    assert.ok(existsSync(result.root))
    // Single directory wrapper unwrapped:
    assert.ok(existsSync(join(result.root, 'index.js')))
    assert.equal(readFileSync(join(result.root, 'index.js'), 'utf8'), 'console.log("hello")')

    teardown()
    assert.ok(!existsSync(result.root), 'temp extraction root must be cleaned up')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    teardown()
  }
})

test('resolveSource with multi-root zip does not unwrap root', async () => {
  const workDir = join(tmpdir(), `filebud-test-multizip-${Date.now()}`)
  const srcDir = join(workDir, 'src')
  const archivePath = join(workDir, 'archive.zip')

  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'a.txt'), 'file a')
  writeFileSync(join(srcDir, 'b.txt'), 'file b')

  try {
    await execFileAsync('zip', ['-r', archivePath, '.'], { cwd: srcDir })

    const result = await resolveSource(archivePath)

    assert.equal(result.isTemp, true)
    assert.ok(existsSync(join(result.root, 'a.txt')))
    assert.ok(existsSync(join(result.root, 'b.txt')))
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    teardown()
  }
})

test('resolveSource with tar.gz archive extracts correctly', async () => {
  const workDir = join(tmpdir(), `filebud-test-targz-${Date.now()}`)
  const srcDir = join(workDir, 'src')
  const archivePath = join(workDir, 'archive.tar.gz')

  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hello.txt'), 'tar.gz content')

  try {
    await execFileAsync('tar', ['-czf', archivePath, '-C', srcDir, '.'])

    const result = await resolveSource(archivePath)

    assert.equal(result.isTemp, true)
    assert.ok(existsSync(join(result.root, 'hello.txt')))
    assert.equal(readFileSync(join(result.root, 'hello.txt'), 'utf8'), 'tar.gz content')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    teardown()
  }
})

// ── resolveSource: URL branch ─────────────────────────────────────────────────

test('resolveSource downloads from URL and extracts', async () => {
  const workDir = join(tmpdir(), `filebud-test-url-${Date.now()}`)
  const srcDir = join(workDir, 'src')
  const archivePath = join(workDir, 'archive.zip')

  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'remote.txt'), 'remote file content')
  await execFileAsync('zip', ['-r', archivePath, '.'], { cwd: srcDir })
  const zipBuffer = readFileSync(archivePath)

  const server = createServer((req, res) => {
    if (req.url === '/archive.zip') {
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': String(zipBuffer.length)
      })
      res.end(zipBuffer)
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: '/archive.zip' })
      res.end()
    } else {
      res.writeHead(404)
      res.end('not found')
    }
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    // Normal URL
    const url = `http://127.0.0.1:${port}/archive.zip`
    const result = await resolveSource(url)

    assert.equal(result.isTemp, true)
    assert.equal(result.label, url)
    assert.ok(existsSync(join(result.root, 'remote.txt')))
    assert.equal(readFileSync(join(result.root, 'remote.txt'), 'utf8'), 'remote file content')

    // Redirected URL
    const redirectUrl = `http://127.0.0.1:${port}/redirect`
    const redirResult = await resolveSource(redirectUrl)
    assert.equal(redirResult.isTemp, true)
    assert.ok(existsSync(join(redirResult.root, 'remote.txt')))
  } finally {
    server.close()
    rmSync(workDir, { recursive: true, force: true })
    teardown()
  }
})

test('resolveSource rejects URL when server returns non-2xx status', async () => {
  const server = createServer((req, res) => {
    res.writeHead(404)
    res.end('not found')
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const url = `http://127.0.0.1:${port}/missing.zip`
    await assert.rejects(
      resolveSource(url),
      /download failed: server returned 404/
    )
  } finally {
    server.close()
    teardown()
  }
})

test('resolveSource rejects URL exceeding the 150 MB download cap', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'content-length': String(160 * 1024 * 1024)
    })
    res.end()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const url = `http://127.0.0.1:${port}/huge.zip`
    await assert.rejects(
      resolveSource(url),
      /archive exceeds the 150 MB download limit/
    )
  } finally {
    server.close()
    teardown()
  }
})

test('resolveSource with tar archive extracts correctly', async () => {
  const workDir = join(tmpdir(), `filebud-test-tar-${Date.now()}`)
  const srcDir = join(workDir, 'src')
  const archivePath = join(workDir, 'archive.tar')

  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hello.txt'), 'tar content')

  try {
    await execFileAsync('tar', ['-cf', archivePath, '-C', srcDir, '.'])

    const result = await resolveSource(archivePath)

    assert.equal(result.isTemp, true)
    assert.ok(existsSync(join(result.root, 'hello.txt')))
    assert.equal(readFileSync(join(result.root, 'hello.txt'), 'utf8'), 'tar content')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    teardown()
  }
})

test('resolveSource with tgz archive extracts correctly', async () => {
  const workDir = join(tmpdir(), `filebud-test-tgz-${Date.now()}`)
  const srcDir = join(workDir, 'src')
  const archivePath = join(workDir, 'archive.tgz')

  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hello.txt'), 'tgz content')

  try {
    await execFileAsync('tar', ['-czf', archivePath, '-C', srcDir, '.'])

    const result = await resolveSource(archivePath)

    assert.equal(result.isTemp, true)
    assert.ok(existsSync(join(result.root, 'hello.txt')))
    assert.equal(readFileSync(join(result.root, 'hello.txt'), 'utf8'), 'tgz content')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    teardown()
  }
})

test('resolveSource with tar.bz2 and tbz2 archive extracts correctly', async () => {
  const workDir = join(tmpdir(), `filebud-test-tarbz2-${Date.now()}`)
  const srcDir = join(workDir, 'src')
  const archivePath1 = join(workDir, 'archive.tar.bz2')
  const archivePath2 = join(workDir, 'archive.tbz2')

  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hello.txt'), 'tar.bz2 content')

  try {
    await execFileAsync('tar', ['-cjf', archivePath1, '-C', srcDir, '.'])
    await execFileAsync('tar', ['-cjf', archivePath2, '-C', srcDir, '.'])

    const result1 = await resolveSource(archivePath1)
    assert.equal(result1.isTemp, true)
    assert.ok(existsSync(join(result1.root, 'hello.txt')))
    assert.equal(readFileSync(join(result1.root, 'hello.txt'), 'utf8'), 'tar.bz2 content')

    const result2 = await resolveSource(archivePath2)
    assert.equal(result2.isTemp, true)
    assert.ok(existsSync(join(result2.root, 'hello.txt')))
    assert.equal(readFileSync(join(result2.root, 'hello.txt'), 'utf8'), 'tar.bz2 content')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    teardown()
  }
})

test('resolveSource rejects chunked streaming URL exceeding the 150 MB download cap', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream'
      // No content-length: chunked transfer
    })

    const chunkSize = 16 * 1024 * 1024 // 16 MB chunk
    const chunk = Buffer.alloc(chunkSize, 'a')

    // Send 10 chunks (160 MB total)
    let sent = 0
    function sendMore () {
      while (sent < 10) {
        sent++
        const ok = res.write(chunk)
        if (!ok) {
          res.once('drain', sendMore)
          return
        }
      }
      res.end()
    }
    sendMore()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const url = `http://127.0.0.1:${port}/stream-huge.zip`
    await assert.rejects(
      resolveSource(url),
      /archive exceeds the 150 MB download limit/
    )
  } finally {
    server.close()
    teardown()
  }
})

// ── resolveSource: unsupported input errors ───────────────────────────────────

test('resolveSource rejects non-existent paths with clean message', async () => {
  await assert.rejects(
    resolveSource('./non-existent-path-filebud-12345'),
    /cannot access \.\/non-existent-path-filebud-12345: path does not exist or is not readable/
  )
})

test('resolveSource rejects unsupported file types with helpful error', async () => {
  const workDir = join(tmpdir(), `filebud-test-unsupported-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  const sevenZip = join(workDir, 'archive.7z')
  const txtFile = join(workDir, 'notes.txt')
  writeFileSync(sevenZip, 'dummy 7z')
  writeFileSync(txtFile, 'dummy txt')

  try {
    await assert.rejects(
      resolveSource(sevenZip),
      /expected a directory or a zip\/tar\/tar\.gz\/tar\.bz2 archive/
    )

    await assert.rejects(
      resolveSource(txtFile),
      /expected a directory or a zip\/tar\/tar\.gz\/tar\.bz2 archive/
    )
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    teardown()
  }
})

test('resolveSource rejects remote URL with unsupported extension', async () => {
  await assert.rejects(
    resolveSource('http://example.com/archive.7z'),
    /expected a directory or a zip\/tar\/tar\.gz\/tar\.bz2 archive/
  )
})
