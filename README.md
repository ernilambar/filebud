# filebud

Browse a folder or archive as a file tree in your browser. Point it at a directory,
a zip/tar archive, or an archive URL, and it serves a dark-themed file tree with a
syntax-highlighted viewer.

> **Status:** in development. The CLI parses and validates arguments; the server and
> UI are not wired up yet.

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

## Options

| Flag | Description |
| --- | --- |
| `--port <n>` | Port to listen on (1024–65535, default `49800`). Fails if the port is busy rather than picking another. |
| `--all` | Include `.git` and `node_modules` in the tree. Hidden by default. |
| `--no-open` | Do not open the browser automatically. |
| `-h`, `--help` | Show usage. |
| `-v`, `--version` | Show version. |

## Notes

**Nothing is written to disk.** The editor is fully editable so you can scratch
notes or try an edit, but there is no save — changes are lost on reload.

**Loopback only.** The server binds to `127.0.0.1` and requires a session token
generated at startup. It is not meant for shared or multi-user machines.

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

## License

MIT
