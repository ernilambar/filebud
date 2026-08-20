import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer, startServer, PortInUseError } from '../src/server.js'

test('server serves static index.html at root /', async () => {
  const root = join(tmpdir(), `filebud-srv-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const app = await createServer({ root, label: root })
    const response = await app.inject({
      method: 'GET',
      url: '/'
    })

    assert.equal(response.statusCode, 200)
    assert.match(response.headers['content-type'], /text\/html/)
    assert.match(response.body, /filebud/)
    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('server returns 403 for traversal path parameter on /api/tree', async () => {
  const root = join(tmpdir(), `filebud-srv-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const app = await createServer({ root, label: root })
    const response = await app.inject({
      method: 'GET',
      url: '/api/tree?path=../../etc/passwd'
    })

    assert.equal(response.statusCode, 403)
    const data = JSON.parse(response.body)
    assert.equal(typeof data.error, 'string')
    assert.match(data.error, /escapes root/)
    assert.equal(data.stack, undefined, 'stack traces must not be leaked')
    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('server returns 403 for absolute path parameter on /api/tree', async () => {
  const root = join(tmpdir(), `filebud-srv-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const app = await createServer({ root, label: root })
    const response = await app.inject({
      method: 'GET',
      url: '/api/tree?path=/etc/passwd'
    })

    assert.equal(response.statusCode, 403)
    const data = JSON.parse(response.body)
    assert.equal(typeof data.error, 'string')
    assert.match(data.error, /Absolute paths/)
    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('server returns 403 for traversal path parameter on /api/file and /api/raw', async () => {
  const root = join(tmpdir(), `filebud-srv-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const app = await createServer({ root, label: root })

    const resFile = await app.inject({
      method: 'GET',
      url: '/api/file?path=../../etc/passwd'
    })
    assert.equal(resFile.statusCode, 403)
    assert.match(JSON.parse(resFile.body).error, /escapes root/)

    const resRaw = await app.inject({
      method: 'GET',
      url: '/api/raw?path=/etc/passwd'
    })
    assert.equal(resRaw.statusCode, 403)
    assert.match(JSON.parse(resRaw.body).error, /Absolute paths/)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('server returns 403 for symlinks escaping root', async () => {
  const root = join(tmpdir(), `filebud-srv-${Date.now()}`)
  const outside = join(tmpdir(), `filebud-srv-outside-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  symlinkSync(join(outside, 'secret.txt'), join(root, 'sym_secret'))

  try {
    const app = await createServer({ root, label: root })
    const response = await app.inject({
      method: 'GET',
      url: '/api/file?path=sym_secret'
    })

    assert.equal(response.statusCode, 403)
    const data = JSON.parse(response.body)
    assert.match(data.error, /Symlink escapes root/)
    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('server returns 403 for null bytes in path', async () => {
  const root = join(tmpdir(), `filebud-srv-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const app = await createServer({ root, label: root })
    const response = await app.inject({
      method: 'GET',
      url: '/api/tree?path=file%00.txt'
    })

    assert.equal(response.statusCode, 403)
    const data = JSON.parse(response.body)
    assert.match(data.error, /null bytes/)
    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('startServer throws PortInUseError on EADDRINUSE', async () => {
  const root = join(tmpdir(), `filebud-srv-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const app1 = await createServer({ root, label: root })
    await startServer(app1, 0) // Listen on random available port
    const address = app1.server.address()
    const port = address.port

    const app2 = await createServer({ root, label: root })

    await assert.rejects(
      () => startServer(app2, port),
      (err) => {
        assert.ok(err instanceof PortInUseError)
        assert.equal(err.code, 'EADDRINUSE')
        assert.match(err.message, new RegExp(`port ${port} is already in use; pass --port <n> to choose another`))
        return true
      }
    )

    await app1.close()
    await app2.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
