"""Small statistical helpers used by the analysis and tests."""
from __future__ import annotations

import math
import re
from collections.abc import Iterable


def clean(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.casefold() in {"nan", "none", "nat"} else text


def parse_multiselect(value: object) -> list[str]:
    """Parse Google Forms comma-separated checkboxes with whitespace cleanup."""
    text = clean(value)
    return [part.strip() for part in text.split(",") if part.strip()] if text else []


def distribution(values: Iterable[object], categories: list[str] | None = None) -> list[dict]:
    cleaned = [clean(v) for v in values]
    denom = len(cleaned)
    keys = categories or sorted({v for v in cleaned if v})
    result = []
    for key in keys:
        count = sum(v == key for v in cleaned)
        result.append({"category": key, "count": count, "denominator": denom,
                       "percent": 100 * count / denom if denom else 0.0})
    missing = sum(not v for v in cleaned)
    if missing:
        result.append({"category": "Missing", "count": missing, "denominator": denom,
                       "percent": 100 * missing / denom if denom else 0.0})
    return result


def grouped_percent(values: Iterable[object], accepted: set[str]) -> dict:
    cleaned = [clean(v) for v in values]
    denom = len(cleaned)
    count = sum(v in accepted for v in cleaned)
    return {"count": count, "denominator": denom,
            "percent": 100 * count / denom if denom else 0.0}


def wilson_interval(count: int, denominator: int, z: float = 1.95996398454) -> tuple[float, float]:
    if denominator <= 0:
        return (0.0, 0.0)
    p = count / denominator
    d = 1 + z * z / denominator
    centre = (p + z * z / (2 * denominator)) / d
    half = z * math.sqrt((p * (1 - p) + z * z / (4 * denominator)) / denominator) / d
    return 100 * (centre - half), 100 * (centre + half)


def normalize_text(text: object) -> str:
    text = clean(text).replace("’", "'").replace("–", "-").replace("—", "-")
    text = re.sub(r"https?://\S+|www\.\S+", " ", text, flags=re.I)
    text = re.sub(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", " ", text)
    text = re.sub(r"[^\w\s'+/-]", " ", text.casefold())
    text = re.sub(r"(?<!\w)-(?!\w)", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def can_quote(permission: object) -> bool:
    return clean(permission) == "Yes, it may be quoted anonymously"
