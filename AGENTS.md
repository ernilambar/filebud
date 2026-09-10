# AGENTS.md

## Overview

filebud is a read-only local file browser that serves a directory or zip/tar
archive as a dark-themed file tree with a CodeMirror-backed viewer. Backend is
Node.js (22+), ESM, Fastify, and `@fastify/static`; the frontend is static
HTML/CSS/JS plus a Rollup-built editor bundle; tests use the built-in
`node:test` runner.

## Setup

Requires Node.js 22 or newer.

```sh
npm install
```

`npm install` builds the editor bundle through the `prepare` script. If
lifecycle scripts are blocked, run `npm run build` manually afterward.

## Commands

```sh
npm run build
npm test
npm run lint
npm run format
```

Typecheck: none — this project is plain JavaScript and has no TypeScript, Flow,
or JSDoc type checker configured.

## Conventions

- Use ESM (`import`/`export`) everywhere and import Node built-ins with the
  `node:` prefix (`node:fs`, `node:path`). Do not introduce CommonJS.
- Keep the server read-only and loopback-only. Bind to `127.0.0.1`, preserve
  the host and session-token gates in `src/server.js`, and never leak stack
  traces through the API.
- Route every user-supplied path through `resolveSafePath` in
  `src/lib/pathsafe.js` before touching the filesystem.
- Downloaded archives and extracted files are temporary. Create temp dirs only
  through `src/tempdir.js` (`createTempDir`) and clean them up on exit with
  `cleanupAll`.
- Backend routes are Fastify plugin functions under `src/routes/*.js`; pure
  helpers live in `src/lib/*.js`. The frontend entry is `src/editor/main.mjs`
  and builds to `public/editor/`, which is generated and must not be edited by
  hand.

## Quality gate

Run each command and confirm it exits 0 before declaring a task complete:

```sh
npm run lint
npm test
npm run build
```
