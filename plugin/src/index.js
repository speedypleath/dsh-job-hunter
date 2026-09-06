import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { loadJson, resolveWithin, runFixtureSweep, validateSweepConfig } from './core.js'

export const name = 'job-scout'
export const inject = ['tools']

export const Config = Schema.object({
  mode: Schema.union(['dry-run', 'live']).default('dry-run'),
  configPath: Schema.string().required(),
  workspaceRoot: Schema.string().required(),
  stateRoot: Schema.string().default('runtime'),
  approvalRoot: Schema.string().default('approvals'),
  networkEnabled: Schema.boolean().default(false),
  externalWritesEnabled: Schema.boolean().default(false),
  timeoutMs: Schema.number().default(15000),
  maxJobsPerSource: Schema.number().default(50),
})

const reportSchema = {
  type: 'object',
  properties: {
    run_id: { type: 'string', required: true }, mode: { type: 'string', required: true }, source_count: { type: 'number', required: true },
    raw_count: { type: 'number', required: true }, qualified_count: { type: 'number', required: true }, duplicate_count: { type: 'number', required: true },
    rejected_count: { type: 'number', required: true }, failures: { type: 'array', items: { type: 'string' }, required: true },
    qualified_jobs: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
  },
  additionalProperties: false,
}

export function apply(ctx, pluginConfig) {
  if (pluginConfig.mode === 'dry-run' && pluginConfig.externalWritesEnabled) throw new Error('dry-run cannot enable external writes')
  if (pluginConfig.externalWritesEnabled && !pluginConfig.networkEnabled) throw new Error('external writes require network access')
  const workspaceRoot = resolveWithin(pluginConfig.workspaceRoot, '.')
  const configPath = resolveWithin(workspaceRoot, pluginConfig.configPath)
  const stateRoot = resolveWithin(workspaceRoot, pluginConfig.stateRoot)

  ctx.tools.register(defineTool({
    name: 'job_sweep',
    description: 'Run the configured job discovery, normalization, eligibility, scoring, and dedupe pipeline. Defaults to offline dry-run.',
    parameters: {},
    output: {
      schema: reportSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(_args, exec) {
      if (exec.signal.aborted) throw new Error('job sweep cancelled')
      const config = validateSweepConfig(await loadJson(configPath))
      config.limits.max_jobs_per_source = Math.min(config.limits.max_jobs_per_source, pluginConfig.maxJobsPerSource)
      return runFixtureSweep(config, workspaceRoot, stateRoot)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'job_application_handoff',
    description: 'Return the safe next action for a job. This bundle never submits applications directly.',
    parameters: { job_key: { type: 'string', required: true, description: 'Canonical job key' } },
    output: {
      schema: { type: 'object', properties: { status: { type: 'string', required: true }, job_key: { type: 'string', required: true }, reason: { type: 'string', required: true } }, additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return { status: 'handoff', job_key: args.job_key, reason: 'exact_job_approval_and_external_adapter_required' }
    },
  }))
}
