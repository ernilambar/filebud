import { createWriteStream } from 'node:fs'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { request } from 'undici'
import { createTempDir } from './tempdir.js'
import { extract } from './extract.js'

const ARCHIVE_EXTENSIONS = new Set([
  '.zip',
  '.tar',
  '.gz', // bare .tar.gz is matched by the two-extension check below
  '.tgz',
  '.bz2',
  '.tbz2'
])

const DOWNLOAD_CAP = 150 * 1024 * 1024 // 150 MB

function isUrl (input) {
  return input.startsWith('http://') || input.startsWith('https://')
}

function isArchiveExt (filePath) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tar.bz2')) return true
  return ARCHIVE_EXTENSIONS.has(extname(lower))
}

/**
 * Download a remote archive to a temp dir, showing byte progress on stderr.
 * Returns the path of the downloaded file.
 */
async function download (url, destDir) {
  const response = await request(url, {
    maxRedirections: 5,
    headers: { 'user-agent': 'filebud' }
  })

  if (response.statusCode < 200 || response.statusCode >= 300) {
    // Drain the body to free the socket before throwing.
    await response.body.dump().catch(() => {})
    throw new Error(
      `download failed: server returned ${response.statusCode} for ${url}`
    )
  }

  const contentLength = parseInt(response.headers['content-length'] || '0', 10)
  const fileName = basename(new URL(url).pathname) || 'archive'
  const destPath = join(destDir, fileName)

  let received = 0
  const writer = createWriteStream(destPath)

  response.body.on('data', (chunk) => {
    received += chunk.length

    if (received > DOWNLOAD_CAP) {
      writer.destroy()
      response.body.destroy(
        new Error('archive exceeds the 150 MB download limit')
      )
      return
    }

    const pct = contentLength
      ? ` (${Math.round((received / contentLength) * 100)}%)`
      : ''

    process.stderr.write(
      `\rdownloading ${formatBytes(received)}${pct}   `
    )
  })

  await pipeline(response.body, writer)
  process.stderr.write('\n')

  return destPath
}

function formatBytes (bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * After extraction, if there is exactly one top-level directory and no
 * top-level files, descend into it. This avoids the common single-folder
 * wrapper that most archives ship with.
 */
async function unwrapSingleRoot (dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory())
  const files = entries.filter((e) => e.isFile())

  if (dirs.length === 1 && files.length === 0) {
    return join(dir, dirs[0].name)
  }

  return dir
}

/**
 * Resolve any input string to { root, label, isTemp }.
 *
 * root    — absolute path of the directory to serve
 * label   — human-readable string shown in the browser header
 * isTemp  — true when root was created by filebud and must be cleaned up
 */
export async function resolveSource (input) {
  // ── URL branch ──────────────────────────────────────────────────────────────
  if (isUrl(input)) {
    const tmpDir = await createTempDir()
    const archivePath = await download(input, tmpDir)

    if (!isArchiveExt(archivePath)) {
      throw new Error(
        `unsupported archive type: ${basename(archivePath)}; ` +
        'expected a zip, tar, tar.gz, or tar.bz2 archive'
      )
    }

    const extractDir = join(tmpDir, 'extracted')
    await extract(archivePath, extractDir)
    const root = await unwrapSingleRoot(extractDir)

    return { root, label: input, isTemp: true }
  }

  const abs = resolve(input)

  // Verify the path exists and is readable before statting.
  try {
    await access(abs)
  } catch {
    throw new Error(`cannot access ${input}: path does not exist or is not readable`)
  }

  const info = await stat(abs)

  // ── Folder branch ────────────────────────────────────────────────────────────
  if (info.isDirectory()) {
    const root = await realpath(abs)
    return { root, label: root, isTemp: false }
  }

  // ── Local archive branch ─────────────────────────────────────────────────────
  if (info.isFile() && isArchiveExt(abs)) {
    const tmpDir = await createTempDir()
    const extractDir = join(tmpDir, 'extracted')

    await extract(abs, extractDir)
    const root = await unwrapSingleRoot(extractDir)

    return { root, label: input, isTemp: true }
  }

  // ── Unsupported ──────────────────────────────────────────────────────────────
  throw new Error(
    `unsupported input: ${input}; ` +
    'expected a directory or a zip/tar/tar.gz/tar.bz2 archive'
  )
}
