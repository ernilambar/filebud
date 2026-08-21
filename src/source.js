import { createWriteStream } from 'node:fs'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { Agent, interceptors, request } from 'undici'
import { createTempDir } from './tempdir.js'
import { extract } from './extract.js'

const redirectDispatcher = new Agent().compose(
  interceptors.redirect({ maxRedirections: 5 })
)

const ARCHIVE_EXTENSIONS = [
  '.zip',
  '.tar',
  '.tar.gz',
  '.tgz',
  '.tar.bz2',
  '.tbz2'
]

const DOWNLOAD_CAP = 150 * 1024 * 1024 // 150 MB

export function isArchiveExt (filePath) {
  if (typeof filePath !== 'string') return false
  const lower = filePath.toLowerCase()
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function isUrl (input) {
  if (typeof input !== 'string') return false
  try {
    const url = new URL(input)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function formatBytes (bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Derive a safe file name from a URL. The raw basename is percent-decoded
 * (malformed sequences fall back to the raw text), then reduced to a bare
 * name again — decoding can reintroduce `../`, absolute paths, or drive
 * letters that would escape destDir.
 */
export function safeDownloadName (url) {
  const parsedUrl = new URL(url)
  const rawBaseName = basename(parsedUrl.pathname)

  let fileName
  try {
    fileName = decodeURIComponent(rawBaseName)
  } catch {
    fileName = rawBaseName
  }

  fileName = basename(fileName)

  if (
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.includes('\\') ||
    /^[A-Za-z]:/.test(fileName)
  ) {
    return 'archive'
  }

  return fileName
}

/**
 * Download a remote archive to a temp dir, showing byte progress on stderr.
 * Returns the path of the downloaded file.
 */
async function download (url, destDir) {
  const fileName = safeDownloadName(url)

  const response = await request(url, {
    dispatcher: redirectDispatcher,
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
  if (contentLength > DOWNLOAD_CAP) {
    await response.body.dump().catch(() => {})
    throw new Error('archive exceeds the 150 MB download limit')
  }

  const destPath = join(destDir, fileName)
  let received = 0
  const writer = createWriteStream(destPath)

  const progressStream = new Transform({
    transform (chunk, encoding, callback) {
      received += chunk.length

      if (received > DOWNLOAD_CAP) {
        callback(new Error('archive exceeds the 150 MB download limit'))
        return
      }

      const pct = contentLength > 0
        ? ` (${Math.round((received / contentLength) * 100)}%)`
        : ''

      process.stderr.write(
        `\rdownloading ${formatBytes(received)}${pct}   `
      )
      callback(null, chunk)
    }
  })

  try {
    await pipeline(response.body, progressStream, writer)
  } finally {
    if (received > 0) {
      process.stderr.write('\n')
    }
  }

  return destPath
}

/**
 * After extraction, if there is exactly one top-level directory and no
 * top-level files, descend into it. This avoids the common single-folder
 * wrapper that most archives ship with.
 */
async function unwrapSingleRoot (dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory())
  const nonDirs = entries.filter((e) => !e.isDirectory())

  if (dirs.length === 1 && nonDirs.length === 0) {
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
    const parsedUrl = new URL(input)
    const urlName = basename(parsedUrl.pathname)
    if (urlName && extname(urlName) && !isArchiveExt(urlName)) {
      throw new Error(
        `unsupported input: ${input}; ` +
        'expected a directory or a zip/tar/tar.gz/tar.bz2 archive'
      )
    }

    const tmpDir = await createTempDir()
    const archivePath = await download(input, tmpDir)

    const extractDir = join(tmpDir, 'extracted')
    const entries = await extract(archivePath, extractDir)

    if ((!entries || entries.length === 0) && (!urlName || !isArchiveExt(urlName))) {
      throw new Error(
        `unsupported input: ${input}; ` +
        'expected a directory or a zip/tar/tar.gz/tar.bz2 archive'
      )
    }

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
