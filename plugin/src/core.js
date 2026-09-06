import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function resolveWithin(root, candidate) {
  const base = path.resolve(root)
  const target = path.resolve(base, candidate)
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error('configured path escapes its allowed root')
  }
  return target
}

export async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

export function validateSweepConfig(config) {
  const requiredObjects = ['limits', 'eligibility', 'scoring', 'storage']
  for (const name of requiredObjects) {
    if (!config[name] || typeof config[name] !== 'object' || Array.isArray(config[name])) {
      throw new Error(`missing or invalid configuration category: ${name}`)
    }
  }
  if (config.mode !== 'dry-run') throw new Error('only dry-run mode is enabled in this bundle')
  if (config.network_enabled || config.external_writes_enabled) throw new Error('offline bundle rejects network access and external writes')
  if (!Array.isArray(config.discovery) || config.discovery.length === 0) throw new Error('at least one discovery adapter is required')
  if (!Number.isInteger(config.limits.max_sources) || config.limits.max_sources < 1) throw new Error('max_sources must be a positive integer')
  if (!Number.isInteger(config.limits.max_jobs_per_source) || config.limits.max_jobs_per_source < 1) throw new Error('max_jobs_per_source must be a positive integer')
  for (const key of ['primary_markets', 'fallback_markets', 'target_role_families', 'workplace_preferences', 'excluded_languages']) {
    if (!Array.isArray(config.eligibility[key])) throw new Error(`eligibility.${key} must be an array`)
  }
  return config
}

export function normalize(raw, now = new Date().toISOString()) {
  const identity = [raw.source_name, raw.source_key].join('|').toLowerCase()
  const duplicate = [raw.company, raw.title, raw.location].join('|').toLowerCase()
  const text = `${raw.title} ${raw.description ?? ''}`.toLowerCase()
  const vocabulary = ['audio', 'dsp', 'signal', 'music', 'software', 'backend', 'frontend', 'machine learning']
  return {
    job_key: createHash('sha256').update(identity).digest('hex').slice(0, 24),
    source_key: raw.source_key,
    source_name: raw.source_name,
    public_url: raw.public_url,
    company: raw.company,
    title: raw.title,
    location: raw.location,
    workplace_mode: raw.workplace_mode,
    employment_type: raw.employment_type ?? 'unknown',
    description_fingerprint: createHash('sha256').update(raw.description ?? '').digest('hex'),
    discovered_at: now,
    checked_at: now,
    eligibility: {},
    score: {},
    status: 'discovered',
    duplicate_key: createHash('sha256').update(duplicate).digest('hex').slice(0, 24),
    provenance: { source_key: raw.source_key, source_name: raw.source_name },
    keywords: vocabulary.filter((word) => text.includes(word)),
    language: raw.language ?? '',
    portal_kind: raw.portal_kind ?? 'unknown',
    seniority: raw.seniority ?? 'unspecified',
  }
}

const seniorityRank = { intern: 0, junior: 1, mid: 2, senior: 3, staff: 4, lead: 4, principal: 5 }

export function evaluateEligibility(job, rules) {
  const reasons = []
  const location = job.location.toLowerCase()
  const primary = rules.primary_markets.some((item) => location.includes(item.toLowerCase()))
  const fallback = rules.fallback_markets.some((item) => location.includes(item.toLowerCase()))
  const workplace = rules.workplace_preferences.includes(job.workplace_mode)
  const family = rules.target_role_families.some((item) => job.keywords.includes(item.toLowerCase()) || job.title.toLowerCase().includes(item.toLowerCase()))
  const minimum = seniorityRank[rules.minimum_seniority] ?? 0
  const actual = seniorityRank[job.seniority] ?? minimum
  const languageBlocked = rules.excluded_languages.includes(job.language)
  if (!primary && !fallback) reasons.push('market_out_of_scope')
  if (!workplace) reasons.push('workplace_mismatch')
  if (!family) reasons.push('role_family_mismatch')
  if (actual < minimum) reasons.push('seniority_below_minimum')
  if (languageBlocked) reasons.push('language_excluded')
  return { eligible: reasons.length === 0, reason_codes: reasons, market_tier: primary ? 'primary' : fallback ? 'fallback' : 'none' }
}

export function scoreJob(job, eligibility, weights) {
  const components = {
    role_family: eligibility.reason_codes.includes('role_family_mismatch') ? 0 : weights.role_family,
    specialist_audio: job.keywords.some((item) => ['audio', 'dsp', 'signal', 'music'].includes(item)) ? weights.specialist_audio : 0,
    primary_market: eligibility.market_tier === 'primary' ? weights.primary_market : 0,
    workplace: eligibility.reason_codes.includes('workplace_mismatch') ? 0 : weights.workplace,
  }
  const total = Object.values(components).reduce((sum, value) => sum + value, 0)
  const reasons = Object.entries(components).filter(([, value]) => value > 0).map(([name]) => name)
  return { total, components, reasons }
}

export class JsonStateStore {
  constructor(root, opportunitiesName = 'opportunities.jsonl', seenName = 'seen.json') {
    this.root = root
    this.opportunitiesPath = resolveWithin(root, opportunitiesName)
    this.seenPath = resolveWithin(root, seenName)
  }

  async readSeen() {
    try { return new Set(JSON.parse(await readFile(this.seenPath, 'utf8'))) } catch (error) {
      if (error.code === 'ENOENT') return new Set()
      throw error
    }
  }

  async seen(jobKey) { return (await this.readSeen()).has(jobKey) }

  async save(job) {
    await mkdir(this.root, { recursive: true })
    const existing = await this.readSeen()
    if (existing.has(job.job_key)) return false
    await writeFile(this.opportunitiesPath, `${JSON.stringify(job)}\n`, { encoding: 'utf8', flag: 'a' })
    existing.add(job.job_key)
    const temporary = `${this.seenPath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify([...existing].sort()), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.seenPath)
    return true
  }
}

export async function runFixtureSweep(config, workspaceRoot, stateRoot) {
  validateSweepConfig(config)
  const enabled = config.discovery.filter((adapter) => adapter.enabled)
  if (enabled.length > config.limits.max_sources) throw new Error('enabled discovery adapters exceed the activity limit')
  const rawJobs = []
  const failures = []
  for (const adapter of enabled) {
    if (adapter.kind !== 'fixture') {
      failures.push('disabled_network_adapter')
      continue
    }
    const fixturePath = resolveWithin(workspaceRoot, adapter.path)
    const jobs = await loadJson(fixturePath)
    rawJobs.push(...jobs.slice(0, config.limits.max_jobs_per_source))
  }
  const store = new JsonStateStore(stateRoot, config.storage.opportunities, config.storage.seen)
  const qualified = []
  let duplicates = 0
  let rejected = 0
  for (const raw of rawJobs) {
    const job = normalize(raw)
    if (await store.seen(job.job_key)) { duplicates += 1; continue }
    const eligibility = evaluateEligibility(job, config.eligibility)
    const score = scoreJob(job, eligibility, config.scoring)
    job.eligibility = eligibility
    job.score = score
    if (!eligibility.eligible || score.total < config.scoring.threshold) { rejected += 1; continue }
    job.status = 'qualified'
    await store.save(job)
    qualified.push(job)
  }
  return {
    run_id: randomUUID(),
    mode: 'dry-run',
    source_count: enabled.length,
    raw_count: rawJobs.length,
    qualified_count: qualified.length,
    duplicate_count: duplicates,
    rejected_count: rejected,
    failures,
    qualified_jobs: qualified.map(({ keywords, language, portal_kind, seniority, ...job }) => job),
  }
}
