from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKIP_CONTENT = {Path("scripts/privacy_scan.py")}
SKIP_PARTS = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache"}
TEXT_SUFFIXES = {".md", ".txt", ".json", ".yaml", ".yml", ".js", ".py", ".toml"}


def scan() -> dict[str, set[str]]:
    findings: dict[str, set[str]] = defaultdict(set)
    banned_parts = {"private", "runtime", "approvals", "downloads", "screenshots", "logs", "browser-profile", "generated"}
    banned_suffixes = {".pdf", ".doc", ".docx", ".log"}
    patterns = {
        "absolute_home_path": re.compile(r"/(?:Users|home)/[^/\s]+/"),
        "phone_number": re.compile(r"\+[0-9][0-9 ()-]{7,}[0-9]"),
        "long_external_identifier": re.compile(r"\b[0-9]{16,}\b"),
        "credential_assignment": re.compile(r"(?im)^(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s$<{][^\r\n]*$"),
    }
    email = re.compile(r"\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b", re.IGNORECASE)

    for file_path in ROOT.rglob("*"):
        relative = file_path.relative_to(ROOT)
        if any(part in SKIP_PARTS for part in relative.parts):
            continue
        if file_path.is_dir():
            if any(part in banned_parts for part in relative.parts):
                findings["forbidden_artifact_directory"].add(relative.as_posix())
            continue
        if file_path.suffix.lower() in banned_suffixes:
            findings["forbidden_artifact_file"].add(relative.as_posix())
        if relative in SKIP_CONTENT or file_path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            text = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            findings["binary_artifact"].add(relative.as_posix())
            continue
        for match in email.finditer(text):
            if not match.group(1).lower().endswith("example.invalid"):
                findings["email_address"].add(relative.as_posix())
        for category, pattern in patterns.items():
            if pattern.search(text):
                findings[category].add(relative.as_posix())
    return findings


def main() -> int:
    findings = scan()
    categories = sorted(findings)
    for category in categories:
        locations = ", ".join(sorted(findings[category]))
        print(f"{category}: {len(findings[category])} file(s): {locations}")
    if not categories:
        print("privacy_scan: 0 findings")
    return 1 if categories else 0


if __name__ == "__main__":
    sys.exit(main())
