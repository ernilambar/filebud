# filebud

Browse a folder or archive as a file tree in your browser. Point it at a directory,
a zip/tar archive, or an archive URL, and it serves a dark-themed file tree with a
syntax-highlighted viewer.

> **Status:** working end to end — folder, local archive, and remote archive URL
> inputs all resolve and serve.

## Install

```sh
npm install -g filebud
```

Requires Node 22 or newer.

## Usage

```sh
filebud ./some/folder
filebud ./archive.zip
filebud ./archive.tar.gz
filebud https://example.com/archive.zip
```

Archives are extracted to a temporary directory, which is removed when filebud
exits. A folder you pass is only ever read, never modified.

On startup filebud prints the resolved root and a URL carrying a one-time
session token, then opens your browser at that URL (unless `--no-open`).

## Options

| Flag | Description |
| --- | --- |
| `--port <n>` | Port to listen on (1024–65535, default `49800`). Fails if the port is busy rather than picking another. |
| `--all` | Include `.git` and `node_modules` in the tree. Hidden by default. |
| `--no-open` | Do not open the browser automatically. |
| `-h`, `--help` | Show usage. |
| `-v`, `--version` | Show version. |

## Security

The server binds to `127.0.0.1` only, and every `/api/*` request must carry a
session token that is generated at boot and injected into the served page.
Without it, any local process — or any web page you visit — could hit the port
and read the served tree. This is a local browsing tool: it is not intended for
shared or multi-user machines.

## Notes

**Nothing is written to disk.** The editor is fully editable so you can scratch
notes or try an edit, but there is no save — changes are lost on reload.

**Loopback only.** See [Security](#security) — loopback bind plus a mandatory
session token, not meant for shared machines.

Supported archives: `zip`, `tar`, `tar.gz`, `tar.bz2`. Remote downloads are capped
at 150 MB.

## Development

```sh
npm install
npm run build   # bundle the CodeMirror editor into public/editor/
npm test
npm run lint
```

The editor bundle is generated, not committed. `npm install` builds it via the
`prepare` script — if your npm blocks lifecycle scripts, run `npm run build`
manually.

## Contributing

Contributions are welcome! To work on the repo:

1. Fork and clone the repository, then install dependencies:

   ```sh
   git clone https://github.com/ernilambar/filebud.git
   cd filebud
   npm install
   ```

2. Before opening a pull request, make sure all of these pass:

   ```sh
   npm run lint    # standard style, no warnings
   npm test        # node:test suite
   npm run build   # editor bundle builds cleanly
   ```

3. Keep pull requests focused: one fix or feature per PR, with a short
   description of what changed and why.

A few conventions the codebase follows:

- **Plain ESM everywhere** (`"type": "module"`); dependencies are pinned to
  exact versions.
- **Tests live in `test/`** using the built-in `node:test` runner — no extra
  test framework. Add a test for any bug fix or new behaviour.
- **Nothing is ever written back to disk** except tool-created temp dirs under
  `os.tmpdir()`. Any change must preserve that guarantee.
- **The frontend has no build step** — `public/app.js` is hand-written ESM
  loaded directly by the browser. Only `src/editor/` goes through Rollup.

## Manual Testing

Quick local checks for each command. Start from the repo root:

```sh
node bin/filebud.js <target> [flags]
```

| Check | Command | What to expect |
| --- | --- | --- |
| Help / version | `node bin/filebud.js --help` then `-v` | Usage with every flag; version matches `package.json`. Both exit 0. |
| Folder input | `node bin/filebud.js ./src --no-open` | Browser URL with `?t=<token>` in the banner; tree loads; `.git`/`node_modules` hidden. |
| Show hidden dirs | `node bin/filebud.js ./src --all --no-open` | `.git` and `node_modules` now appear in the tree. |
| Zip archive | `zip -r /tmp/demo.zip ./src && node bin/filebud.js /tmp/demo.zip --no-open` | Extracts to a temp dir; banner shows "temp dir will be removed on exit". |
| tar.gz archive | `tar -czf /tmp/demo.tar.gz ./src && node bin/filebud.js /tmp/demo.tar.gz --no-open` | Same as zip. |
| Remote archive URL | `node bin/filebud.js https://example.com/archive.zip --no-open` | Download progress on stderr, then extraction. |
| Custom port | `node bin/filebud.js ./src --port 3000 --no-open` | Serves on 3000. |
| Port already in use | Run the above twice | Second run exits 1 with "port ... is already in use". |
| Bad port | `node bin/filebud.js ./src --port 80` | Exits 1 with an out-of-range message. |
| Missing source | `node bin/filebud.js` | Exits 1 with "missing \<source\>". |
| Unsupported input | `node bin/filebud.js ./file.7z` | Exits 1 with the unsupported-input message. |
| Token enforcement | Open the banner URL, then remove `?t=...` and reload | API calls fail with 403; page itself still loads. |

While browsing, also verify the UI basics:

- Expand/collapse directories (click or arrow keys), open text, image, and
  binary files.
- Type in the editor, press `Cmd/Ctrl-S` → toast appears, nothing is written to
  disk, and the tree row shows the dirty dot.
- Quit with `Ctrl-C` → clean exit (code 130), and no `filebud-*` dir left in
  `$TMPDIR`.

## License

MIT
