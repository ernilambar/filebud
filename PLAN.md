# filebud — Implementation Plan

A CLI that serves a browsable file tree + file viewer in the browser for a local
folder, a local archive, or a remote archive URL. Optimised for browsing a project
you are actively working on. Nothing is ever written back to disk.

```
filebud ./some/folder
filebud ./archive.zip
filebud ./archive.tar.gz
filebud https://example.com/archive.zip
filebud ./folder --port 3000
```

---

## Constraints

Two non-obvious constraints that shape the phases below.

### Scratch-pad honesty

An editable editor that never saves looks identical to one that does, so the
no-save behaviour is signalled explicitly:

- Persistent header badge: "scratch pad — edits are never saved".
- `Cmd/Ctrl-S` is captured and shows a toast, instead of the browser's "Save page as".
- A modified buffer puts a dot marker on its tree row.
- Modified buffers are cached in memory per path, so switching away and back within
  a session keeps the typing rather than silently reverting.

### Extraction memory

`decompress` reads the whole archive into memory before writing, and applies
`filter` only after that read. Therefore:

- Peak memory is roughly the uncompressed archive size, so the remote download cap
  is 150 MB with a clear error above it.
- The unsafe-entry filter blocks unsafe writes, not unsafe reads. Nothing reaches
  disk, which is the boundary that matters, but it is not a memory guard.
- If archive size becomes a real constraint, the fix is `yauzl` + `tar-fs` for true
  streaming extraction.

---

## Phase 0 — Project scaffolding

**Goal:** installable, lintable, runnable skeleton.

- `package.json`: name `filebud`, `type: module`,
  `bin: { filebud: "./bin/filebud.js" }`, `engines.node >= 22`,
  `files: ["bin", "src", "public"]`.
- Pinned dependencies (exact versions, no ranges):
  `fastify@5.12.1`, `@fastify/static@10.1.3`, `cac@7.0.0`, `undici@8.10.0`,
  `open@11.0.1`, `@xhmikosr/decompress@11.1.4`, `codemirror@6.0.2`,
  `@codemirror/theme-one-dark@6.1.3`, `@codemirror/language-data@6.5.2`.
  Dev: `standard@17.1.2`, `rollup@4.62.4`, `@rollup/plugin-node-resolve@16.0.3`.
- Scripts: `build` (rollup), `start`, `lint`, `lint:fix`, `test`,
  `prepare` (runs `build`, so a git clone and an npm install both produce a bundle).
- `rollup.config.mjs`: input `src/editor/main.mjs`, output `public/editor.bundle.js`
  as `iife`, with `nodeResolve()`.
- `standard` ignores the generated `public/editor.bundle.js`. `.editorconfig`
  already carries a `[*.{js,mjs,cjs}]` space/2 override so it agrees with
  `standard`; tabs stay for everything else.
- Extend `.gitignore` with `/tmp/` and `public/editor.bundle.js`.

**Directory layout**

```
bin/filebud.js          # shebang, thin wrapper -> src/cli.js
src/cli.js              # cac setup, flag parsing, orchestration
src/source.js           # resolve input -> { root, label, isTemp }
src/download.js         # undici archive download to temp
src/extract.js          # @xhmikosr/decompress + traversal guards
src/tempdir.js          # temp dir creation + signal/exit cleanup registry
src/server.js           # fastify instance + route registration
src/routes/tree.js      # GET /api/tree
src/routes/file.js      # GET /api/file, GET /api/raw
src/lib/pathsafe.js     # resolve + containment check for every request path
src/lib/filetype.js     # text / image / binary classification
src/lib/humansize.js    # byte formatting
src/editor/main.mjs     # rollup entry: basicSetup + oneDark, exports a mount API
public/index.html
public/app.js           # tree + pane wiring (plain ESM, loaded directly)
public/style.css        # dark theme
public/editor.bundle.js # rollup output (gitignored, built by `prepare`)
test/                   # node:test
```

The editor bundle is the only bundled artifact. `app.js` stays hand-written ESM the
browser loads as-is, so tree and UI work needs no build step.

**Exit criteria:** `npm run lint` passes; `npm run build` emits
`public/editor.bundle.js`; `node bin/filebud.js --help` prints usage.

---

## Phase 1 — CLI surface

**Goal:** all flags parsed and validated before any I/O happens.

- `cac('filebud')` with a single positional: `<path-or-archive-or-url>`.
- Options: `--port <n>` (default `49800`), `--all`, `--no-open`,
  `-h/--help`, `-v/--version` (version read from `package.json`).
- Validation: port is an integer in `1024–65535`; positional is required and
  produces a helpful error + usage when missing.
- Unknown flags → error, not silent ignore.

**Exit criteria:** `-h`, `--help`, `-v`, `--version`, bad port, and missing
positional each produce the right output and exit code (`0` for help/version,
`1` for errors).

---

## Phase 2 — Temp directory lifecycle & cleanup

**Goal:** never leave extracted files behind. Built before extraction so extraction
can rely on it.

- `tempdir.js` keeps a module-level `Set` of registered directories.
- `createTempDir()` → `fs.mkdtemp(path.join(os.tmpdir(), 'filebud-'))`, registers it.
- `cleanupAll()` uses synchronous `fs.rmSync(dir, { recursive: true, force: true })`
  because `process.on('exit')` cannot await async work.
- Listeners registered once, idempotent, guarded by a `cleanedUp` flag:
  - `process.on('exit', cleanupAll)`
  - `process.on('SIGINT', ...)` → cleanup, then `process.exit(130)`
  - `process.on('SIGTERM', ...)` → cleanup, then `process.exit(143)`
  - `process.on('uncaughtException' | 'unhandledRejection')` → log, cleanup, exit `1`
- `SIGKILL` cannot be trapped. Mitigation: the shared `filebud-` prefix makes stale
  dirs identifiable, and a best-effort sweep of `filebud-*` dirs older than 24h runs
  at startup.
- Folder input is never registered for cleanup. Only tool-created temp dirs are ever
  deleted. Gets a dedicated test.

**Exit criteria:** temp dir is gone after normal exit, after `Ctrl-C`, and after a
thrown error. A user-supplied folder is untouched in all three cases.

---

## Phase 3 — Source resolution

**Goal:** `resolveSource(input)` → `{ root, label, isTemp }`.

- URL branch: `undici.request` with redirect following, non-2xx → error, stream the
  body to `<temp>/<basename>` via `pipeline`, then extract. Byte-count progress on
  stderr, 150 MB cap.
- Local archive branch: verify readable, extract to temp. Recognised extensions:
  `.zip`, `.tar`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2`.
- Folder branch: `realpath` it, use directly, `isTemp: false`.
- Anything else → "unsupported input; expected a directory or a
  zip/tar/tar.gz/tar.bz2 archive", rather than an opaque decompress failure.
- `extract.js` passes a `filter` to decompress rejecting:
  - entry paths resolving outside the destination (`../` traversal)
  - absolute entry paths
  - symlink and link entries

  Each rejected entry is warned about on stderr and skipped.
- After extraction, if there is exactly one top-level directory and no top-level
  files, descend into it. Done by inspecting the result, not decompress's `strip`,
  which would mangle multi-root archives.

**Exit criteria:** folder, zip, and tar.gz inputs all resolve to a usable root; a
crafted traversal archive cannot write outside the temp dir (tested); a `.7z`
produces the unsupported-input error.

---

## Phase 4 — Server + path safety

**Goal:** fastify serving static assets and a locked-down file API.

- `@fastify/static` mounts `public/` at `/`.
- Every API route takes a `path` query param relative to root. `pathsafe.js`:
  1. reject null bytes,
  2. `path.resolve(root, rel)`,
  3. assert the result is `root` or starts with `root + path.sep`,
  4. `lstat` and reject symlinks that escape root.

  Failure → `403`, never a filesystem error leak.
- Listen on `127.0.0.1:<port>`. `EADDRINUSE` → exit `1` with
  `port 49800 is already in use; pass --port <n> to choose another`.
- Global error handler returns JSON `{ error }`; stack traces never reach the client.

**Exit criteria:** server boots; `?path=../../etc/passwd` and absolute paths both
return `403`.

---

## Phase 5 — Lazy tree API

**Goal:** one directory level per request.

- `GET /api/tree?path=<rel>` → children of that directory only:
  ```json
  { "path": "src", "entries": [
    { "name": "cli.js", "path": "src/cli.js", "type": "file",
      "size": 4096, "sizeHuman": "4 KB", "kind": "text" },
    { "name": "routes", "path": "src/routes", "type": "dir" }
  ] }
  ```
- `readdir(..., { withFileTypes: true })`, `stat` files for size, directories report
  no size (avoids recursive walks).
- Sort: directories first, then files, both case-insensitive natural order.
- Skip `.git` and `node_modules` unless `--all`.
- `humansize.js`: `B / KB / MB / GB`, base 1024, one decimal above KB.
- `kind` is computed server-side (`text` | `image` | `binary`) so the client knows
  which view to use before fetching content.

**Exit criteria:** requesting the root returns only first-level entries; sizes are
formatted; a deep tree costs one request per expansion.

---

## Phase 6 — File content API

**Goal:** serve exactly what each viewer needs.

- `GET /api/file?path=<rel>` → JSON:
  `{ path, size, sizeHuman, kind, language, content }`.
  - Over 10 MB → `{ kind: 'too-large', reason: 'size' }`, no content.
  - Longest line over 500 KB → `{ kind: 'too-large', reason: 'long-lines' }`,
    checked while reading so a minified bundle never reaches CodeMirror.
  - `?force=1` bypasses both caps, backing the "open anyway" link.
  - Binary sniff: NUL byte or invalid UTF-8 in the first 8 KB → `{ kind: 'binary' }`.
  - `language` resolved from extension via `@codemirror/language-data`, which
    lazy-loads the matching mode in the browser rather than bundling every language.
- `GET /api/raw?path=<rel>` → streamed bytes with correct `Content-Type`, used by
  `<img>` previews and download links. Sets `Content-Disposition: inline` and
  `X-Content-Type-Options: nosniff`.
- `filetype.js` maps extensions → `{ kind, mime, language }`; unknown extensions
  fall back to the content sniff.

**Exit criteria:** a `.js` file returns text + language, a `.png` returns
`kind: image`, a `.zip` returns `kind: binary`, a 12 MB log returns
`too-large/size`, a 900 KB single-line `bundle.min.js` returns
`too-large/long-lines`, and `?force=1` returns content for both.

---

## Phase 7 — Frontend (dark mode)

**Goal:** the UI. Split pane: tree left, viewer right.

- **Layout:** CSS grid, resizable divider (drag, persisted to `localStorage`),
  header showing the source label and root path.
- **Dark theme:** CSS custom properties in one `:root` block so a light theme is a
  later drop-in. CodeMirror uses `oneDark`.
- **Tree behaviour:**
  - initial render = `GET /api/tree?path=` (root, first level only)
  - directory row click toggles expand/collapse; children fetched on first expand
    and then cached in memory
  - chevron rotates, loading row shown while fetching, expanded state kept in a
    `Set` of paths
  - file rows show name + right-aligned human size
  - keyboard support: up/down to move, right/left to expand/collapse, `Enter` to
    open. Rows use `role="treeitem"` with `aria-expanded`/`aria-level` inside a
    `role="tree"` container.
  - rows are focusable, visible focus ring, no colour-only state cues
- **Initial selection:** after the root listing loads, select the first file in it.
  If the root has no files, show an empty placeholder rather than auto-descending.
- **Viewer states**, chosen from `kind`:
  - `text` → CodeMirror `basicSetup` + `oneDark`, editable. Line numbers, syntax
    highlighting, search, and bracket matching come free with `basicSetup`.
  - `image` → centered `<img src="/api/raw?...">` on a checkerboard backdrop, with
    natural dimensions and file size
  - `binary` → large file-type icon, filename, size, an explicit "not editable"
    note, and a download link. Inline SVG icons, no icon font.
  - `too-large` → same icon treatment with the reason spelled out ("12.4 MB exceeds
    the 10 MB display limit" / "contains lines too long to render") plus
    "open anyway" and download links.
- **Client-side detail:** one in-flight request per pane, superseded requests
  aborted via `AbortController` so fast clicking cannot render stale content. File
  switching uses `EditorState.create` + `view.setState`, keeping a single
  `EditorView` alive for the session.

**Exit criteria:** open a repo, expand/collapse levels, click through text, image,
and binary files, and drive the whole tree from the keyboard.

---

## Phase 8 — Hardening, DX, docs

- **Session token:** generated at boot, injected into `index.html`, required on
  `/api/*`. Without it, any local process or any page you visit can hit
  `127.0.0.1:49800` and read your filesystem.
- `open` launches `http://127.0.0.1:<port>/?t=<token>` unless `--no-open`.
- Startup banner: resolved root, URL, and a "temp dir will be removed on exit" note
  when applicable.
- Graceful shutdown: `fastify.close()` before temp cleanup.
- Tests (`node:test`): `humansize`, `filetype`, `pathsafe` traversal cases, archive
  traversal rejection, temp cleanup including the never-delete-user-folder guard,
  tree/file route responses against a fixture directory.
- `README.md`: install, usage, all flags, screenshot, security note (loopback +
  token, not intended for shared machines).
- `prepare` builds the editor bundle; verify an `npm pack` tarball works from a
  clean install.

**Exit criteria:** `standard` clean, tests green, `npx filebud <folder>` works from
a packed tarball.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Serving a filesystem over HTTP | loopback bind + mandatory session token (Phase 8); path containment checks (Phase 4) |
| Malicious archives (zip-slip) | entry validation before write, symlink rejection (Phase 3) |
| Temp dir survives a crash | sync cleanup on `exit`/signals + startup sweep of stale `filebud-*` dirs |
| Deleting a user's real folder | `isTemp` flag; only tool-created dirs are registered for deletion; dedicated test |
| User types edits and loses them | scratch-pad badge, `Cmd-S` toast, dirty dot on tree rows, in-memory buffer cache |
| Large archive exhausts memory | decompress is in-memory by design; 150 MB cap, `yauzl` escape hatch documented |
| Minified bundles freezing the tab | long-line guard at 500 KB/line, enforced server-side |
| Huge directories (100k entries) | per-level fetch caps the payload; virtualise rows only if measurement shows a problem |
| CodeMirror bundling | Rollup + `nodeResolve` per upstream guidance; `prepare` script; verified from a packed tarball |
