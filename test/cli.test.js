import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const execFileAsync = promisify(execFile)

const binPath = fileURLToPath(new URL('../bin/filebud.js', import.meta.url))
const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

function runCli (args) {
  return execFileAsync(process.execPath, [binPath, ...args])
}

test('--help lists usage and exits 0', async () => {
  const { stdout } = await runCli(['--help'])

  assert.match(stdout, /filebud/)
  assert.match(stdout, /--port/)
  assert.match(stdout, /--all/)
})

test('-h matches --help', async () => {
  const long = await runCli(['--help'])
  const short = await runCli(['-h'])

  assert.equal(short.stdout, long.stdout)
})

test('--version prints the package version', async () => {
  const { stdout } = await runCli(['--version'])

  assert.match(stdout, new RegExp(pkg.version.replace(/\./g, '\\.')))
})

test('-v matches --version', async () => {
  const long = await runCli(['--version'])
  const short = await runCli(['-v'])

  assert.equal(short.stdout, long.stdout)
})

test('missing source exits 1 with a message and a help pointer', async () => {
  await assert.rejects(
    runCli([]),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /missing required args/)
      assert.match(error.stderr, /--help/)
      return true
    }
  )
})
