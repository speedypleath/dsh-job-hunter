import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { evaluateEligibility, normalize, runFixtureSweep, scoreJob, validateSweepConfig } from '../plugin/src/core.js'

const root = path.resolve(import.meta.dirname, '..')

test('normalization excludes full descriptions and produces stable keys', () => {
  const raw = {
    source_key: 'fixture-1', source_name: 'Fixture', public_url: 'https://jobs.example.invalid/1',
    company: 'Example Company', title: 'DSP Engineer', location: 'Exampleland', workplace_mode: 'remote',
    description: 'Audio signal software', seniority: 'senior',
  }
  const first = normalize(raw, '2030-01-01T00:00:00.000Z')
  const second = normalize(raw, '2030-01-01T00:00:00.000Z')
  assert.equal(first.job_key, second.job_key)
  assert.equal('description' in first, false)
  assert.equal(first.description_fingerprint.length, 64)
})

test('eligibility and scoring provide reasoned outcomes', () => {
  const job = normalize({
    source_key: 'fixture-2', source_name: 'Fixture', public_url: 'https://jobs.example.invalid/2',
    company: 'Example Company', title: 'Senior DSP Engineer', location: 'Exampleland', workplace_mode: 'remote',
    description: 'Audio DSP software', seniority: 'senior',
  })
  const rules = { primary_markets: ['Exampleland'], fallback_markets: [], target_role_families: ['dsp'], minimum_seniority: 'mid', workplace_preferences: ['remote'], excluded_languages: [] }
  const eligibility = evaluateEligibility(job, rules)
  const score = scoreJob(job, eligibility, { role_family: 40, specialist_audio: 25, primary_market: 20, workplace: 15 })
  assert.equal(eligibility.eligible, true)
  assert.equal(score.total, 100)
})

test('offline fixture sweep persists qualified leads and dedupes the next run', async () => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'dsh-job-scout-'))
  const config = JSON.parse(await readFile(path.join(root, 'config.example.yaml'), 'utf8'))
  const first = await runFixtureSweep(config, root, state)
  const second = await runFixtureSweep(config, root, state)
  assert.equal(first.qualified_count, 1)
  assert.equal(first.rejected_count, 1)
  assert.equal(second.duplicate_count, 1)
  assert.equal(second.qualified_count, 0)
})

test('runtime configuration fails closed', () => {
  assert.throws(() => validateSweepConfig({ mode: 'live' }), /missing or invalid configuration category/)
})
