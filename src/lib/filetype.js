import { extname, basename } from 'node:path'
import { languages } from '@codemirror/language-data'

const LanguageDescription = languages.length > 0 ? languages[0].constructor : null

const IMAGE_MIMES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}

const BINARY_MIMES = {
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.tbz2': 'application/x-bzip2',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/x-rar-compressed',
  '.xz': 'application/x-xz',
  '.zst': 'application/zstd',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.exe': 'application/octet-stream',
  '.dll': 'application/octet-stream',
  '.so': 'application/octet-stream',
  '.dylib': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.o': 'application/octet-stream',
  '.a': 'application/octet-stream',
  '.db': 'application/octet-stream',
  '.sqlite': 'application/octet-stream',
  '.sqlite3': 'application/octet-stream',
  '.iso': 'application/octet-stream',
  '.dmg': 'application/octet-stream',
  '.class': 'application/octet-stream',
  '.pyc': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject'
}

const TEXT_MIMES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/plain',
  '.mts': 'text/plain',
  '.cts': 'text/plain',
  '.jsx': 'text/javascript',
  '.tsx': 'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values'
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
export const MAX_LINE_LENGTH = 500 * 1024 // 500 KB
export const SNIFF_SIZE = 8 * 1024 // 8 KB

/**
 * Check if a buffer contains binary data (NUL bytes or invalid UTF-8 in first 8 KB).
 */
export function isBinaryBuffer (buffer) {
  const slice = buffer.subarray(0, SNIFF_SIZE)
  if (slice.includes(0)) return true

  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    decoder.decode(slice, { stream: true })
    return false
  } catch {
    return true
  }
}

/**
 * Check if any single line in buffer exceeds MAX_LINE_LENGTH.
 */
export function hasLongLine (buffer, maxLineLength = MAX_LINE_LENGTH) {
  let lineStart = 0
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) { // '\n'
      if (i - lineStart > maxLineLength) {
        return true
      }
      lineStart = i + 1
    }
  }
  if (buffer.length - lineStart > maxLineLength) {
    return true
  }
  return false
}

/**
 * Classify a file by filename / extension.
 * Returns { kind: 'text' | 'image' | 'binary', mime: string, language: string | null }
 */
export function getFileType (filename) {
  const base = basename(filename).toLowerCase()
  const ext = extname(base)

  // 1. Image check
  if (IMAGE_MIMES[ext]) {
    return {
      kind: 'image',
      mime: IMAGE_MIMES[ext],
      language: null
    }
  }

  // 2. Binary check
  if (BINARY_MIMES[ext] || base === '.ds_store') {
    return {
      kind: 'binary',
      mime: BINARY_MIMES[ext] || 'application/octet-stream',
      language: null
    }
  }

  // 3. CodeMirror language-data lookup
  let language = null
  if (LanguageDescription) {
    const match = LanguageDescription.matchFilename(languages, basename(filename))
    if (match) {
      language = match.name
    }
  }

  const mime = TEXT_MIMES[ext] || 'text/plain'

  return {
    kind: 'text',
    mime,
    language
  }
}

/**
 * Get file kind ('text' | 'image' | 'binary') for filename.
 */
export function getFileKind (filename) {
  return getFileType(filename).kind
}
