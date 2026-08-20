#!/usr/bin/env node

import { run } from '../src/cli.js'

const config = run(process.argv)

// null means --help/--version ran, or a CliError was already reported.
if (config) {
  // Phases 2+ take over from here: resolve the source, start the server.
  process.stdout.write(`${JSON.stringify(config, null, 2)}\n`)
}
