"""Transparent manual-rule validation for core qualitative themes."""
from __future__ import annotations

import re

from .stats import normalize_text


THEME_RULES: dict[str, list[str]] = {
    "Literal powershifting restoration": [r"restore.{0,35}powershift", r"bring back.{0,25}powershift", r"classic.{0,20}powershift"],
    "Powershifting or a functional equivalent": [r"powershift.{0,45}(alternative|equivalent|replacement|or)", r"(alternative|equivalent|replacement).{0,45}powershift"],
    "Non-powershifting but engaging": [r"(no|without|remove).{0,25}powershift.{0,60}(engag|active|depth|decision)", r"don't need.{0,20}powershift"],
    "Energy downtime": [r"energy.{0,35}(downtime|waiting|wait|slow|starv)", r"(downtime|waiting).{0,35}energy"],
    "High APM/activity": [r"\bapm\b", r"high.{0,12}(activity|tempo|pace)", r"(active|frequent).{0,20}(button|action|input)"],
    "Skill expression/mastery": [r"skill (expression|ceiling)", r"mastery", r"reward.{0,25}(skill|good play)"],
    "Shapeshifting identity": [r"shapeshift", r"form.{0,25}identity", r"identity.{0,25}form"],
    "Cat/Bear/caster weaving": [r"(cat|bear|caster).{0,15}weav", r"weav.{0,15}(cat|bear|caster)", r"between forms"],
    "Bleed identity": [r"\bbleeds?\b", r"\brip\b", r"\brake\b"],
    "AoE/Swipe": [r"\baoe\b", r"area of effect", r"\bswipe\b"],
    "Hybrid/off-tank identity": [r"off.?tank", r"hybrid", r"cat.?bear"],
    "Distinctiveness from Rogue": [r"\brogue\b", r"distinct.{0,30}(melee|spec)", r"unique.{0,25}(identity|melee)"],
    "Numerical tuning": [r"\btun(e|ed|ing)\b", r"numbers?", r"damage.{0,20}(low|high|competitive|balance)"],
    "Raid utility": [r"raid util", r"reason to bring", r"\butility\b", r"raid spot"],
}


def code_themes(text: object) -> dict[str, bool]:
    value = normalize_text(text)
    return {theme: any(re.search(pattern, value, flags=re.I) for pattern in patterns)
            for theme, patterns in THEME_RULES.items()}


def powershift_polarity(text: object) -> str:
    value = normalize_text(text)
    if not re.search(r"power[ -]?shift", value, flags=re.I):
        return "Not mentioned"
    pro = bool(re.search(r"(restore|bring back|keep|preserve|want|need|love|retain).{0,45}power[ -]?shift|power[ -]?shift.{0,45}(restore|keep|preserve|want|need|love|retain)", value, re.I))
    anti = bool(re.search(r"(remove|without|no|don't|do not|glad|happy).{0,45}power[ -]?shift|power[ -]?shift.{0,45}(remove|gone|bad|not need|don't need)", value, re.I))
    equivalent = bool(re.search(r"power[ -]?shift.{0,60}(alternative|equivalent|replacement)|(?:alternative|equivalent|replacement).{0,60}power[ -]?shift", value, re.I))
    if sum((pro, anti, equivalent)) > 1:
        return "Ambiguous/mixed"
    if pro:
        return "Preserve/restore"
    if anti:
        return "Preserve removal/non-powershifting"
    if equivalent:
        return "Functional equivalent"
    return "Mentioned; polarity unclear"
