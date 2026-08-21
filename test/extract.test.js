import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { extract, isSafeEntry } from '../src/extract.js'

const execFileAsync = promisify(execFile)

function createTarBuffer (entries) {
  const blocks = []

  for (const entry of entries) {
    const header = Buffer.alloc(512, 0)
    const name = entry.name
    header.write(name, 0, Math.min(name.length, 100), 'ascii')
    header.write('0000644\0', 100, 8, 'ascii')
    header.write('0000000\0', 108, 8, 'ascii')
    header.write('0000000\0', 116, 8, 'ascii')

    const data = entry.data ? Buffer.from(entry.data) : Buffer.alloc(0)
    const sizeOctal = data.length.toString(8).padStart(11, '0') + '\0'
    header.write(sizeOctal, 124, 12, 'ascii')
    header.write('00000000000\0', 136, 12, 'ascii')

    const typeFlag = entry.type === 'symlink' ? '2' : (entry.type === 'link' ? '1' : (entry.type === 'directory' ? '5' : '0'))
    header.write(typeFlag, 156, 1, 'ascii')

    if (entry.linkname) {
      header.write(entry.linkname, 157, Math.min(entry.linkname.length, 100), 'ascii')
    }

    header.write('ustar\0', 257, 6, 'ascii')
    header.write('00', 263, 2, 'ascii')

    // Checksum calculation: sum of all bytes in header with checksum field treated as 8 spaces
    header.fill(32, 148, 156)
    let sum = 0
    for (let i = 0; i < 512; i++) {
      sum += header[i]
    }
    const checksumStr = sum.toString(8).padStart(6, '0') + '\0 '
    header.write(checksumStr, 148, 8, 'ascii')

    blocks.push(header)

    if (data.length > 0) {
      const paddedSize = Math.ceil(data.length / 512) * 512
      const dataBlock = Buffer.alloc(paddedSize, 0)
      data.copy(dataBlock)
      blocks.push(dataBlock)
    }
  }

  // End of archive: two 512-byte zero blocks
  blocks.push(Buffer.alloc(1024, 0))

  return Buffer.concat(blocks)
}

// ── isSafeEntry ───────────────────────────────────────────────────────────────

test('isSafeEntry allows normal relative paths within destDir', () => {
  const dest = '/tmp/safe-dest'
  assert.equal(isSafeEntry({ path: 'file.txt', type: 'file' }, dest), true)
  assert.equal(isSafeEntry({ path: 'sub/file.txt', type: 'file' }, dest), true)
  assert.equal(isSafeEntry({ path: 'sub/nested/deep.js', type: 'file' }, dest), true)
  assert.equal(isSafeEntry({ path: 'sub/nested', type: 'directory' }, dest), true)
  assert.equal(isSafeEntry({ path: 'sub/../file.txt', type: 'file' }, dest), true)
})

test('isSafeEntry rejects zip-slip / directory traversal sequences', () => {
  const dest = '/tmp/safe-dest'
  assert.equal(isSafeEntry({ path: '../escape.txt', type: 'file' }, dest), false)
  assert.equal(isSafeEntry({ path: '../../escape.txt', type: 'file' }, dest), false)
  assert.equal(isSafeEntry({ path: 'sub/../../escape.txt', type: 'file' }, dest), false)
  assert.equal(isSafeEntry({ path: 'a/b/../../../escape.txt', type: 'file' }, dest), false)
})

test('isSafeEntry rejects absolute paths', () => {
  const dest = '/tmp/safe-dest'
  assert.equal(isSafeEntry({ path: '/etc/passwd', type: 'file' }, dest), false)
  assert.equal(isSafeEntry({ path: '/absolute/path.txt', type: 'file' }, dest), false)
  assert.equal(isSafeEntry({ path: 'C:\\Windows\\system32', type: 'file' }, dest), false)
  assert.equal(isSafeEntry({ path: 'C:/Windows/system32', type: 'file' }, dest), false)
  assert.equal(isSafeEntry({ path: '\\\\server\\share', type: 'file' }, dest), false)
  assert.equal(isSafeEntry({ path: '\\Windows\\file.txt', type: 'file' }, dest), false)
})

test('isSafeEntry rejects symlink and hardlink entries', () => {
  const dest = '/tmp/safe-dest'
  assert.equal(isSafeEntry({ path: 'sym.txt', type: 'symlink', linkname: 'target.txt' }, dest), false)
  assert.equal(isSafeEntry({ path: 'hard.txt', type: 'link', linkname: 'target.txt' }, dest), false)
})

test('isSafeEntry rejects null bytes and invalid entries', () => {
  const dest = '/tmp/safe-dest'
  assert.equal(isSafeEntry({ path: 'file\0.txt', type: 'file' }, dest), false)
  assert.equal(isSafeEntry(null, dest), false)
  assert.equal(isSafeEntry({}, dest), false)
  assert.equal(isSafeEntry({ path: 123 }, dest), false)
})

// ── extract ───────────────────────────────────────────────────────────────────

test('extract aborts and cleans up when output exceeds the size cap', async () => {
  const workDir = join(tmpdir(), `filebud-test-bomb-${Date.now()}`)
  const archivePath = join(workDir, 'bomb.tar')
  const destDir = join(workDir, 'output')

  mkdirSync(workDir, { recursive: true })

  try {
    const tarBuffer = createTarBuffer([
      { name: 'big.txt', data: 'x'.repeat(4096) },
      { name: 'small.txt', data: 'ok' }
    ])
    writeFileSync(archivePath, tarBuffer)

    await assert.rejects(
      extract(archivePath, destDir, { maxBytes: 1024 }),
      /extracted size limit/
    )
    assert.ok(!existsSync(destDir), 'destination must be removed after abort')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('extract unpacks a safe tar archive', async () => {
  const workDir = join(tmpdir(), `filebud-test-extract-${Date.now()}`)
  const archivePath = join(workDir, 'archive.tar')
  const destDir = join(workDir, 'output')

  mkdirSync(workDir, { recursive: true })

  try {
    const tarBuffer = createTarBuffer([
      { name: 'hello.txt', data: 'hello world' },
      { name: 'dir/nested.txt', data: 'nested content' }
    ])
    writeFileSync(archivePath, tarBuffer)

    await extract(archivePath, destDir)

    assert.ok(existsSync(join(destDir, 'hello.txt')))
    assert.equal(readFileSync(join(destDir, 'hello.txt'), 'utf8'), 'hello world')
    assert.ok(existsSync(join(destDir, 'dir/nested.txt')))
    assert.equal(readFileSync(join(destDir, 'dir/nested.txt'), 'utf8'), 'nested content')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('extract skips traversal entries and does not write outside destDir', async () => {
  const workDir = join(tmpdir(), `filebud-test-slip-${Date.now()}`)
  const archivePath = join(workDir, 'slip.tar')
  const destDir = join(workDir, 'output')
  const outsideFile = join(workDir, 'escaped.txt')

  mkdirSync(workDir, { recursive: true })

  try {
    const tarBuffer = createTarBuffer([
      { name: 'valid.txt', data: 'safe content' },
      { name: '../escaped.txt', data: 'PWNED' },
      { name: 'symlink.txt', type: 'symlink', linkname: '/etc/passwd' }
    ])
    writeFileSync(archivePath, tarBuffer)

    // Capture stderr to verify warning
    let stderrOutput = ''
    const origStderrWrite = process.stderr.write
    process.stderr.write = (str) => {
      stderrOutput += str
      return true
    }

    try {
      await extract(archivePath, destDir)
    } finally {
      process.stderr.write = origStderrWrite
    }

    assert.ok(existsSync(join(destDir, 'valid.txt')), 'valid file should be extracted')
    assert.equal(readFileSync(join(destDir, 'valid.txt'), 'utf8'), 'safe content')
    assert.ok(!existsSync(outsideFile), 'file must not be extracted outside destDir')
    assert.ok(!existsSync(join(destDir, 'symlink.txt')), 'symlink must be skipped')
    assert.match(stderrOutput, /skipping unsafe archive entry: \.\.\/escaped\.txt/)
    assert.match(stderrOutput, /skipping unsafe archive entry: symlink\.txt/)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('extract unpacks a zip archive created by system zip', async () => {
  const workDir = join(tmpdir(), `filebud-test-zip-${Date.now()}`)
  const srcDir = join(workDir, 'src')
  const archivePath = join(workDir, 'archive.zip')
  const destDir = join(workDir, 'output')

  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'a.txt'), 'content a')
  writeFileSync(join(srcDir, 'b.txt'), 'content b')

  try {
    await execFileAsync('zip', ['-r', archivePath, '.'], { cwd: srcDir })
    await extract(archivePath, destDir)

    assert.ok(existsSync(join(destDir, 'a.txt')))
    assert.equal(readFileSync(join(destDir, 'a.txt'), 'utf8'), 'content a')
    assert.ok(existsSync(join(destDir, 'b.txt')))
    assert.equal(readFileSync(join(destDir, 'b.txt'), 'utf8'), 'content b')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})
