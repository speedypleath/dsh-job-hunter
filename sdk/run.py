from __future__ import annotations

import argparse
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one job-scout turn through DeepSeek Harness")
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--dsh-home", type=Path, required=True)
    parser.add_argument("--session-id", default="job-scout-dry-run")
    parser.add_argument("--profile", default="sdk")
    parser.add_argument("--model", default=os.environ.get("DSH_MODEL", "deepseek-v4-flash"))
    parser.add_argument("--max-tokens", type=int, default=8192)
    parser.add_argument("task", nargs="?", default="Use job_sweep once, assess the qualified synthetic leads, and report the dry-run result concisely.")
    args = parser.parse_args()

    workspace = args.workspace.resolve()
    harness_home = args.dsh_home.resolve()
    prompt_path = workspace / "PROMPT.md"
    config_path = workspace / "config.example.yaml"
    if not prompt_path.is_file() or not config_path.is_file():
        parser.error("workspace must contain PROMPT.md and config.example.yaml")
    if workspace == harness_home or workspace in harness_home.parents:
        parser.error("Harness home must be isolated from the agent workspace")

    os.environ.setdefault("DSH_SYSTEM_PROMPT", prompt_path.read_text(encoding="utf-8"))
    os.environ.setdefault("JOB_SCOUT_WORKSPACE_ROOT", str(workspace))
    os.environ.setdefault("JOB_SCOUT_CONFIG_PATH", str(config_path.relative_to(workspace)))
    os.environ.setdefault("JOB_SCOUT_STATE_ROOT", "runtime")
    os.environ.setdefault("JOB_SCOUT_APPROVAL_ROOT", "approvals")

    try:
        from deepseek_harness import DeepSeekHarness
    except ImportError as exc:
        raise SystemExit("Install the pinned SDK in an isolated environment before running this entry point.") from exc

    with DeepSeekHarness(
        provider="deepseek-official",
        model=args.model,
        max_tokens=args.max_tokens,
        cwd=str(workspace),
        dsh_home=str(harness_home),
        profile=args.profile,
    ) as harness:
        result = harness.run(args.task, session_id=args.session_id)
    print(result.final_response)


if __name__ == "__main__":
    main()
