# Migration report

## Result

The target is an installable DeepSeek Harness bundle with an SDK runner and an offline deterministic core. It uses the full `sdk` profile so Harness owns model access, sessions, planning, subagents, tool policy, and workspace controls.

## Responsibility map

- Mission and agent behavior -> `PROMPT.md`
- Scheduled sweep instructions -> `SCHEDULE_TASK.md`
- Discovery, normalization, eligibility, scoring, and dedupe -> `plugin/src/core.js`
- Approval, submission coordination, and idempotent tracking -> `plugin/src/application.js`
- Harness tool registration and validated config -> `plugin/src/index.js`
- Bundle composition -> `plugin/cordis.patch.yml`
- SDK lifecycle and isolated home selection -> `sdk/run.py`
- Company, resource, opportunity, run, and event contracts -> `schemas/`
- Synthetic offline verification -> `tests/fixtures/` and `tests/`
- Privacy verification -> `scripts/privacy_scan.py`

## Exclusions

Nine sensitive data categories were excluded. Zero source records were migrated. These categories cover candidate identity, candidate documents, application drafts, application and tracker history, conversations and session metadata, authentication material and browser state, memory and review stores, generated or temporary artifacts, and host-specific infrastructure data.

## Harness features retained

The migration uses bundle/profile layering, Cordis plugin lifecycle, Schemastery configuration, typed tool registration, execution cancellation, the Python SDK, durable sessions, the full profile's planning and subagent tools, workspace permission policy, and the optional Schedule overlay contract.

## Verification

The local suite checks the deterministic sweep, canonical normalization, eligibility reasons, scoring, dedupe, fail-closed configuration, exact-job approval, approval consumption, immediate idempotent tracking, bundle metadata, tool registration, offline defaults, synthetic fixtures, and privacy rules. Eleven offline tests pass. The privacy scan reports zero findings. The native Harness test installs the bundle into a disposable full `sdk` profile, composes the profile, loads the plugin, and exits successfully without a model request.

## Gaps

Network discovery, remote tracker, reporting, and application providers remain interfaces rather than enabled plugins. The shipped bundle intentionally exposes no submission tool. The pinned published runtime is `0.1.2rc1`; upstream documentation currently describes a newer unreleased source version, so future upgrades may require plugin API changes.

No applications, messages, notifications, tracker events, or model requests were sent during migration.
