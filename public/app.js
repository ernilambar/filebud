// filebud frontend — plain ESM, no build step. Wires the tree pane to the
// viewer pane and drives everything (including keyboard nav) from `state`.

import { mount as mountEditor } from './editor/main.js'
import { iconForFile } from './file-icons.js'

const treeRootEl = document.getElementById('tree-root')
const viewerPlaceholderEl = document.getElementById('viewer-placeholder')
const viewerEditorEl = document.getElementById('viewer-editor')
const viewerStatusEl = document.getElementById('viewer-status')
const viewerImageEl = document.getElementById('viewer-image')
const viewerBinaryEl = document.getElementById('viewer-binary')
const viewerTooLargeEl = document.getElementById('viewer-too-large')
const dividerEl = document.getElementById('divider')
const toastEl = document.getElementById('toast')
const sourceLabelEl = document.getElementById('source-label')
const sourceRootEl = document.getElementById('source-root')
const appVersionEl = document.getElementById('app-version')

const TREE_WIDTH_KEY = 'filebud.treeWidth'

// Injected into index.html at request time by the server (window.filebudToken).
// Every /api/* call must carry it.
const TOKEN = window.filebudToken || ''

function apiUrl (url) {
  return `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(TOKEN)}`
}

const ICONS = {
  chevron: '<svg viewBox="0 0 16 16" class="chevron" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  folder: '<svg viewBox="0 0 16 16" class="icon" aria-hidden="true"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.13a1.5 1.5 0 0 1 1.06.44L7.7 3.5H13.5A1.5 1.5 0 0 1 15 5v7.5A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9z" fill="currentColor"/></svg>',
  file: '<svg viewBox="0 0 16 16" class="icon" aria-hidden="true"><path d="M3 1.5h6l3.5 3.5V14.5H3z" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  image: '<svg viewBox="0 0 16 16" class="icon" aria-hidden="true"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="5.5" cy="5.5" r="1.2" fill="currentColor"/><path d="M2 11l3.5-3.5L8 10l2.5-2.5L14 11" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  binaryLarge: '<svg viewBox="0 0 24 24" class="icon-large" aria-hidden="true"><path d="M5 2h9l5 5v15H5z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M14 2v5h5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  tooLargeLarge: '<svg viewBox="0 0 24 24" class="icon-large" aria-hidden="true"><path d="M5 2h9l5 5v15H5z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M14 2v5h5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M12 10v5" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="17.5" r="0.8" fill="currentColor"/></svg>'
}

const state = {
  expanded: new Set(),
  children: new Map(), // dir path -> entries[] | 'loading'
  fileCache: new Map(), // file path -> { original, content, meta, dirty }
  rows: [], // flattened visible rows
  focusedPath: null,
  selectedPath: null,
  abortController: null,
  editor: null,
  meta: { root: '', label: '' }
}

function fetchJSON (url, options) {
  return fetch(apiUrl(url), options).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `request failed: ${res.status}`)
    }
    return res.json()
  })
}

async function loadMeta () {
  try {
    const meta = await fetchJSON('/api/meta')
    state.meta = { root: String(meta.root || ''), label: String(meta.label || '') }
    sourceLabelEl.textContent = state.meta.label
    sourceRootEl.textContent = state.meta.root
    appVersionEl.textContent = meta.version ? `v${meta.version}` : ''
  } catch {
    // Non-critical: header just stays blank.
  }
}

async function loadChildren (dirPath) {
  const data = await fetchJSON(`/api/tree?path=${encodeURIComponent(dirPath)}`)
  state.children.set(dirPath, data.entries)
  return data.entries
}

// Re-fetch every currently expanded directory. The scratch-pad file cache is
// deliberately kept: refreshing the listing must not discard unsaved edits.
async function refreshTree () {
  const dirs = ['', ...state.expanded]
  state.children.clear()

  await Promise.all(dirs.map(async (dir) => {
    try {
      await loadChildren(dir)
    } catch {}
  }))

  // Dirs that vanished (or failed to reload) collapse out of the tree.
  for (const dir of state.expanded) {
    if (!state.children.has(dir)) state.expanded.delete(dir)
  }

  renderTree()
}

// ── Tree rendering ──────────────────────────────────────────────────────────

function buildVisibleRows () {
  const rows = []

  function walk (dirPath, depth) {
    const entries = state.children.get(dirPath)
    if (!Array.isArray(entries)) return

    for (const entry of entries) {
      rows.push({ ...entry, depth })
      if (entry.type === 'dir' && state.expanded.has(entry.path)) {
        walk(entry.path, depth + 1)
      }
    }
  }

  walk('', 0)
  state.rows = rows
  return rows
}

function rowLabel (entry) {
  const parts = [entry.name]
  if (entry.type === 'file') parts.push(entry.sizeHuman || '')
  return parts.join(', ')
}

function renderTree () {
  const rows = buildVisibleRows()
  treeRootEl.innerHTML = ''

  // Roving tabindex: only one row (focused, or the first) is tabbable.
  let tabbablePath = state.focusedPath
  if (!rows.some((r) => r.path === tabbablePath)) {
    tabbablePath = rows.length > 0 ? rows[0].path : null
  }

  for (const entry of rows) {
    const el = document.createElement('div')
    el.className = 'tree-row'
    el.dataset.path = entry.path
    el.dataset.type = entry.type
    el.setAttribute('role', 'treeitem')
    el.setAttribute('aria-level', String(entry.depth + 1))
    el.setAttribute('tabindex', entry.path === tabbablePath ? '0' : '-1')
    el.setAttribute('aria-label', rowLabel(entry))
    el.style.paddingLeft = `${8 + entry.depth * 16}px`

    if (entry.type === 'dir') {
      const isExpanded = state.expanded.has(entry.path)
      el.setAttribute('aria-expanded', String(isExpanded))
      el.innerHTML = `${ICONS.chevron}${ICONS.folder}<span class="name">${escapeHtml(entry.name)}</span>`
    } else {
      const icon = iconForFile(entry.name) || (entry.kind === 'image' ? ICONS.image : ICONS.file)
      const cached = state.fileCache.get(entry.path)
      const dirty = cached && cached.dirty
      el.innerHTML =
        `<span class="chevron"></span>${icon}<span class="name">${escapeHtml(entry.name)}</span>` +
        (dirty ? '<span class="dirty-dot" title="Unsaved changes (never written to disk)"></span>' : '') +
        `<span class="size">${escapeHtml(entry.sizeHuman || '')}</span>`
    }

    if (entry.path === state.selectedPath) {
      el.classList.add('selected')
    }

    treeRootEl.appendChild(el)
  }
}

function escapeHtml (str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

async function toggleDir (entry) {
  if (state.expanded.has(entry.path)) {
    state.expanded.delete(entry.path)
    renderTree()
    focusRow(entry.path)
    return
  }

  state.expanded.add(entry.path)

  if (!state.children.has(entry.path)) {
    // Show a loading row while the first fetch is in flight.
    renderLoadingRow(entry.path)
    try {
      await loadChildren(entry.path)
    } catch {
      state.expanded.delete(entry.path)
    }
  }

  renderTree()
  focusRow(entry.path)
}

function renderLoadingRow (dirPath) {
  const rows = buildVisibleRows()
  const parentIndex = rows.findIndex((r) => r.path === dirPath)
  renderTree()
  if (parentIndex === -1) return
  const parentEl = treeRootEl.children[parentIndex]
  if (!parentEl) return
  const loadingEl = document.createElement('div')
  loadingEl.className = 'tree-row loading'
  loadingEl.textContent = 'Loading…'
  loadingEl.style.paddingLeft = `${8 + (Number(parentEl.getAttribute('aria-level')) * 16)}px`
  parentEl.insertAdjacentElement('afterend', loadingEl)
}

function focusRow (path) {
  state.focusedPath = path
  const rowEl = treeRootEl.querySelector(`[data-path="${cssEscape(path)}"]`)
  if (rowEl) {
    treeRootEl.querySelectorAll('.tree-row[tabindex="0"]').forEach((el) => el.setAttribute('tabindex', '-1'))
    rowEl.setAttribute('tabindex', '0')
    rowEl.focus()
  }
}

function cssEscape (str) {
  return String(str).replace(/["\\]/g, '\\$&')
}

// ── Row interaction ─────────────────────────────────────────────────────────

treeRootEl.addEventListener('click', (event) => {
  const rowEl = event.target.closest('.tree-row')
  if (!rowEl || rowEl.dataset.path === undefined) return
  handleRowActivate(rowEl.dataset.path)
})

function findRow (path) {
  return state.rows.find((r) => r.path === path)
}

async function handleRowActivate (path) {
  const entry = findRow(path)
  if (!entry) return

  if (entry.type === 'dir') {
    await toggleDir(entry)
  } else {
    state.selectedPath = path
    state.focusedPath = path
    renderTree()
    focusRow(path)
    await openFile(entry)
  }
}

treeRootEl.addEventListener('keydown', (event) => {
  const rowEl = event.target.closest('.tree-row')
  if (!rowEl) return
  const path = rowEl.dataset.path
  const index = state.rows.findIndex((r) => r.path === path)
  if (index === -1) return
  const entry = state.rows[index]

  switch (event.key) {
    case 'ArrowDown': {
      event.preventDefault()
      const next = state.rows[index + 1]
      if (next) focusRow(next.path)
      break
    }
    case 'ArrowUp': {
      event.preventDefault()
      const prev = state.rows[index - 1]
      if (prev) focusRow(prev.path)
      break
    }
    case 'ArrowRight': {
      event.preventDefault()
      if (entry.type === 'dir' && !state.expanded.has(entry.path)) {
        toggleDir(entry)
      } else if (entry.type === 'dir') {
        const next = state.rows[index + 1]
        if (next) focusRow(next.path)
      }
      break
    }
    case 'ArrowLeft': {
      event.preventDefault()
      if (entry.type === 'dir' && state.expanded.has(entry.path)) {
        toggleDir(entry)
      }
      break
    }
    case 'Enter': {
      event.preventDefault()
      handleRowActivate(entry.path)
      break
    }
    default:
      break
  }
})

// ── Viewer ───────────────────────────────────────────────────────────────────

function hideAllViewers () {
  viewerPlaceholderEl.hidden = true
  viewerEditorEl.hidden = true
  viewerStatusEl.hidden = true
  viewerImageEl.hidden = true
  viewerBinaryEl.hidden = true
  viewerTooLargeEl.hidden = true
}

const viewerStatus = { line: 1, col: 1, lines: 0, chars: 0 }

function renderViewerStatus () {
  const { line, col, lines, chars } = viewerStatus
  const plural = (n, word) => `${n} ${n === 1 ? word : word + 's'}`
  viewerStatusEl.textContent =
    `Ln ${line}, Col ${col} · ${plural(lines, 'line')} · ${plural(chars, 'char')}`
}

function updateViewerStatus (content) {
  const text = String(content || '')
  viewerStatus.lines = text.length === 0 ? 0 : text.split('\n').length
  viewerStatus.chars = text.length
  renderViewerStatus()
}

function showPlaceholder (message) {
  hideAllViewers()
  viewerPlaceholderEl.hidden = false
  viewerPlaceholderEl.textContent = message
}

function getEditor () {
  if (!state.editor) {
    state.editor = mountEditor(viewerEditorEl)
  }
  return state.editor
}

async function showTextViewer (entry, data, cached) {
  hideAllViewers()
  viewerEditorEl.hidden = false
  viewerStatusEl.hidden = false
  const editor = getEditor()

  const content = cached ? cached.content : data.content

  // Reset for the new document; onCursor below keeps it live afterwards.
  viewerStatus.line = 1
  viewerStatus.col = 1

  await editor.setFile({ content, language: data.language })
  updateViewerStatus(content)

  editor.onCursor = ({ line, col }) => {
    viewerStatus.line = line
    viewerStatus.col = col
    renderViewerStatus()
  }

  editor.onChange = (doc) => {
    updateViewerStatus(doc)
    const record = state.fileCache.get(entry.path)
    if (!record) return
    record.content = doc
    const wasDirty = record.dirty
    record.dirty = doc !== record.original
    if (wasDirty !== record.dirty) renderTree()
  }
}

function showImageViewer (entry, data) {
  hideAllViewers()
  viewerImageEl.hidden = false
  viewerImageEl.innerHTML = ''

  const img = document.createElement('img')
  img.src = apiUrl(`/api/raw?path=${encodeURIComponent(entry.path)}`)
  img.alt = entry.name

  const meta = document.createElement('div')
  meta.className = 'image-meta'

  img.addEventListener('load', () => {
    meta.textContent = `${img.naturalWidth} × ${img.naturalHeight} — ${data.sizeHuman}`
  })

  viewerImageEl.appendChild(img)
  viewerImageEl.appendChild(meta)
}

function showBinaryViewer (entry, data) {
  hideAllViewers()
  viewerBinaryEl.hidden = false
  const rawUrl = apiUrl(`/api/raw?path=${encodeURIComponent(entry.path)}`)
  viewerBinaryEl.innerHTML = `
    ${ICONS.binaryLarge}
    <div class="filename">${escapeHtml(entry.name)}</div>
    <div>${escapeHtml(data.sizeHuman)}</div>
    <div class="note">Not editable — binary file</div>
    <div class="actions"><a href="${rawUrl}" download="${escapeHtml(entry.name)}">Download</a></div>
  `
}

function showTooLargeViewer (entry, data) {
  hideAllViewers()
  viewerTooLargeEl.hidden = false
  const reason = data.reason === 'long-lines'
    ? 'contains lines too long to render'
    : `exceeds the display size limit (${data.sizeHuman})`
  const rawUrl = apiUrl(`/api/raw?path=${encodeURIComponent(entry.path)}`)
  viewerTooLargeEl.innerHTML = `
    ${ICONS.tooLargeLarge}
    <div class="filename">${escapeHtml(entry.name)}</div>
    <div class="reason">${escapeHtml(reason)}</div>
    <div class="actions">
      <a href="#" data-open-anyway data-path="${escapeHtml(entry.path)}">Open anyway</a>
      <a href="${rawUrl}" download="${escapeHtml(entry.name)}">Download</a>
    </div>
  `
  viewerTooLargeEl.querySelector('[data-open-anyway]').addEventListener('click', async (event) => {
    event.preventDefault()
    await openFile(entry, { force: true })
  })
}

async function openFile (entry, { force = false } = {}) {
  if (state.abortController) state.abortController.abort()
  const controller = new AbortController()
  state.abortController = controller

  const cached = state.fileCache.get(entry.path)
  if (cached && cached.dirty && !force) {
    // Reuse the in-memory edited buffer instead of re-fetching the original.
    await showTextViewer(entry, { language: cached.meta.language }, cached)
    return
  }

  try {
    const url = `/api/file?path=${encodeURIComponent(entry.path)}${force ? '&force=1' : ''}`
    const data = await fetchJSON(url, { signal: controller.signal })
    if (controller.signal.aborted) return

    if (data.kind === 'text') {
      if (!state.fileCache.has(entry.path)) {
        state.fileCache.set(entry.path, {
          original: data.content,
          content: data.content,
          meta: { language: data.language },
          dirty: false
        })
      }
      await showTextViewer(entry, data, null)
    } else if (data.kind === 'image') {
      showImageViewer(entry, data)
    } else if (data.kind === 'binary') {
      showBinaryViewer(entry, data)
    } else if (data.kind === 'too-large') {
      showTooLargeViewer(entry, data)
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    showPlaceholder(`Failed to load ${entry.name}: ${error.message}`)
  }
}

// ── Scratch-pad honesty: Cmd/Ctrl-S toast ───────────────────────────────────

let toastTimer = null
function showToast (message) {
  toastEl.textContent = message
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.hidden = true }, 2500)
}

document.addEventListener('keydown', (event) => {
  const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
  if (isSave) {
    event.preventDefault()
    showToast('scratch pad — edits are never saved')
    return
  }

  // Single-key shortcuts must not fire while typing in the editor or an input.
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.target.closest('.cm-editor, input, textarea')) return

  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault()
    refreshTree().then(() => showToast('tree refreshed'))
  } else if (event.key === 'c' || event.key === 'C') {
    const entry = findRow(state.focusedPath)
    if (!entry || !state.meta.root) return
    event.preventDefault()
    const absPath = `${state.meta.root}/${entry.path}`
    navigator.clipboard.writeText(absPath).then(
      () => showToast(`copied: ${absPath}`),
      () => showToast('could not copy path')
    )
  }
})

// ── Divider drag, persisted to localStorage ─────────────────────────────────

function applyTreeWidth (width) {
  document.documentElement.style.setProperty('--tree-width', `${width}px`)
}

function initDivider () {
  const saved = Number(localStorage.getItem(TREE_WIDTH_KEY))
  if (saved > 100) applyTreeWidth(saved)

  let dragging = false

  dividerEl.addEventListener('mousedown', () => {
    dragging = true
    document.body.style.cursor = 'col-resize'
  })

  window.addEventListener('mousemove', (event) => {
    if (!dragging) return
    const width = Math.max(160, Math.min(event.clientX, window.innerWidth - 200))
    applyTreeWidth(width)
  })

  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    document.body.style.cursor = ''
    const width = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tree-width'), 10)
    localStorage.setItem(TREE_WIDTH_KEY, String(width))
  })

  dividerEl.addEventListener('keydown', (event) => {
    const current = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tree-width'), 10)
    if (event.key === 'ArrowLeft') {
      const next = Math.max(160, current - 16)
      applyTreeWidth(next)
      localStorage.setItem(TREE_WIDTH_KEY, String(next))
    } else if (event.key === 'ArrowRight') {
      const next = current + 16
      applyTreeWidth(next)
      localStorage.setItem(TREE_WIDTH_KEY, String(next))
    }
  })
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function init () {
  initDivider()
  loadMeta()

  await loadChildren('')
  renderTree()

  const rootEntries = state.children.get('') || []
  const firstFile = rootEntries.find((e) => e.type === 'file')

  if (firstFile) {
    state.selectedPath = firstFile.path
    state.focusedPath = firstFile.path
    renderTree()
    focusRow(firstFile.path)
    await openFile(firstFile)
  } else {
    showPlaceholder('This folder has no files at the top level')
  }
}

init()
