#!/usr/bin/env node

import { resolveSource } from '../src/source.js'
import { createServer, startServer } from '../src/server.js'
import { generateToken } from '../src/token.js'
import {
  cleanupAll,
  onShutdown,
  registerCleanupListeners,
  sweepStaleDirs
} from '../src/tempdir.js'
import { run } from '../src/cli.js'

// null means --help/--version ran, or a CliError was already reported.
const config = run(process.argv)
if (!config) process.exit()

function fail (error) {
  process.stderr.write(`filebud: ${error.message}\n`)
  process.exitCode = 1
}

async function main () {
  // Best-effort reclaim of dirs left behind by a SIGKILLed session.
  await sweepStaleDirs()

  let source
  try {
    source = await resolveSource(config.source)
  } catch (error) {
    fail(error)
    return
  }

  const token = generateToken()
  const app = await createServer({
    root: source.root,
    label: source.label,
    all: config.all,
    token
  })

  // Close the server before temp cleanup runs.
  onShutdown(() => app.close())
  registerCleanupListeners()

  try {
    await startServer(app, config.port)
  } catch (error) {
    fail(error)
    return
  }

  const url = `http://127.0.0.1:${config.port}/?t=${token}`

  process.stdout.write('\n')
  process.stdout.write('  filebud\n')
  process.stdout.write(`  serving ${source.root}\n`)
  process.stdout.write(`  url     ${url}\n`)
  if (source.isTemp) {
    process.stdout.write('          temp dir will be removed on exit\n')
  }
  process.stdout.write('\n  press Ctrl-C to stop\n\n')

  if (config.open) {
    const { default: open } = await import('open')
    await open(url).catch(() => {})
  }
}

main().catch((error) => {
  fail(error)
  cleanupAll()
})
