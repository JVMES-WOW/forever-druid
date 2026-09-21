"""Schema detection and validation for the live Google Forms worksheet."""
from __future__ import annotations

import re
from dataclasses import dataclass


class SchemaError(ValueError):
    """Raised when the live worksheet no longer matches the expected survey."""


@dataclass(frozen=True)
class Columns:
    timestamp: str
    by_question: dict[int, list[str]]

    def one(self, question: int) -> str:
        cols = self.by_question.get(question, [])
        if len(cols) != 1:
            raise SchemaError(f"Question {question} expected one column; found {len(cols)}")
        return cols[0]


EXPECTED_COUNTS = {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1,
                   9: 10, 10: 10, 11: 10, 12: 1, 13: 1, 14: 1, 15: 1,
                   16: 1, 17: 1}

REQUIRED_SNIPPETS = {
    1: "How familiar",
    2: "Which versions",
    3: "main interest",
    4: "experience level",
    5: "feel about the direction",
    6: "how likely",
    7: "Compared with Classic",
    8: "view of powershifting",
    12: "most need developer attention",
    13: "open to testing",
    14: "single most important thing",
    15: "most want preserved",
    16: "change one mechanic",
    17: "quoted anonymously",
}


def detect_columns(headers: list[str]) -> Columns:
    if not headers or headers[0].strip().casefold() != "timestamp":
        raise SchemaError("Required Timestamp column is missing or renamed")
    groups: dict[int, list[str]] = {q: [] for q in range(1, 18)}
    for header in headers[1:]:
        match = re.match(r"^\s*(\d+)\.\s+", header)
        if match:
            q = int(match.group(1))
            if q in groups:
                groups[q].append(header)
    problems = []
    for q, expected in EXPECTED_COUNTS.items():
        actual = len(groups[q])
        if actual != expected:
            problems.append(f"Q{q}: expected {expected} column(s), found {actual}")
    for q, snippet in REQUIRED_SNIPPETS.items():
        if groups[q] and snippet.casefold() not in groups[q][0].casefold():
            problems.append(f"Q{q}: required text {snippet!r} not found")
    if len(headers) != 45:
        problems.append(f"expected 45 columns, found {len(headers)}")
    if problems:
        raise SchemaError("Survey schema validation failed: " + "; ".join(problems))
    return Columns(headers[0], groups)
