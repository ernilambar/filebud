# filebud

Browse a folder or archive as a file tree in your browser. Point it at a directory,
a zip/tar archive, or an archive URL, and it serves a dark-themed file tree with a
syntax-highlighted viewer.

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
| `--port <n>` | Port to listen on (1024–65535, default `49800`). Fails if the port is busy. |
| `--all` | Include `.git` and `node_modules` in the tree. Hidden by default. |
| `--no-open` | Do not open the browser automatically. |
| `-h`, `--help` | Show usage. |
| `-v`, `--version` | Show version. |


## Development

```sh
npm install
npm run build
npm test
npm run lint
```

The editor bundle is generated, not committed. `npm install` builds it via the
`prepare` script — if your npm blocks lifecycle scripts, run `npm run build`
manually.

## Contributing

Contributions are welcome!

1. Fork, clone, and run `npm install`.
2. Ensure `npm run lint`, `npm test`, and `npm run build` all pass.
3. Open a focused PR (one fix or feature) with a short description.

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

[MIT](LICENSE) © 2026 [Nilambar Sharma](https://www.nilambar.net)

