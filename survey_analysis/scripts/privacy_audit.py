#!/usr/bin/env python3
"""Fail closed if public output appears to contain raw survey data or identifiers."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "analysis"
RAW_HEADERS = [
    "What is the single most important thing you want the developers to understand",
    "If you could change one mechanic or design decision",
    "May your written response be quoted anonymously",
]
EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")


def main() -> None:
    tracked = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True).splitlines()
    forbidden_paths = [p for p in tracked if "/data/raw/" in f"/{p}" or "/data/interim/" in f"/{p}" or p == "analysis_raw.csv"]
    if forbidden_paths:
        raise SystemExit(f"Private files are tracked: {forbidden_paths}")
    issues = []
    for path in PUBLIC.rglob("*"):
        if not path.is_file() or path.suffix.lower() in {".png", ".jpg", ".svg"}:
            continue
        text = path.read_text(errors="ignore")
        if EMAIL.search(text): issues.append(f"email-like text in {path.relative_to(ROOT)}")
        if path.suffix == ".csv" and any(header in text for header in RAW_HEADERS):
            issues.append(f"raw header in {path.relative_to(ROOT)}")
    if issues:
        raise SystemExit("Privacy audit failed: " + "; ".join(issues))
    print(f"Privacy audit passed: {len(tracked)} tracked paths, no raw/interim data or email-like public text.")


if __name__ == "__main__": main()
