#!/usr/bin/env python3
"""Download, validate, analyze, and publish the Forever Feral survey report."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "survey_analysis" / "src"
sys.path.insert(0, str(SRC))

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from jinja2 import Environment, FileSystemLoader, select_autoescape
from wordcloud import WordCloud

from forever_survey import SEED
from forever_survey.analysis import HEADLINE_MAP, structured_tables, subgroup_table
from forever_survey.schema import detect_columns
from forever_survey.stats import can_quote, clean
from forever_survey.text import document_frequency, private_text_id, topic_outputs
from forever_survey.themes import THEME_RULES, code_themes, powershift_polarity

SPREADSHEET_ID = "1muybYt_lCb0MZvsquooyl1X5JbDz0K4gP-zT72lrM6E"
WORKSHEET = "Form Responses 1"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/export?format=csv&sheet=Form%20Responses%201"
RAW_DIR = ROOT / "survey_analysis" / "data" / "raw"
INTERIM_DIR = ROOT / "survey_analysis" / "data" / "interim"
PROCESSED_DIR = ROOT / "survey_analysis" / "data" / "processed"
PUBLIC_DIR = ROOT / "analysis"
FIG_DIR = PUBLIC_DIR / "figures"
TABLE_DIR = PUBLIC_DIR / "tables"
TEMPLATE_DIR = ROOT / "survey_analysis" / "templates"

COLORS = {"positive": "#1b7f79", "neutral": "#7a7f87", "negative": "#c44e52",
          "info": "#4472a5", "gold": "#c58c21", "purple": "#6c5aa8"}


def ensure_dirs() -> None:
    for path in (RAW_DIR, INTERIM_DIR, PROCESSED_DIR, PUBLIC_DIR, FIG_DIR, TABLE_DIR):
        path.mkdir(parents=True, exist_ok=True)


def retrieve(source: Path | None) -> tuple[Path, str, str]:
    retrieved = datetime.now(ZoneInfo("America/Chicago")).isoformat(timespec="seconds")
    destination = RAW_DIR / "form_responses.csv"
    if source:
        shutil.copyfile(source, destination)
    else:
        request = urllib.request.Request(CSV_URL, headers={"User-Agent": "Forever-Feral-Survey-Analysis/1.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            destination.write_bytes(response.read())
    raw = destination.read_bytes()
    return destination, retrieved, hashlib.sha256(raw).hexdigest()


def save_table(name: str, frame: pd.DataFrame) -> None:
    frame.to_csv(PROCESSED_DIR / f"{name}.csv", index=False)
    frame.to_csv(TABLE_DIR / f"{name}.csv", index=False)


def question_label(q: int) -> str:
    return f"Q{q}"


def quality_checks(df: pd.DataFrame, columns) -> tuple[pd.DataFrame, dict]:
    rows = []
    for q, cols in columns.by_question.items():
        missing_cells = int(sum(df[col].map(clean).eq("").sum() for col in cols))
        incomplete_rows = int(df[cols].apply(lambda row: any(not clean(v) for v in row), axis=1).sum())
        rows.append({"question": question_label(q), "columns": len(cols),
                     "missing_cells": missing_cells, "respondents_with_any_missing": incomplete_rows,
                     "respondents": len(df), "complete_percent": 100 * (len(df) - incomplete_rows) / len(df)})
    answer_cols = [c for c in df.columns if c != columns.timestamp]
    exact_mask = df[answer_cols].fillna("").duplicated(keep=False)
    timestamps = pd.to_datetime(df[columns.timestamp], errors="coerce")
    summary = {
        "exact_duplicate_rows": int(exact_mask.sum()),
        "exact_duplicate_groups": int(df.loc[exact_mask, answer_cols].drop_duplicates().shape[0]),
        "duplicate_timestamp_rows": int(df[columns.timestamp].duplicated(keep=False).sum()),
        "invalid_timestamps": int(timestamps.isna().sum()),
        "collection_start": timestamps.min().strftime("%B %-d, %Y at %-I:%M %p") if timestamps.notna().any() else "Unavailable",
        "collection_end": timestamps.max().strftime("%B %-d, %Y at %-I:%M %p") if timestamps.notna().any() else "Unavailable",
    }
    return pd.DataFrame(rows), summary


def plot_bar(frame: pd.DataFrame, label_col: str, value_col: str, path: Path, title: str,
             colors=None, xlabel="Percent of respondents", suffix="%", xlim=None, height=None) -> None:
    data = frame.iloc[::-1].copy()
    fig, ax = plt.subplots(figsize=(10, height or max(3.2, 0.48 * len(data) + 1.2)))
    palette = colors or [COLORS["info"]] * len(data)
    if isinstance(palette, dict):
        palette = [palette.get(v, COLORS["info"]) for v in data[label_col]]
    bars = ax.barh(data[label_col], data[value_col], color=palette if not isinstance(palette, list) else palette[::-1] if len(palette)==len(frame) else palette)
    for bar, (_, row) in zip(bars, data.iterrows()):
        annotation = f"{row[value_col]:.1f}{suffix}"
        if "count" in row and "denominator" in row:
            annotation += f"  ({int(row['count'])}/{int(row['denominator'])})"
        ax.text(bar.get_width() + 0.8, bar.get_y() + bar.get_height()/2, annotation, va="center", fontsize=9)
    ax.set_title(title, loc="left", fontweight="bold", pad=12)
    ax.set_xlabel(xlabel)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.grid(axis="x", alpha=.2)
    ax.set_axisbelow(True)
    ax.set_xlim(0, xlim or max(100, float(data[value_col].max()) * 1.25))
    fig.tight_layout()
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def plot_mechanics(table: pd.DataFrame) -> None:
    pos = table[table.category.eq("Positive")][["area", "percent"]].rename(columns={"percent": "positive"})
    neg = table[table.category.eq("Negative")][["area", "percent"]].rename(columns={"percent": "negative"})
    data = pos.merge(neg).sort_values("negative")
    y = np.arange(len(data))
    fig, ax = plt.subplots(figsize=(11, 7.2))
    ax.barh(y, -data.negative, color=COLORS["negative"], label="Negative")
    ax.barh(y, data.positive, color=COLORS["positive"], label="Positive")
    ax.set_yticks(y, [re.sub(r"\s+", " ", x).replace("possibilities", "") for x in data.area])
    ax.axvline(0, color="#333", lw=.8)
    ax.set_xlim(-85, 85)
    ax.set_xticks([-80,-60,-40,-20,0,20,40,60,80], ["80%","60%","40%","20%","0","20%","40%","60%","80%"])
    ax.set_title("Mechanic reactions: negative vs. positive", loc="left", fontweight="bold")
    ax.legend(frameon=False, ncol=2, loc="lower right")
    ax.spines[["top","right","left","bottom"]].set_visible(False)
    ax.grid(axis="x", alpha=.18)
    fig.tight_layout()
    fig.savefig(FIG_DIR / "mechanic-reactions.svg", bbox_inches="tight")
    plt.close(fig)


def plot_subgroups(table: pd.DataFrame) -> None:
    data = table[table.outcome.eq("Negative direction")].sort_values("percent")
    fig, ax = plt.subplots(figsize=(10, 6.4))
    y = np.arange(len(data))
    ax.errorbar(data.percent, y, xerr=[data.percent-data.ci_low, data.ci_high-data.percent],
                fmt="o", color=COLORS["purple"], ecolor="#afa7cf", capsize=3)
    ax.set_yticks(y, [f"{g} (n={n})" for g,n in zip(data.group, data.denominator)])
    ax.set_xlim(0, 100); ax.set_xlabel("Negative toward current direction (%) with Wilson 95% CI")
    ax.set_title("Descriptive subgroup differences", loc="left", fontweight="bold")
    ax.grid(axis="x", alpha=.2); ax.spines[["top","right","left"]].set_visible(False)
    fig.tight_layout(); fig.savefig(FIG_DIR / "subgroups.svg", bbox_inches="tight"); plt.close(fig)


def plot_topics(all_prev: pd.DataFrame) -> None:
    data = all_prev.sort_values(["question", "primary_share"])
    labels = [f"{q}: {t}" for q,t in zip(data.question, data.topic)]
    plot_bar(data.assign(label=labels), "label", "primary_share", FIG_DIR / "topic-prevalence.svg",
             "Exclusive primary-topic shares", xlabel="Share of responses with text (not survey vote percentages)", xlim=55,
             height=max(6, .38*len(data)+1.5))


def make_wordclouds(freqs: dict[int, pd.DataFrame]) -> None:
    wc_paths = []
    for q, frame in freqs.items():
        frequencies = dict(zip(frame.term, frame.response_mentions))
        cloud = WordCloud(width=1800, height=1100, background_color="white", colormap="viridis",
                          random_state=SEED, prefer_horizontal=.9, collocations=False,
                          max_words=100).generate_from_frequencies(frequencies)
        path = FIG_DIR / f"wordcloud-q{q}.png"
        cloud.to_file(str(path)); wc_paths.append(path)
    fig, axes = plt.subplots(1, 3, figsize=(18, 6))
    for ax, q, path in zip(axes, freqs, wc_paths):
        ax.imshow(plt.imread(path)); ax.axis("off"); ax.set_title(f"Q{q}", fontsize=18, fontweight="bold")
    fig.tight_layout(); fig.savefig(FIG_DIR / "wordclouds-combined.png", dpi=220, bbox_inches="tight"); plt.close(fig)


def sanitize_excerpt(text: str) -> str:
    text = re.sub(r"https?://\S+|www\.\S+", "[link removed]", text, flags=re.I)
    text = re.sub(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", "[email removed]", text)
    text = re.sub(r"(?:discord|battletag|character|toon)\s*[:#-]?\s*\S+", "[identifier removed]", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def selected_quotes(df: pd.DataFrame, columns) -> pd.DataFrame:
    selected = set(json.loads((ROOT / "survey_analysis/config/quote_selections.json").read_text())["selected_text_ids"])
    rows = []
    private_candidates = []
    for _, row in df.iterrows():
        for q in (14, 15, 16):
            text = clean(row[columns.one(q)])
            if not text:
                continue
            tid = private_text_id(text)
            if can_quote(row[columns.one(17)]):
                private_candidates.append({"text_id": tid, "question": f"Q{q}", "text": text})
            if tid in selected:
                if not can_quote(row[columns.one(17)]):
                    raise RuntimeError("Quote selection includes an aggregate-only respondent")
                rows.append({"question": f"Q{q}", "text_id": tid, "excerpt": sanitize_excerpt(text)})
    pd.DataFrame(private_candidates).to_csv(INTERIM_DIR / "quote_candidates_private.csv", index=False)
    found = {row["text_id"] for row in rows}
    if found != selected:
        raise RuntimeError(f"Quote selections not found in current allowed responses: {selected - found}")
    return pd.DataFrame(rows, columns=["question", "text_id", "excerpt"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="Use a local CSV snapshot instead of downloading")
    args = parser.parse_args()
    ensure_dirs()
    path, retrieved, digest = retrieve(args.input)
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    columns = detect_columns(list(df.columns))
    df = df[df[columns.timestamp].map(clean).ne("")].reset_index(drop=True)
    row_count, col_count = df.shape
    missingness, duplicate_summary = quality_checks(df, columns)
    tables = structured_tables(df, columns)
    tables["missingness"] = missingness
    tables["subgroups"] = subgroup_table(df, columns)

    theme_counts = []
    combined_text = df[[columns.one(q) for q in (14,15,16)]].agg(" ".join, axis=1)
    for theme in THEME_RULES:
        flags = combined_text.map(lambda text: code_themes(text)[theme])
        theme_counts.append({"theme": theme, "count": int(flags.sum()), "denominator": len(df),
                             "percent": 100 * flags.mean(), "coding": "Rule-based mention; non-exclusive"})
    tables["thematic_validation"] = pd.DataFrame(theme_counts).sort_values("count", ascending=False)
    polarity = df[columns.one(15)].map(powershift_polarity).value_counts().rename_axis("category").reset_index(name="count")
    polarity["denominator"] = len(df); polarity["percent"] = 100 * polarity["count"] / len(df)
    tables["q15_powershift_polarity"] = polarity

    topic_config = json.loads((ROOT / "survey_analysis/config/topic_labels.json").read_text())
    all_prev = []
    freqs = {}
    for q in (14,15,16):
        texts = df[columns.one(q)].tolist()
        freqs[q] = document_frequency(texts)
        save_table(f"wordcloud_q{q}_terms", freqs[q])
        cfg = topic_config[str(q)]
        diag, terms, prev, assignments = topic_outputs(texts, cfg["topics"], cfg["labels"])
        diag.insert(0, "question", f"Q{q}"); terms.insert(0, "question", f"Q{q}")
        prev.insert(0, "question", f"Q{q}"); assignments.insert(0, "question", f"Q{q}")
        save_table(f"topic_diagnostics_q{q}", diag); save_table(f"topic_terms_q{q}", terms)
        save_table(f"topic_prevalence_q{q}", prev); save_table(f"topic_assignments_q{q}", assignments)
        all_prev.append(prev)
    all_prev = pd.concat(all_prev, ignore_index=True)
    tables["topic_prevalence"] = all_prev
    tables["anonymous_excerpts"] = selected_quotes(df, columns)

    for name, table in tables.items(): save_table(name, table)

    metadata = {
        "retrieved_at_america_chicago": retrieved,
        "source_spreadsheet_id": SPREADSHEET_ID,
        "worksheet": WORKSHEET,
        "row_count": row_count,
        "column_count": col_count,
        "sha256": digest,
        "random_seed": SEED,
        **duplicate_summary,
    }
    (PROCESSED_DIR / "source_metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    (TABLE_DIR / "source_metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")

    label_colors = {"Positive": COLORS["positive"], "Mixed / neutral": COLORS["neutral"],
                    "Negative": COLORS["negative"], "Insufficient information": COLORS["info"],
                    "Would play": COLORS["positive"], "Unsure": COLORS["neutral"],
                    "Would not play": COLORS["negative"], "Not applicable": COLORS["info"],
                    "More excited": COLORS["positive"], "Equally excited": COLORS["neutral"],
                    "Less excited": COLORS["negative"]}
    for name, title in [("overall_direction", "Overall reaction to the current direction"),
                        ("likelihood_to_play", "Likelihood of regularly playing Feral"),
                        ("excitement", "Excitement relative to Classic Feral")]:
        plot_bar(tables[name], "category", "percent", FIG_DIR / f"{name.replace('_','-')}.svg", title, label_colors)
    power_labels = {
        "I do not need literal powershifting if another mechanic provides comparable activity and meaningful resource decisions.": "Functional replacement is acceptable",
        "I prefer a non-powershifting design, provided it remains engaging and has enough depth.": "Prefer non-powershifting if engaging",
        "I specifically want Classic-style powershifting restored.": "Specifically restore Classic powershifting",
        "I prefer a slower, less input-intensive Feral rotation than Classic powershifting.": "Prefer slower/less input-intensive",
        "I have no strong preference.": "No strong preference",
        "I do not yet have enough information.": "Insufficient information",
    }
    desired_power_order = list(power_labels.values())
    power_short = tables["powershifting_preference"].assign(
        category=tables["powershifting_preference"].category.map(power_labels)
    ).set_index("category").loc[desired_power_order].reset_index()
    plot_bar(power_short, "category", "percent", FIG_DIR / "powershifting-preference.svg", "Powershifting preference", xlim=72)
    attention = tables["developer_attention"].head(10)
    plot_bar(attention, "category", "percent", FIG_DIR / "developer-attention.svg", "Top developer-attention priorities", xlim=78)
    imp = tables["importance_matrix"].query("category == 'Essential + Very important'").sort_values("percent", ascending=False)
    plot_bar(imp, "quality", "percent", FIG_DIR / "gameplay-qualities.svg", "Most-valued gameplay qualities", xlim=92)
    plot_mechanics(tables["mechanic_reactions"]); plot_subgroups(tables["subgroups"])
    plot_topics(all_prev); make_wordclouds(freqs)

    old = {
        "Negative toward current direction": 59.6, "Positive toward current direction": 22.5,
        "Less excited than Classic": 61.9, "More excited than Classic": 25.0,
        "Would probably/definitely play": 44.4, "Would probably/definitely not play": 33.6,
        "Functional replacement acceptable": 59.1, "Prefer non-powershifting if engaging": 22.2,
        "Specifically want Classic powershifting restored": 14.8,
        "Negative reaction to Furor/loss of powershifting": 70.1,
        "Rotation/activity selected for developer attention": 65.9, "Powershifting/Furor selected": 44.6,
        "Energy economy selected": 33.9, "Shapeshifting/weaving identity selected": 27.6, "AoE selected": 26.7,
    }
    def pct(table, category): return float(table.loc[table.category.eq(category), "percent"].iloc[0])
    attention_map = dict(zip(tables["developer_attention"].category, tables["developer_attention"].percent))
    current = {
        "Negative toward current direction": pct(tables["overall_direction"], "Negative"),
        "Positive toward current direction": pct(tables["overall_direction"], "Positive"),
        "Less excited than Classic": pct(tables["excitement"], "Less excited"),
        "More excited than Classic": pct(tables["excitement"], "More excited"),
        "Would probably/definitely play": pct(tables["likelihood_to_play"], "Would play"),
        "Would probably/definitely not play": pct(tables["likelihood_to_play"], "Would not play"),
        "Functional replacement acceptable": float(power_short.loc[power_short.category.eq("Functional replacement is acceptable"), "percent"].iloc[0]),
        "Prefer non-powershifting if engaging": float(power_short.loc[power_short.category.eq("Prefer non-powershifting if engaging"), "percent"].iloc[0]),
        "Specifically want Classic powershifting restored": float(power_short.loc[power_short.category.eq("Specifically restore Classic powershifting"), "percent"].iloc[0]),
        "Negative reaction to Furor/loss of powershifting": float(tables["mechanic_reactions"].query("area == 'Furor and the loss/reduction of powershifting' and category == 'Negative'").percent.iloc[0]),
        "Rotation/activity selected for developer attention": attention_map.get("Rotation/activity level", 0),
        "Powershifting/Furor selected": attention_map.get("Powershifting/Furor", 0),
        "Energy economy selected": attention_map.get("Energy economy", 0),
        "Shapeshifting/weaving identity selected": attention_map.get("Shapeshifting or weaving identity", 0),
        "AoE selected": attention_map.get("AoE", 0),
    }
    comparison = pd.DataFrame([{"metric": key, "earlier_675_percent": old[key],
                                "current_percent": current[key], "change_pp": current[key]-old[key]}
                               for key in old])
    save_table("comparison_675", comparison); tables["comparison_675"] = comparison

    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=select_autoescape())
    template = env.get_template("report.html.j2")
    html_tables = {name: table.round(1).to_html(index=False, classes="data-table", border=0)
                   for name, table in tables.items()}
    sample_counts = {name: dict(zip(table.category, table["count"]))
                     for name, table in tables.items()
                     if name in {"familiarity", "primary_interest", "experience"}}
    context = {"metadata": metadata, "tables": tables, "html_tables": html_tables, "current": current,
               "sample_counts": sample_counts,
               "retrieved_display": datetime.fromisoformat(retrieved).astimezone(ZoneInfo("America/Chicago")).strftime("%B %-d, %Y at %-I:%M %p %Z"),
               "collection_start": duplicate_summary["collection_start"], "collection_end": duplicate_summary["collection_end"]}
    (PUBLIC_DIR / "index.html").write_text(template.render(**context), encoding="utf-8")
    # Matplotlib SVGs and templated HTML can contain harmless trailing spaces;
    # normalize generated text so `git diff --check` remains a useful gate.
    for generated in PUBLIC_DIR.rglob("*"):
        if generated.is_file() and generated.suffix.lower() in {".svg", ".html", ".csv", ".json"}:
            normalized = "\n".join(line.rstrip() for line in generated.read_text(encoding="utf-8").splitlines()) + "\n"
            generated.write_text(normalized, encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
