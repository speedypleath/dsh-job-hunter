# DSH Job Hunter

This directory contains a private job-sweep agent built for the official DeepSeek Harness. It keeps the source agent's scouting methods and safety rules, but carries no candidate identity, application history, credentials, or private source records.

DeepSeek Harness is currently a developer preview. Run this agent in a disposable checkout or container with access only to the files it needs.

## What uses Harness directly

`plugin/` is an installable `dsh.bundle`. Its Cordis patch adds the job-scout plugin to a full `sdk` profile. The plugin uses:

- Cordis bundle and profile layering;
- Schemastery validation for deployment settings;
- typed model tools through `defineTool`;
- Harness cancellation through each tool's execution signal;
- the full SDK profile's durable sessions, plan and goal tracking, subagents, web tools, and workspace permission policy;
- the Python SDK's explicit workspace, isolated Harness home, profile, model, and session lifecycle.

The plugin registers `job_sweep` and `job_application_handoff`. The first runs the deterministic discovery pipeline. The second stops at a human handoff. The bundle does not register an application-submission tool.

## Safety defaults

- `dry-run` mode is mandatory in the bundled configuration.
- Network access and external writes are off.
- Tests use local synthetic fixtures.
- Candidate data stays in an ignored local profile.
- Approval artifacts bind one action to one job and expire after a set time.
- The application coordinator records a confirmed submission synchronously through an idempotent tracker.
- Captchas, authentication, security codes, and manual-only portals always become handoffs.

## Install

Use Python 3.10 or newer and Node.js 22.19 or newer. The pinned Python SDK installs the matching `dsh` runtime.

```bash
cd dsh-job-hunter
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e .
```

The project pins the newest published SDK/runtime, `0.1.2rc1`. Upstream documentation may describe unreleased APIs, so test the bundle against Harness before changing this pin.

Create an isolated Harness home outside the workspace. Install the local bundle into the full SDK profile:

```bash
export DSH_HOME="$(cd .. && pwd)/.dsh-job-scout-home"
dsh --profile sdk --dump-default-config >/dev/null
dsh plugin --profile sdk add "file:$PWD/plugin"
dsh --profile sdk --dump-config >/dev/null
```

Configure the model through Settings -> Models in the Harness Web UI. Harness stores the credential in its isolated home and returns only a redacted descriptor to the page. Do not put credentials in this repository or command arguments.

## Run

The checked-in example is offline and uses synthetic data:

```bash
python3 -m sdk.run \
  --workspace "$PWD" \
  --dsh-home "$DSH_HOME" \
  "Use job_sweep once and report the dry-run result."
```

The SDK uses the full `sdk` profile, so the agent can maintain a plan, delegate bounded source reviews, and keep a durable session. `PROMPT.md` sets the agent identity. Reuse the session ID only when you intend to continue the same run history.

For the Web UI, start `dsh web` with the same isolated home, select this directory as the workspace, and install the bundle into the `web` profile as well.

## Scheduled sweeps

DeepSeek Harness ships an optional session-local Schedule overlay. Enable that official overlay, then use `SCHEDULE_TASK.md` as the scheduled task. Keep the activity limit in local configuration and leave application submission outside scheduled sessions.

## Connect private local data

Copy `.env.example` and `config.example.yaml` to ignored local files. Supply candidate values through masked environment injection or files under an approved private root. Never commit or print those files.

The current bundle accepts fixture discovery only. Add network discovery as a separate provider plugin, keep bounded timeouts and retries, and return normalized public job records to the job-scout service. Do not mix credentials or browser state into discovery records.

## Connect Career Ops

The bundle still uses its local tracker by default. [Career Ops integration](docs/CAREER_OPS.md) defines the server-side API contract, safety boundary, write sequence, and verification steps for a remote tracker adapter.

## Tests

The test suite needs no network or model credential:

```bash
node --test tests/*.test.js
python3 scripts/privacy_scan.py
scripts/test_dsh_boot.sh
```

The native boot test uses the pinned SDK/runtime and a disposable Harness home. It installs the local bundle, composes the `sdk` profile, loads the plugin, and exits without contacting a model endpoint.
