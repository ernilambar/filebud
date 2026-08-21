import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer } from '../src/server.js'
import { generateToken } from '../src/token.js'

function makeFixture () {
  const root = join(tmpdir(), `filebud-token-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'a.txt'), 'hello')
  return root
}

test('generateToken returns a long random hex string', () => {
  const a = generateToken()
  const b = generateToken()

  assert.match(a, /^[0-9a-f]{48}$/)
  assert.notEqual(a, b, 'tokens must not repeat across sessions')
})

test('/api/* without a token is rejected with 403', async () => {
  const root = makeFixture()

  try {
    const app = await createServer({ root, label: root, token: generateToken() })

    const resTree = await app.inject({ method: 'GET', url: '/api/tree' })
    assert.equal(resTree.statusCode, 403)

    const resFile = await app.inject({ method: 'GET', url: '/api/file?path=a.txt' })
    assert.equal(resFile.statusCode, 403)

    const resRaw = await app.inject({ method: 'GET', url: '/api/raw?path=a.txt' })
    assert.equal(resRaw.statusCode, 403)

    const resMeta = await app.inject({ method: 'GET', url: '/api/meta' })
    assert.equal(resMeta.statusCode, 403)

    const body = JSON.parse(resTree.body)
    assert.match(body.error, /token/)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a wrong token is rejected just like a missing one', async () => {
  const root = makeFixture()

  try {
    const app = await createServer({ root, label: root, token: generateToken() })

    const res = await app.inject({ method: 'GET', url: '/api/tree?t=not-the-token' })
    assert.equal(res.statusCode, 403)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the correct token via ?t= grants access', async () => {
  const root = makeFixture()
  const token = generateToken()

  try {
    const app = await createServer({ root, label: root, token })

    const res = await app.inject({ method: 'GET', url: `/api/tree?t=${token}` })
    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    assert.ok(data.entries.some((e) => e.name === 'a.txt'))

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the correct token via the x-filebud-token header grants access', async () => {
  const root = makeFixture()
  const token = generateToken()

  try {
    const app = await createServer({ root, label: root, token })

    const res = await app.inject({
      method: 'GET',
      url: '/api/meta',
      headers: { 'x-filebud-token': token }
    })
    assert.equal(res.statusCode, 200)
    assert.equal(JSON.parse(res.body).root, root)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('static assets stay reachable without a token, and the token is injected into index.html', async () => {
  const root = makeFixture()
  const token = generateToken()

  try {
    const app = await createServer({ root, label: root, token })

    // The page itself must load without ?t= — that is how the browser first
    // arrives (the URL carries the token, but nothing else needs it).
    const resIndex = await app.inject({ method: 'GET', url: '/' })
    assert.equal(resIndex.statusCode, 200)
    assert.ok(!resIndex.body.includes('__FILEBUD_TOKEN__'), 'placeholder must be replaced')
    // The token must land only in the string literal — if it were substituted
    // into the variable name the inline script would throw a SyntaxError and
    // the client would send an empty token (403 on every API call).
    assert.match(
      resIndex.body,
      new RegExp(`window\\.filebudToken = '${token}'`),
      'inline script must assign the token as a quoted string'
    )

    const resStyle = await app.inject({ method: 'GET', url: '/style.css' })
    assert.equal(resStyle.statusCode, 200)

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
