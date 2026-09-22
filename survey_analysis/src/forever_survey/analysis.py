"""Structured survey analysis and subgroup comparisons."""
from __future__ import annotations

from collections import Counter
import math

import pandas as pd
from scipy.stats import chi2_contingency

from .schema import Columns
from .stats import clean, distribution, grouped_percent, parse_multiselect, wilson_interval


HEADLINE_MAP = {
    "overall_direction": {
        "question": 5,
        "groups": {
            "Positive": {"Very positive", "Somewhat positive"},
            "Mixed / neutral": {"Mixed / neutral"},
            "Negative": {"Somewhat negative", "Very negative"},
            "Insufficient information": {"I do not yet have enough information to judge"},
        },
    },
    "likelihood_to_play": {
        "question": 6,
        "groups": {
            "Would play": {"Definitely would", "Probably would"},
            "Unsure": {"Unsure"},
            "Would not play": {"Probably would not", "Definitely would not"},
            "Not applicable": {"Not applicable; I did not expect to play Feral"},
        },
    },
    "excitement": {
        "question": 7,
        "groups": {
            "More excited": {"Much more excited to play Feral", "Somewhat more excited"},
            "Equally excited": {"About equally excited"},
            "Less excited": {"Somewhat less excited", "Much less excited"},
            "Insufficient information": {"Not enough experience/information to compare"},
        },
    },
}


def grouped_distribution(values: pd.Series, groups: dict[str, set[str]]) -> pd.DataFrame:
    rows = []
    for label, accepted in groups.items():
        rows.append({"category": label, **grouped_percent(values, accepted)})
    return pd.DataFrame(rows)


def multiselect_distribution(values: pd.Series) -> pd.DataFrame:
    parsed = [parse_multiselect(v) for v in values]
    counts = Counter(choice for row in parsed for choice in set(row))
    denom = len(parsed)
    return pd.DataFrame([{"category": choice, "count": count, "denominator": denom,
                          "percent": 100 * count / denom if denom else 0,
                          "note": "Multiple selections allowed; percentages may exceed 100%."}
                         for choice, count in counts.most_common()])


def structured_tables(df: pd.DataFrame, columns: Columns) -> dict[str, pd.DataFrame]:
    tables: dict[str, pd.DataFrame] = {}
    for name, spec in HEADLINE_MAP.items():
        tables[name] = grouped_distribution(df[columns.one(spec["question"])], spec["groups"])
        tables[name + "_full"] = pd.DataFrame(distribution(df[columns.one(spec["question"])]))
    tables["powershifting_preference"] = pd.DataFrame(distribution(df[columns.one(8)]))
    for name, q in [("familiarity", 1), ("primary_interest", 3), ("experience", 4)]:
        tables[name] = pd.DataFrame(distribution(df[columns.one(q)]))
    tables["versions_played"] = multiselect_distribution(df[columns.one(2)])
    tables["developer_attention"] = multiselect_distribution(df[columns.one(12)])
    tables["directions_to_test"] = multiselect_distribution(df[columns.one(13)])

    importance_rows = []
    for col in columns.by_question[9]:
        quality = col.rsplit("[", 1)[-1].rstrip("]")
        for row in distribution(df[col], ["Essential", "Very important", "Moderately important", "Slightly important", "Not important"]):
            importance_rows.append({"quality": quality, **row})
        grouped = grouped_percent(df[col], {"Essential", "Very important"})
        importance_rows.append({"quality": quality, "category": "Essential + Very important", **grouped})
    tables["importance_matrix"] = pd.DataFrame(importance_rows)

    agreement_rows = []
    agreement_cats = ["Strongly agree", "Agree", "Neither", "Disagree", "Strongly disagree", "Not enough information"]
    for col in columns.by_question[10]:
        statement = col.rsplit("[", 1)[-1].rstrip("]")
        for row in distribution(df[col], agreement_cats):
            agreement_rows.append({"statement": statement, **row})
        for label, accepted in [("Agree + Strongly agree", {"Agree", "Strongly agree"}),
                                ("Disagree + Strongly disagree", {"Disagree", "Strongly disagree"})]:
            agreement_rows.append({"statement": statement, "category": label,
                                   **grouped_percent(df[col], accepted)})
    tables["agreement_matrix"] = pd.DataFrame(agreement_rows)

    reaction_rows = []
    reaction_cats = ["Very positive", "Somewhat positive", "Neutral", "Somewhat negative", "Very negative", "Not enough information"]
    for col in columns.by_question[11]:
        area = col.rsplit("[", 1)[-1].rstrip("]")
        for row in distribution(df[col], reaction_cats):
            reaction_rows.append({"area": area, **row})
        for label, accepted in [("Positive", {"Very positive", "Somewhat positive"}),
                                ("Negative", {"Very negative", "Somewhat negative"})]:
            reaction_rows.append({"area": area, "category": label,
                                  **grouped_percent(df[col], accepted)})
    tables["mechanic_reactions"] = pd.DataFrame(reaction_rows)
    return tables


def subgroup_table(df: pd.DataFrame, columns: Columns, minimum_n: int = 30) -> pd.DataFrame:
    interest = df[columns.one(3)]
    experience = df[columns.one(4)]
    familiarity = df[columns.one(1)]
    power = df[columns.one(8)]
    groups = {
        "Cat DPS interest": interest.eq("Cat DPS in organized PvE"),
        "Bear tank interest": interest.eq("Bear tank in organized PvE"),
        "Hybrid/off-tank interest": interest.eq("Hybrid Cat/Bear or off-tank play"),
        "High-end/competitive": experience.eq("High-end or competitive Feral player"),
        "Regular raiding": experience.eq("Regular organized-raiding Feral player"),
        "Casual/newer/other": ~experience.isin(["High-end or competitive Feral player", "Regular organized-raiding Feral player"]),
        "Played test build": familiarity.eq("I have played the current test build"),
        "Reviewed/discussed only": familiarity.isin(["I have closely reviewed talents, abilities, footage, or theorycrafting", "I have followed detailed community discussion"]),
        "Classic-style powershifting": power.eq("I specifically want Classic-style powershifting restored."),
        "Functional replacement": power.eq("I do not need literal powershifting if another mechanic provides comparable activity and meaningful resource decisions."),
        "Non-powershifting preference": power.eq("I prefer a non-powershifting design, provided it remains engaging and has enough depth."),
    }
    outcomes = {
        "Negative direction": (columns.one(5), {"Somewhat negative", "Very negative"}),
        "Would play": (columns.one(6), {"Definitely would", "Probably would"}),
        "Less excited": (columns.one(7), {"Somewhat less excited", "Much less excited"}),
    }
    rows = []
    for group, mask in groups.items():
        n = int(mask.sum())
        if n < minimum_n:
            continue
        for outcome, (col, accepted) in outcomes.items():
            count = int(df.loc[mask, col].isin(accepted).sum())
            low, high = wilson_interval(count, n)
            rows.append({"group": group, "outcome": outcome, "count": count,
                         "denominator": n, "percent": 100 * count / n,
                         "ci_low": low, "ci_high": high,
                         "minimum_group_size": minimum_n})
    return pd.DataFrame(rows)


def _headline_outcomes(df: pd.DataFrame, columns: Columns) -> dict[str, pd.Series]:
    """Binary outcomes reused by the post-publication sensitivity analysis."""
    furor = next(col for col in columns.by_question[11] if "Furor" in col)
    return {
        "Negative direction": df[columns.one(5)].isin({"Somewhat negative", "Very negative"}),
        "Less excited": df[columns.one(7)].isin({"Somewhat less excited", "Much less excited"}),
        "Do not require literal powershifting": df[columns.one(8)].isin({
            "I do not need literal powershifting if another mechanic provides comparable activity and meaningful resource decisions.",
            "I prefer a non-powershifting design, provided it remains engaging and has enough depth.",
        }),
        "Negative on Furor/loss": df[furor].isin({"Somewhat negative", "Very negative"}),
    }


def _outcome_table(groups: pd.Series, outcomes: dict[str, pd.Series], order: list[str]) -> pd.DataFrame:
    rows = []
    for group in order:
        mask = groups.eq(group)
        denominator = int(mask.sum())
        if not denominator:
            continue
        for outcome, values in outcomes.items():
            count = int(values[mask].sum())
            low, high = wilson_interval(count, denominator)
            rows.append({
                "group": group,
                "outcome": outcome,
                "count": count,
                "denominator": denominator,
                "percent": 100 * count / denominator,
                "ci_low": low,
                "ci_high": high,
            })
    return pd.DataFrame(rows)


def _inference_table(groups: pd.Series, outcomes: dict[str, pd.Series], order: list[str]) -> pd.DataFrame:
    """Exploratory omnibus tests with multiplicity correction and effect sizes."""
    included = groups.isin(order)
    rows = []
    for outcome, values in outcomes.items():
        table = pd.crosstab(groups[included], values[included]).reindex(
            index=order, columns=[False, True], fill_value=0
        )
        chi_square, p_value, degrees_freedom, _ = chi2_contingency(table, correction=False)
        n = int(table.to_numpy().sum())
        dimension = min(table.shape[0] - 1, table.shape[1] - 1)
        cramers_v = math.sqrt(chi_square / (n * dimension)) if n and dimension else 0.0
        rows.append({
            "outcome": outcome,
            "groups_compared": " | ".join(order),
            "n": n,
            "chi_square": chi_square,
            "degrees_freedom": int(degrees_freedom),
            "p_value": p_value,
            "cramers_v": cramers_v,
        })

    # Benjamini-Hochberg correction across the four planned outcomes.
    ranked = sorted(range(len(rows)), key=lambda i: rows[i]["p_value"])
    previous = 1.0
    adjusted = [1.0] * len(rows)
    for rank, index in reversed(list(enumerate(ranked, start=1))):
        previous = min(previous, rows[index]["p_value"] * len(rows) / rank)
        adjusted[index] = previous
    for row, value in zip(rows, adjusted):
        row["bh_adjusted_p"] = value
    return pd.DataFrame(rows)


def experience_sensitivity_tables(df: pd.DataFrame, columns: Columns) -> dict[str, pd.DataFrame]:
    """Build the documented post-publication experience and familiarity addendum."""
    outcomes = _headline_outcomes(df, columns)
    versions = df[columns.one(2)].map(parse_multiselect)
    breadth = versions.map(
        lambda choices: len([choice for choice in choices if choice != "I have limited prior Feral experience"])
    )
    breadth_order = ["0-2 versions", "3-4 versions", "5+ versions"]
    breadth_groups = pd.cut(
        breadth, bins=[-1, 2, 4, float("inf")], labels=breadth_order
    ).astype("string")

    experience = df[columns.one(4)]
    profiles = pd.Series("Other/self-described casual or newer", index=df.index, dtype="string")
    competitive = experience.eq("High-end or competitive Feral player")
    regular = experience.eq("Regular organized-raiding Feral player")
    profiles[competitive & breadth.le(4)] = "Competitive, 0-4 versions"
    profiles[competitive & breadth.ge(5)] = "Competitive, 5+ versions"
    profiles[regular & breadth.le(4)] = "Regular raider, 0-4 versions"
    profiles[regular & breadth.ge(5)] = "Regular raider, 5+ versions"
    profile_order = [
        "Competitive, 0-4 versions",
        "Competitive, 5+ versions",
        "Regular raider, 0-4 versions",
        "Regular raider, 5+ versions",
        "Other/self-described casual or newer",
    ]

    familiarity = df[columns.one(1)]
    familiarity_groups = pd.Series("Other", index=df.index, dtype="string")
    familiarity_groups[familiarity.eq("I have played the current test build")] = "Played test build"
    familiarity_groups[familiarity.isin([
        "I have closely reviewed talents, abilities, footage, or theorycrafting",
        "I have followed detailed community discussion",
    ])] = "Reviewed/discussed only"
    familiarity_order = ["Played test build", "Reviewed/discussed only"]

    return {
        "experience_breadth": _outcome_table(breadth_groups, outcomes, breadth_order),
        "experience_profiles": _outcome_table(profiles, outcomes, profile_order),
        "experience_breadth_tests": _inference_table(breadth_groups, outcomes, breadth_order),
        "familiarity_tests": _inference_table(familiarity_groups, outcomes, familiarity_order),
    }
