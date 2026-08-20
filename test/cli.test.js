import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  CliError,
  DEFAULT_PORT,
  MAX_PORT,
  MIN_PORT,
  parseArgs
} from '../src/cli.js'

const execFileAsync = promisify(execFile)

const binPath = fileURLToPath(new URL('../bin/filebud.js', import.meta.url))
const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

function runCli (args) {
  return execFileAsync(process.execPath, [binPath, ...args])
}

/** parseArgs expects a full argv, including the node and script entries. */
function parse (...args) {
  return parseArgs(['node', 'filebud', ...args])
}

function assertCliError (args, pattern) {
  assert.throws(
    () => parse(...args),
    (error) => {
      assert.ok(error instanceof CliError, `expected CliError, got ${error.name}`)
      assert.match(error.message, pattern)
      return true
    },
    `expected ${JSON.stringify(args)} to be rejected`
  )
}

test('--help exits 0 and lists every flag', async () => {
  const { stdout } = await runCli(['--help'])

  assert.match(stdout, /filebud/)
  assert.match(stdout, /--port/)
  assert.match(stdout, /--all/)
  assert.match(stdout, /--no-open/)
  assert.match(stdout, /-h, --help/)
  assert.match(stdout, /-v, --version/)
})

test('-h matches --help', async () => {
  const long = await runCli(['--help'])
  const short = await runCli(['-h'])

  assert.equal(short.stdout, long.stdout)
})

test('--version prints the package version and exits 0', async () => {
  const { stdout } = await runCli(['--version'])

  assert.match(stdout, new RegExp(pkg.version.replace(/\./g, '\\.')))
})

test('-v matches --version', async () => {
  const long = await runCli(['--version'])
  const short = await runCli(['-v'])

  assert.equal(short.stdout, long.stdout)
})

test('--help and --version return null so no command runs', () => {
  assert.equal(parse('--help'), null)
  assert.equal(parse('--version'), null)
})

test('source is required', () => {
  assertCliError([], /missing <source>/)
})

test('defaults apply when only a source is given', () => {
  assert.deepEqual(parse('./folder'), {
    source: './folder',
    port: DEFAULT_PORT,
    all: false,
    open: true
  })
})

test('--all and --no-open are reflected in the config', () => {
  const config = parse('./folder', '--all', '--no-open')

  assert.equal(config.all, true)
  assert.equal(config.open, false)
})

test('--port accepts a valid port in both syntaxes', () => {
  assert.equal(parse('./folder', '--port', '3000').port, 3000)
  assert.equal(parse('./folder', '--port=3000').port, 3000)
})

test('--port accepts the range boundaries', () => {
  assert.equal(parse('./folder', '--port', String(MIN_PORT)).port, MIN_PORT)
  assert.equal(parse('./folder', '--port', String(MAX_PORT)).port, MAX_PORT)
})

test('--port rejects values outside the range', () => {
  assertCliError(['./folder', '--port', '80'], /out of range/)
  assertCliError(['./folder', '--port', String(MIN_PORT - 1)], /out of range/)
  assertCliError(['./folder', '--port', String(MAX_PORT + 1)], /out of range/)
})

test('--port rejects non-integer text', () => {
  assertCliError(['./folder', '--port', 'abc'], /expected a whole number/)
  assertCliError(['./folder', '--port', ''], /expected a whole number/)
})

// mri coerces these before cac sees them: 0x10 becomes 16, 1e4 becomes 10000,
// and 3000.5 stays a float. All three are in range once coerced, so validating
// the coerced number alone would let a typo silently bind an unexpected port.
test('--port rejects values that look numeric only after coercion', () => {
  assertCliError(['./folder', '--port', '0x10'], /expected a whole number/)
  assertCliError(['./folder', '--port', '1e4'], /expected a whole number/)
  assertCliError(['./folder', '--port', '3000.5'], /expected a whole number/)
  assertCliError(['./folder', '--port', ' 3000'], /expected a whole number/)
})

test('--port rejects being passed twice', () => {
  assertCliError(
    ['./folder', '--port', '3000', '--port', '4000'],
    /more than once/
  )
})

test('--port requires a value', () => {
  assertCliError(['./folder', '--port'], /value is missing/)
})

test('unknown flags are rejected rather than ignored', () => {
  assertCliError(['./folder', '--bogus'], /Unknown option/)
  assertCliError(['./folder', '-x'], /Unknown option/)
})

test('extra positionals are rejected', () => {
  assertCliError(['./folder', './other'], /unexpected extra argument/)
})

test('invalid input exits 1 with a message and a help pointer', async () => {
  await assert.rejects(
    runCli(['./folder', '--port', 'abc']),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /expected a whole number/)
      assert.match(error.stderr, /--help/)
      assert.equal(error.stdout, '', 'errors must not write to stdout')
      return true
    }
  )
})
