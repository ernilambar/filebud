import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatHumanSize } from '../src/lib/humansize.js'

test('formatHumanSize formats bytes with base 1024 and 1 decimal place above KB', () => {
  assert.equal(formatHumanSize(0), '0 B')
  assert.equal(formatHumanSize(-10), '0 B')
  assert.equal(formatHumanSize(NaN), '0 B')
  assert.equal(formatHumanSize(1), '1 B')
  assert.equal(formatHumanSize(500), '500 B')
  assert.equal(formatHumanSize(1023), '1023 B')

  // KB
  assert.equal(formatHumanSize(1024), '1 KB')
  assert.equal(formatHumanSize(2048), '2 KB')
  assert.equal(formatHumanSize(4096), '4 KB')
  assert.equal(formatHumanSize(4500), '4.4 KB')

  // MB
  assert.equal(formatHumanSize(1024 * 1024), '1 MB')
  assert.equal(formatHumanSize(10 * 1024 * 1024), '10 MB')
  assert.equal(formatHumanSize(12.4 * 1024 * 1024), '12.4 MB')

  // GB
  assert.equal(formatHumanSize(1024 * 1024 * 1024), '1 GB')
  assert.equal(formatHumanSize(1.5 * 1024 * 1024 * 1024), '1.5 GB')
})
