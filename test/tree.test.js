import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer } from '../src/server.js'

test('GET /api/tree returns only first-level children of root', async () => {
  const root = join(tmpdir(), `filebud-tree-${Date.now()}`)
  mkdirSync(join(root, 'src', 'nested'), { recursive: true })
  writeFileSync(join(root, 'src', 'cli.js'), 'console.log("cli")')
  writeFileSync(join(root, 'src', 'nested', 'deep.js'), 'console.log("deep")')
  writeFileSync(join(root, 'package.json'), '{"name":"test"}')
  writeFileSync(join(root, 'logo.png'), 'fake png data')

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/tree'
    })

    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    assert.equal(data.path, '')

    // Root should only contain 'src' (dir), 'logo.png' (file), 'package.json' (file)
    // and NOT 'deep.js' or 'cli.js'
    const names = data.entries.map((e) => e.name)
    assert.deepEqual(names, ['src', 'logo.png', 'package.json'])

    // Directory entry check
    const srcEntry = data.entries.find((e) => e.name === 'src')
    assert.deepEqual(srcEntry, {
      name: 'src',
      path: 'src',
      type: 'dir'
    })

    // File entry checks
    const pkgEntry = data.entries.find((e) => e.name === 'package.json')
    assert.equal(pkgEntry.type, 'file')
    assert.equal(pkgEntry.path, 'package.json')
    assert.equal(pkgEntry.kind, 'text')
    assert.equal(typeof pkgEntry.size, 'number')
    assert.equal(typeof pkgEntry.sizeHuman, 'string')

    const imgEntry = data.entries.find((e) => e.name === 'logo.png')
    assert.equal(imgEntry.type, 'file')
    assert.equal(imgEntry.kind, 'image')

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/tree?path=src returns children of subdirectory', async () => {
  const root = join(tmpdir(), `filebud-tree-${Date.now()}`)
  mkdirSync(join(root, 'src', 'routes'), { recursive: true })
  writeFileSync(join(root, 'src', 'cli.js'), Buffer.alloc(4096, 'a'))
  writeFileSync(join(root, 'src', 'routes', 'tree.js'), 'tree code')

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/tree?path=src'
    })

    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    assert.equal(data.path, 'src')

    assert.equal(data.entries.length, 2)
    assert.deepEqual(data.entries[0], {
      name: 'routes',
      path: 'src/routes',
      type: 'dir'
    })
    assert.equal(data.entries[1].name, 'cli.js')
    assert.equal(data.entries[1].path, 'src/cli.js')
    assert.equal(data.entries[1].type, 'file')
    assert.equal(data.entries[1].size, 4096)
    assert.equal(data.entries[1].sizeHuman, '4 KB')
    assert.equal(data.entries[1].kind, 'text')

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/tree sorts directories first and uses case-insensitive natural order', async () => {
  const root = join(tmpdir(), `filebud-tree-${Date.now()}`)
  mkdirSync(join(root, 'dirB'), { recursive: true })
  mkdirSync(join(root, 'dirA'), { recursive: true })
  mkdirSync(join(root, 'dir10'), { recursive: true })
  mkdirSync(join(root, 'dir2'), { recursive: true })

  writeFileSync(join(root, 'file10.txt'), '10')
  writeFileSync(join(root, 'file2.txt'), '2')
  writeFileSync(join(root, 'a.txt'), 'a')
  writeFileSync(join(root, 'B.txt'), 'b')

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/tree'
    })

    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    const names = data.entries.map((e) => e.name)

    // Expected order:
    // Dirs: dir2, dir10, dirA, dirB
    // Files: a.txt, B.txt, file2.txt, file10.txt
    assert.deepEqual(names, [
      'dir2',
      'dir10',
      'dirA',
      'dirB',
      'a.txt',
      'B.txt',
      'file2.txt',
      'file10.txt'
    ])

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/tree skips .git and node_modules by default, includes with all: true', async () => {
  const root = join(tmpdir(), `filebud-tree-${Date.now()}`)
  mkdirSync(join(root, '.git'), { recursive: true })
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'index.js'), 'app')

  try {
    // Default (all = false)
    const appNormal = await createServer({ root, label: root, all: false })
    const resNormal = await appNormal.inject({
      method: 'GET',
      url: '/api/tree'
    })
    const dataNormal = JSON.parse(resNormal.body)
    assert.deepEqual(dataNormal.entries.map((e) => e.name), ['src', 'index.js'])
    await appNormal.close()

    // With all = true
    const appAll = await createServer({ root, label: root, all: true })
    const resAll = await appAll.inject({
      method: 'GET',
      url: '/api/tree'
    })
    const dataAll = JSON.parse(resAll.body)
    assert.deepEqual(dataAll.entries.map((e) => e.name), ['.git', 'node_modules', 'src', 'index.js'])
    await appAll.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/tree handles empty directory', async () => {
  const root = join(tmpdir(), `filebud-tree-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/tree'
    })
    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    assert.deepEqual(data, { path: '', entries: [] })
    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/tree returns 400 when path is a file', async () => {
  const root = join(tmpdir(), `filebud-tree-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'file.txt'), 'content')

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/tree?path=file.txt'
    })
    assert.equal(res.statusCode, 400)
    assert.match(JSON.parse(res.body).error, /not a directory/)
    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/tree returns 404 when path does not exist', async () => {
  const root = join(tmpdir(), `filebud-tree-${Date.now()}`)
  mkdirSync(root, { recursive: true })

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/tree?path=missing_dir'
    })
    assert.equal(res.statusCode, 404)
    assert.match(JSON.parse(res.body).error, /Directory not found/)
    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /api/tree handles symlinked files and directories inside root', async () => {
  const root = join(tmpdir(), `filebud-tree-${Date.now()}`)
  mkdirSync(join(root, 'real_dir'), { recursive: true })
  writeFileSync(join(root, 'real_file.txt'), 'real')
  symlinkSync(join(root, 'real_dir'), join(root, 'sym_dir'))
  symlinkSync(join(root, 'real_file.txt'), join(root, 'sym_file.txt'))

  try {
    const app = await createServer({ root, label: root })
    const res = await app.inject({
      method: 'GET',
      url: '/api/tree'
    })
    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)

    const symDir = data.entries.find((e) => e.name === 'sym_dir')
    assert.equal(symDir.type, 'dir')

    const symFile = data.entries.find((e) => e.name === 'sym_file.txt')
    assert.equal(symFile.type, 'file')
    assert.equal(symFile.kind, 'text')

    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
