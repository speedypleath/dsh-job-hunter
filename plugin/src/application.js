import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolveWithin } from './core.js'

export class FileApprovalGate {
  constructor(root, now = () => new Date()) { this.root = root; this.now = now }

  async find(jobKey, action) {
    const file = resolveWithin(this.root, `${jobKey}.${action}.json`)
    let artifact
    try { artifact = JSON.parse(await readFile(file, 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    if (artifact.job_key !== jobKey || artifact.action !== action) return null
    if (!artifact.approval_id || !artifact.expires_at || artifact.consumed_at) return null
    if (new Date(artifact.expires_at) <= this.now()) return null
    return { file, artifact }
  }

  async authorized(jobKey, action) { return Boolean(await this.find(jobKey, action)) }

  async consume(jobKey, action) {
    const found = await this.find(jobKey, action)
    if (!found) throw new Error('approval is absent, expired, mismatched, or consumed')
    found.artifact.consumed_at = this.now().toISOString()
    const temporary = `${found.file}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(found.artifact), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, found.file)
  }
}

export class LocalIdempotentTracker {
  constructor(root, fileName = 'tracker.json') { this.root = root; this.file = resolveWithin(root, fileName) }

  async records() {
    try { return JSON.parse(await readFile(this.file, 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') return {}
      throw error
    }
  }

  async record(event) {
    const records = await this.records()
    if (!records[event.event_id]) {
      records[event.event_id] = event
      await mkdir(this.root, { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(records), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.file)
    }
    return { recorded: true, verified: Boolean(records[event.event_id]), event_id: event.event_id }
  }

  async verify(eventId) { return Boolean((await this.records())[eventId]) }
}

export class DisabledApplicationAdapter {
  async prepare(job) { return { job_key: job.job_key, adapter: 'disabled', payload_ref: '' } }
  async submit() { return { confirmed: false, method: 'none', reason: 'manual_handoff_required' } }
}

export class ApplicationCoordinator {
  constructor({ approval, adapter, tracker, externalWritesEnabled = false }) {
    this.approval = approval
    this.adapter = adapter
    this.tracker = tracker
    this.externalWritesEnabled = externalWritesEnabled
  }

  async submit(job, profile) {
    const action = 'submit_application'
    if (!this.externalWritesEnabled) return { status: 'handoff', reason: 'external_writes_disabled' }
    if (!(await this.approval.authorized(job.job_key, action))) return { status: 'handoff', reason: 'exact_job_approval_required' }
    const draft = await this.adapter.prepare(job, profile)
    const result = await this.adapter.submit(draft, this.approval)
    if (!result.confirmed) return { status: 'unconfirmed', reason: result.reason || 'submission_not_confirmed' }
    await this.approval.consume(job.job_key, action)
    const event = {
      event_id: `${job.job_key}:confirmed`,
      job_key: job.job_key,
      action,
      status: 'confirmed',
      occurred_at: new Date().toISOString(),
      method: result.method,
    }
    const tracked = await this.tracker.record(event)
    const verified = tracked.verified && await this.tracker.verify(event.event_id)
    if (!verified) return { status: 'tracking_failed', event_id: event.event_id }
    return { status: 'confirmed', event_id: event.event_id }
  }
}
