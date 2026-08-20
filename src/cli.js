import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import cac from 'cac'

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

export const DEFAULT_PORT = 49800

/**
 * Build the cac instance. Kept separate from `run` so tests can inspect the
 * parsed result without triggering process exits.
 */
export function buildCli () {
  const cli = cac('filebud')

  cli
    .command('<source>', 'Folder, archive, or archive URL to browse')
    .option('--port <port>', 'Port to listen on', { default: DEFAULT_PORT })
    .option('--all', 'Include .git and node_modules in the tree')
    .option('--no-open', 'Do not open the browser automatically')
    .action(() => {})

  cli.help()
  cli.version(pkg.version)

  return cli
}

export function run (argv) {
  const cli = buildCli()

  // cac throws on missing or unknown args. Phase 1 adds real validation; this
  // keeps the scaffolding from dumping a stack trace at users in the meantime.
  try {
    cli.parse(argv)
  } catch (error) {
    process.stderr.write(`filebud: ${error.message}\n`)
    process.stderr.write('Run `filebud --help` for usage.\n')
    process.exitCode = 1
  }
}
