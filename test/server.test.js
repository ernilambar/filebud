import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer, startServer, PortInUseError, hostnameFromHostHeader } from '../src/server.js'

test('server rejects requests with non-loopback Host header (DNS rebinding)', async () => {
  const root = join(tmpdir(), `filebud-srv-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const app = await createServer({ root, label: root })

    for (const host of ['evil.example.com', 'evil.example.com:49800', '192.168.1.5', '169.254.169.254', '[fd00::1]:80']) {
      const res = await app.inject({ method: 'GET', url: '/', headers: { host } })
      assert.equal(res.statusCode, 403, `host ${host} must be rejected`)
      assert.match(JSON.parse(res.body).error, /invalid host header/)
    }

    // Loopback names still work.
    for (const host of ['127.0.0.1:49800', 'localhost:49800', '[::1]:49800']) {
      const res = await app.inject({ method: 'GET', url: '/', headers: { host } })
      assert.equal(res.statusCode, 200, `host ${host} must be allowed`)
    }

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('hostnameFromHostHeader strips ports and normalizes case', () => {
  assert.equal(hostnameFromHostHeader('127.0.0.1:49800'), '127.0.0.1')
  assert.equal(hostnameFromHostHeader('LOCALHOST'), 'localhost')
  assert.equal(hostnameFromHostHeader('[::1]:8080'), '[::1]')
  assert.equal(hostnameFromHostHeader('::1'), '::1')
  assert.equal(hostnameFromHostHeader(''), '')
  assert.equal(hostnameFromHostHeader(undefined), '')
})

test('server returns generic error body for unexpected errors (no path leak)', async () => {
  const root = join(tmpdir(), `filebud-srv-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const app = await createServer({ root, label: root })
    // Force an unexpected 5xx: a route that throws without statusCode.
    app.get('/api/boom', async () => {
      throw new Error(`secret path ${root}/gone.txt`)
    })

    const res = await app.inject({ method: 'GET', url: '/api/boom' })
    assert.equal(res.statusCode, 500)
    assert.deepEqual(JSON.parse(res.body), { error: 'Internal Server Error' })
    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

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
