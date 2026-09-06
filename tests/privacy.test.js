import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

test('generated tree passes the privacy scanner', () => {
  const result = spawnSync('python3', ['scripts/privacy_scan.py'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout || result.stderr)
})

test('fixtures use reserved synthetic identities and records', async () => {
  const profile = await import('./fixtures/profile.json', { with: { type: 'json' } })
  const jobs = await import('./fixtures/jobs.json', { with: { type: 'json' } })
  assert.match(profile.default.email, /@example\.invalid$/)
  assert.ok(profile.default.display_name.startsWith('Example '))
  assert.ok(jobs.default.every((job) => new URL(job.public_url).hostname.endsWith('example.invalid')))
  assert.ok(jobs.default.every((job) => job.company.startsWith('Example ')))
})
