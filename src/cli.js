import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import cac from 'cac'

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

export const DEFAULT_PORT = 49800
export const MIN_PORT = 1024
export const MAX_PORT = 65535

/**
 * An expected, user-facing failure. `run` prints the message and exits 1 rather
 * than showing a stack trace.
 */
export class CliError extends Error {
  constructor (message) {
    super(message)
    this.name = 'CliError'
  }
}

/**
 * Collect the raw, uncoerced text a user passed for an option.
 *
 * cac (via mri) coerces before we see the value: `--port 0x10` arrives as 16,
 * `--port 1e4` as 10000, `--port 3000.5` as a float, and `--port -1` as boolean
 * `true`. Validating only the coerced value would silently accept all of those,
 * so the raw token is what gets checked.
 *
 * Returns an array so a repeated flag can be rejected too.
 */
function rawOptionValues (argv, flag) {
  const values = []
  const args = argv.slice(2)

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === flag) {
      values.push(args[i + 1])
      i++
    } else if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1))
    }
  }

  return values
}

function validatePort (argv) {
  const raw = rawOptionValues(argv, '--port')

  if (raw.length === 0) return DEFAULT_PORT

  if (raw.length > 1) {
    throw new CliError('--port was given more than once')
  }

  const value = raw[0]

  if (!/^\d+$/.test(value)) {
    throw new CliError(
      `invalid --port ${JSON.stringify(value)}: expected a whole number`
    )
  }

  const port = Number(value)

  if (port < MIN_PORT || port > MAX_PORT) {
    throw new CliError(
      `--port ${port} is out of range: expected ${MIN_PORT}-${MAX_PORT}`
    )
  }

  return port
}

/**
 * Build the cac instance. `onCommand` receives the matched source and options.
 */
export function buildCli (onCommand = () => {}) {
  const cli = cac('filebud')

  cli
    .command('<source>', 'Folder, archive, or archive URL to browse')
    .option('--port <port>', `Port to listen on (${MIN_PORT}-${MAX_PORT})`, {
      default: DEFAULT_PORT
    })
    .option('--all', 'Include .git and node_modules in the tree')
    .option('--no-open', 'Do not open the browser automatically')
    .action((source, options) => onCommand(source, options))

  cli.help()
  cli.version(pkg.version)

  return cli
}

/**
 * Turn cac's internal phrasing into something aimed at users.
 */
function friendlyMessage (message) {
  if (message.startsWith('missing required args')) {
    return 'missing <source>: pass a folder, archive, or archive URL'
  }

  if (message.startsWith('Unused args:')) {
    return `unexpected extra argument(s): ${message.slice('Unused args:'.length).trim()}`
  }

  return message
}

/**
 * Parse and validate argv.
 *
 * Returns null when cac handled --help or --version, since no command should run
 * in that case. Throws CliError for anything the user can fix.
 */
export function parseArgs (argv) {
  let result = null

  // Handle -v/--version ourselves: cac's built-in output includes the platform
  // and node version, but this flag should print nothing but the number.
  // The flag stays registered on the command below so it still appears in
  // --help.
  const args = argv.slice(2)
  if (args.includes('-v') || args.includes('--version')) {
    process.stdout.write(`${pkg.version}\n`)
    return null
  }

  const cli = buildCli((source, options) => {
    result = {
      source,
      port: validatePort(argv),
      all: Boolean(options.all),
      open: options.open !== false
    }
  })

  try {
    cli.parse(argv)
  } catch (error) {
    // cac validates unknown flags, missing option values, and extra positionals
    // before invoking the action, so those all surface here as CACError.
    if (error instanceof CliError) throw error
    throw new CliError(friendlyMessage(error.message))
  }

  return result
}

export function run (argv = process.argv) {
  try {
    return parseArgs(argv)
  } catch (error) {
    if (!(error instanceof CliError)) throw error

    process.stderr.write(`filebud: ${error.message}\n`)
    process.stderr.write('Run `filebud --help` for usage.\n')
    process.exitCode = 1

    return null
  }
}
