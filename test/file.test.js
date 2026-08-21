import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { join } from 'node:path'
import { test } from 'node:test'
import { createServer } from '../src/server.js'
import Fastify from 'fastify'
import { fileRoutes } from '../src/routes/file.js'

test('GET /api/file enforces the hard size ceiling even with force=1', async () => {
  const root = join(tmpdir(), `filebud-file-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  // Caps are injected tiny so no huge fixture is needed:
  // maxSize 10 B, hardMaxSize 20 B.
  writeFileSync(join(root, 'mid.txt'), 'a'.repeat(15))
  writeFileSync(join(root, 'over.txt'), 'b'.repeat(25))

  try {
    const app = Fastify()
    await app.register(fileRoutes, { root, maxSize: 10, hardMaxSize: 20 })

    // mid.txt (15 B): over soft cap, under hard cap — force bypasses
    const resMid = await app.inject({ method: 'GET', url: '/api/file?path=mid.txt' })
    assert.equal(JSON.parse(resMid.body).kind, 'too-large')
    const resMidForce = await app.inject({ method: 'GET', url: '/api/file?path=mid.txt&force=1' })
    assert.equal(JSON.parse(resMidForce.body).kind, 'text')

    // over.txt (25 B): over hard cap — force must NOT bypass
    const resOver = await app.inject({ method: 'GET', url: '/api/file?path=over.txt&force=1' })
    assert.equal(resOver.statusCode, 200)
    const dataOver = JSON.parse(resOver.body)
    assert.equal(dataOver.kind, 'too-large')
    assert.equal(dataOver.reason, 'size')
    assert.equal(dataOver.content, undefined)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/file returns text content and language for code files', async () => {
  const root = join(tmpdir(), `filebud-file-${Date.now()}`)
  mkdirSync(join(root, 'src'), { recursive: true })
  const jsContent = 'const x = 42;\nconsole.log(x);'
  writeFileSync(join(root, 'src', 'app.js'), jsContent)

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/file?path=src/app.js'
    })

    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    assert.equal(data.path, 'src/app.js')
    assert.equal(data.kind, 'text')
    assert.equal(data.language, 'JavaScript')
    assert.equal(data.content, jsContent)
    assert.equal(data.size, Buffer.byteLength(jsContent))
    assert.equal(typeof data.sizeHuman, 'string')

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/file returns image kind for image files without reading content', async () => {
  const root = join(tmpdir(), `filebud-file-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  const pngData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])
  writeFileSync(join(root, 'logo.png'), pngData)

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/file?path=logo.png'
    })

    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    assert.equal(data.path, 'logo.png')
    assert.equal(data.kind, 'image')
    assert.equal(data.language, null)
    assert.equal(data.content, undefined)
    assert.equal(data.size, pngData.length)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/file returns binary kind for known binary archives', async () => {
  const root = join(tmpdir(), `filebud-file-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  const zipData = Buffer.from([0x50, 0x4b, 0x03, 0x04])
  writeFileSync(join(root, 'archive.zip'), zipData)

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/file?path=archive.zip'
    })

    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    assert.equal(data.path, 'archive.zip')
    assert.equal(data.kind, 'binary')
    assert.equal(data.language, null)
    assert.equal(data.content, undefined)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/file returns too-large size for files over 10 MB, bypassable with force=1', async () => {
  const root = join(tmpdir(), `filebud-file-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  const largeSize = 12 * 1024 * 1024 // 12 MB
  const largeBuf = Buffer.alloc(largeSize, 'x')
  writeFileSync(join(root, 'huge.log'), largeBuf)

  try {
    const app = await createServer({ root, label: root })

    // Without force: too-large size
    const res = await app.inject({
      method: 'GET',
      url: '/api/file?path=huge.log'
    })
    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    assert.equal(data.kind, 'too-large')
    assert.equal(data.reason, 'size')
    assert.equal(data.content, undefined)
    assert.equal(data.size, largeSize)

    // With force=1: returns content
    const resForce = await app.inject({
      method: 'GET',
      url: '/api/file?path=huge.log&force=1'
    })
    assert.equal(resForce.statusCode, 200)
    const dataForce = JSON.parse(resForce.body)
    assert.equal(dataForce.kind, 'text')
    assert.equal(dataForce.content.length, largeSize)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/file returns too-large long-lines for lines over 500 KB, bypassable with force=1', async () => {
  const root = join(tmpdir(), `filebud-file-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  const minifiedSize = 900 * 1024 // 900 KB single line
  const minifiedBuf = Buffer.alloc(minifiedSize, 'v')
  writeFileSync(join(root, 'bundle.min.js'), minifiedBuf)

  try {
    const app = await createServer({ root, label: root })

    // Without force: too-large long-lines
    const res = await app.inject({
      method: 'GET',
      url: '/api/file?path=bundle.min.js'
    })
    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    assert.equal(data.kind, 'too-large')
    assert.equal(data.reason, 'long-lines')
    assert.equal(data.content, undefined)

    // With force=1: returns content
    const resForce = await app.inject({
      method: 'GET',
      url: '/api/file?path=bundle.min.js&force=1'
    })
    assert.equal(resForce.statusCode, 200)
    const dataForce = JSON.parse(resForce.body)
    assert.equal(dataForce.kind, 'text')
    assert.equal(dataForce.language, 'JavaScript')
    assert.equal(dataForce.content.length, minifiedSize)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/file uses binary sniff for unknown extensions with NUL or invalid UTF-8', async () => {
  const root = join(tmpdir(), `filebud-file-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  // NUL byte in unknown extension
  writeFileSync(join(root, 'data.custom'), Buffer.from([1, 2, 0, 3, 4]))
  // Invalid UTF-8 sequence
  writeFileSync(join(root, 'invalid.utf'), Buffer.from([0xff, 0xfe, 0x12]))
  // Valid text in unknown extension
  writeFileSync(join(root, 'plain.custom'), 'hello plain text')

  try {
    const app = await createServer({ root, label: root })

    const resNul = await app.inject({
      method: 'GET',
      url: '/api/file?path=data.custom'
    })
    assert.equal(JSON.parse(resNul.body).kind, 'binary')

    const resUtf = await app.inject({
      method: 'GET',
      url: '/api/file?path=invalid.utf'
    })
    assert.equal(JSON.parse(resUtf.body).kind, 'binary')

    const resText = await app.inject({
      method: 'GET',
      url: '/api/file?path=plain.custom'
    })
    const dataText = JSON.parse(resText.body)
    assert.equal(dataText.kind, 'text')
    assert.equal(dataText.content, 'hello plain text')

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/file handles errors (404, 400, 403)', async () => {
  const root = join(tmpdir(), `filebud-file-${Date.now()}`)
  mkdirSync(join(root, 'subdir'), { recursive: true })

  try {
    const app = await createServer({ root, label: root })

    // 404 missing
    const res404 = await app.inject({
      method: 'GET',
      url: '/api/file?path=missing.txt'
    })
    assert.equal(res404.statusCode, 404)

    // 400 directory
    const res400 = await app.inject({
      method: 'GET',
      url: '/api/file?path=subdir'
    })
    assert.equal(res400.statusCode, 400)

    // 403 traversal
    const res403 = await app.inject({
      method: 'GET',
      url: '/api/file?path=../../etc/passwd'
    })
    assert.equal(res403.statusCode, 403)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/raw streams raw bytes with appropriate headers', async () => {
  const root = join(tmpdir(), `filebud-file-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  writeFileSync(join(root, 'image.png'), imageBytes)

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/raw?path=image.png'
    })

    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['content-type'], 'image/png')
    assert.equal(res.headers['content-disposition'], 'inline')
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.deepEqual(res.rawPayload, imageBytes)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/raw handles errors (404, 400, 403)', async () => {
  const root = join(tmpdir(), `filebud-file-${Date.now()}`)
  mkdirSync(join(root, 'subdir'), { recursive: true })

  try {
    const app = await createServer({ root, label: root })

    const res404 = await app.inject({
      method: 'GET',
      url: '/api/raw?path=missing.png'
    })
    assert.equal(res404.statusCode, 404)

    const res400 = await app.inject({
      method: 'GET',
      url: '/api/raw?path=subdir'
    })
    assert.equal(res400.statusCode, 400)

    const res403 = await app.inject({
      method: 'GET',
      url: '/api/raw?path=../../etc/passwd'
    })
    assert.equal(res403.statusCode, 403)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
