import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getFileType, getFileKind } from '../src/lib/filetype.js'

test('filetype classifies text files and resolves language', () => {
  const js = getFileType('app.js')
  assert.equal(js.kind, 'text')
  assert.equal(js.language, 'JavaScript')
  assert.equal(js.mime, 'text/javascript')

  const ts = getFileType('index.ts')
  assert.equal(ts.kind, 'text')
  assert.equal(ts.language, 'TypeScript')

  const json = getFileType('package.json')
  assert.equal(json.kind, 'text')
  assert.equal(json.language, 'JSON')
  assert.equal(json.mime, 'application/json')

  const md = getFileType('README.md')
  assert.equal(md.kind, 'text')
  assert.equal(md.language, 'Markdown')
  assert.equal(md.mime, 'text/markdown')

  const py = getFileType('script.py')
  assert.equal(py.kind, 'text')
  assert.equal(py.language, 'Python')

  const docker = getFileType('Dockerfile')
  assert.equal(docker.kind, 'text')
  assert.equal(docker.language, 'Dockerfile')

  // Extension-less config file with an explicit language override
  const editorconfig = getFileType('.editorconfig')
  assert.equal(editorconfig.kind, 'text')
  assert.equal(editorconfig.language, 'Properties files')

  const ini = getFileType('config.ini')
  assert.equal(ini.kind, 'text')
  assert.equal(ini.language, 'Properties files')

  const txt = getFileType('notes.txt')
  assert.equal(txt.kind, 'text')
  assert.equal(txt.mime, 'text/plain')
})

test('filetype classifies image files', () => {
  const png = getFileType('photo.png')
  assert.equal(png.kind, 'image')
  assert.equal(png.mime, 'image/png')
  assert.equal(png.language, null)

  const jpg = getFileType('picture.jpg')
  assert.equal(jpg.kind, 'image')
  assert.equal(jpg.mime, 'image/jpeg')

  const svg = getFileType('icon.svg')
  assert.equal(svg.kind, 'image')
  assert.equal(svg.mime, 'image/svg+xml')

  const webp = getFileType('banner.webp')
  assert.equal(webp.kind, 'image')
  assert.equal(webp.mime, 'image/webp')
})

test('filetype classifies binary files', () => {
  const zip = getFileType('archive.zip')
  assert.equal(zip.kind, 'binary')
  assert.equal(zip.mime, 'application/zip')

  const pdf = getFileType('document.pdf')
  assert.equal(pdf.kind, 'binary')
  assert.equal(pdf.mime, 'application/pdf')

  const wasm = getFileType('module.wasm')
  assert.equal(wasm.kind, 'binary')
  assert.equal(wasm.mime, 'application/wasm')

  const mp4 = getFileType('video.mp4')
  assert.equal(mp4.kind, 'binary')
  assert.equal(mp4.mime, 'video/mp4')
})

test('getFileKind returns kind string directly', () => {
  assert.equal(getFileKind('index.html'), 'text')
  assert.equal(getFileKind('avatar.png'), 'image')
  assert.equal(getFileKind('bundle.zip'), 'binary')
})
