import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ApplicationCoordinator, FileApprovalGate, LocalIdempotentTracker } from '../plugin/src/application.js'

class ConfirmedSyntheticAdapter {
  async prepare(job) { return { job_key: job.job_key, adapter: 'synthetic', payload_ref: 'fixture' } }
  async submit() { return { confirmed: true, method: 'synthetic' } }
}

test('submission is impossible without exact-job approval', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-approval-'))
  const approval = new FileApprovalGate(path.join(root, 'approvals'))
  const tracker = new LocalIdempotentTracker(path.join(root, 'state'))
  const coordinator = new ApplicationCoordinator({ approval, tracker, adapter: new ConfirmedSyntheticAdapter(), externalWritesEnabled: true })
  assert.deepEqual(await coordinator.submit({ job_key: 'job-a' }, {}), { status: 'handoff', reason: 'exact_job_approval_required' })
})

test('confirmed submission consumes approval and records idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tracker-'))
  const approvals = path.join(root, 'approvals')
  await mkdir(approvals)
  await writeFile(path.join(approvals, 'job-b.submit_application.json'), JSON.stringify({
    approval_id: 'synthetic-approval', job_key: 'job-b', action: 'submit_application', expires_at: '2999-01-01T00:00:00.000Z',
  }))
  const approval = new FileApprovalGate(approvals)
  const tracker = new LocalIdempotentTracker(path.join(root, 'state'))
  const coordinator = new ApplicationCoordinator({ approval, tracker, adapter: new ConfirmedSyntheticAdapter(), externalWritesEnabled: true })
  const result = await coordinator.submit({ job_key: 'job-b' }, {})
  assert.equal(result.status, 'confirmed')
  assert.equal(await tracker.verify('job-b:confirmed'), true)
  assert.equal((await coordinator.submit({ job_key: 'job-b' }, {})).status, 'handoff')
})
