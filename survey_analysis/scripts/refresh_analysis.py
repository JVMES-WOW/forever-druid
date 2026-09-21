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
from matplotlib.colors import LinearSegmentedColormap
import numpy as np
import pandas as pd
from jinja2 import Environment, FileSystemLoader, select_autoescape
from wordcloud import WordCloud

from forever_survey import SEED
from forever_survey.analysis import HEADLINE_MAP, structured_tables, subgroup_table
from forever_survey.schema import detect_columns
from forever_survey.stats import can_quote, clean, parse_multiselect
from forever_survey.text import document_frequency, private_text_id, topic_outputs
from forever_survey.themes import THEME_RULES, code_themes, powershift_polarity

PRIVATE_SOURCE_FILE = ROOT / "survey_analysis" / "config" / "source_url.private.txt"
RAW_DIR = ROOT / "survey_analysis" / "data" / "raw"
INTERIM_DIR = ROOT / "survey_analysis" / "data" / "interim"
PROCESSED_DIR = ROOT / "survey_analysis" / "data" / "processed"
PUBLIC_DIR = ROOT / "analysis"
FIG_DIR = PUBLIC_DIR / "figures"
TABLE_DIR = PUBLIC_DIR / "tables"
TEMPLATE_DIR = ROOT / "survey_analysis" / "templates"

COLORS = {"positive": "#557c68", "neutral": "#8a938d", "negative": "#a35e58",
          "info": "#5f7f99", "gold": "#9a7b3d", "purple": "#756b83"}

plt.rcParams.update({
    "figure.facecolor": "#ffffff", "axes.facecolor": "#ffffff",
    "savefig.facecolor": "#ffffff", "text.color": "#222a25",
    "axes.labelcolor": "#4f5b54", "axes.edgecolor": "#cdd4cf",
    "xtick.color": "#4f5b54", "ytick.color": "#303a34",
    "grid.color": "#dbe0dc", "font.family": "DejaVu Sans",
})


def ensure_dirs() -> None:
    for path in (RAW_DIR, INTERIM_DIR, PROCESSED_DIR, PUBLIC_DIR, FIG_DIR, TABLE_DIR):
        path.mkdir(parents=True, exist_ok=True)


def private_source_url() -> str:
    url = os.environ.get("FOREVER_SURVEY_CSV_URL", "").strip()
    if not url and PRIVATE_SOURCE_FILE.exists():
        url = PRIVATE_SOURCE_FILE.read_text().strip()
    if not url:
        raise RuntimeError(
            "No private survey source configured. Set FOREVER_SURVEY_CSV_URL, "
            "create survey_analysis/config/source_url.private.txt, or use --input PATH."
        )
    return url


def retrieve(source: Path | None) -> tuple[Path, str, str]:
    retrieved = datetime.now(ZoneInfo("America/Chicago")).isoformat(timespec="seconds")
    destination = RAW_DIR / "form_responses.csv"
    if source:
        shutil.copyfile(source, destination)
    else:
        request = urllib.request.Request(
            private_source_url(), headers={"User-Agent": "Forever-Feral-Survey-Analysis/1.0"}
        )
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


def survey_instrument(df: pd.DataFrame, columns) -> pd.DataFrame:
    """Publish question wording and response formats without respondent-level data."""
    rows = []
    fixed_scales = {
        9: "Essential; Very important; Moderately important; Slightly important; Not important",
        10: "Strongly agree; Agree; Neither; Disagree; Strongly disagree; Not enough information",
        11: "Very positive; Somewhat positive; Neutral; Somewhat negative; Very negative; Not enough information",
    }
    for q, question_columns in columns.by_question.items():
        for column in question_columns:
            item = ""
            bracketed = re.search(r"\[([^\]]+)\]\s*$", column)
            if bracketed:
                item = bracketed.group(1)
            if q in (14, 15, 16):
                response_format = "Open text"
                options = "Free response"
            elif q in (2, 12, 13):
                response_format = "Multiple selection"
                options = sorted({choice for value in df[column] for choice in parse_multiselect(value)})
                options = "; ".join(options)
            elif q in fixed_scales:
                response_format = "Matrix, one choice per item"
                options = fixed_scales[q]
            else:
                response_format = "Single choice"
                options = "; ".join(sorted({clean(value) for value in df[column] if clean(value)}))
            stem = re.sub(r"\s*\[[^\]]+\]\s*$", "", column)
            rows.append({"question": f"Q{q}", "wording": stem, "item": item,
                         "response_format": response_format, "response_options": options})
    return pd.DataFrame(rows)


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
        ax.text(bar.get_width() + 0.8, bar.get_y() + bar.get_height()/2, annotation,
                va="center", fontsize=9, color="#303a34")
    ax.set_title(title, loc="left", fontweight="bold", pad=12)
    ax.set_xlabel(xlabel)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.grid(axis="x", alpha=.2)
    ax.set_axisbelow(True)
    ax.set_xlim(0, xlim or max(100, float(data[value_col].max()) * 1.25))
    fig.tight_layout()
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def plot_donut(frame: pd.DataFrame, path: Path, title: str, colors: dict[str, str]) -> None:
    """Show a small mutually exclusive distribution as a restrained part-to-whole chart."""
    palette = [colors.get(category, COLORS["info"]) for category in frame["category"]]
    labels = [
        f"{row.category}: {row.percent:.1f}%  ({int(row['count'])}/{int(row.denominator)})"
        for _, row in frame.iterrows()
    ]
    fig, ax = plt.subplots(figsize=(8, 4.6))
    ax.pie(frame["percent"], colors=palette, startangle=90, counterclock=False,
           wedgeprops={"width": .42, "edgecolor": "#ffffff", "linewidth": 1.5})
    ax.text(0, .05, f"n={int(frame.denominator.iloc[0])}", ha="center", va="center",
            fontsize=13, fontweight="bold", color="#303a34")
    ax.text(0, -.14, "responses", ha="center", va="center", fontsize=8, color="#68746d")
    ax.set_title(title, loc="left", fontweight="bold", pad=12)
    ax.legend(labels, loc="center left", bbox_to_anchor=(1.0, .5), frameon=False,
              fontsize=8.5, handlelength=1.1, labelspacing=.9)
    ax.set_aspect("equal")
    fig.tight_layout()
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def plot_mechanics(table: pd.DataFrame) -> None:
    table = table[~table.area.eq("Combo points being stored on the player")]
    pos = table[table.category.eq("Positive")][["area", "percent"]].rename(columns={"percent": "positive"})
    neg = table[table.category.eq("Negative")][["area", "percent"]].rename(columns={"percent": "negative"})
    data = pos.merge(neg).sort_values("negative")
    y = np.arange(len(data))
    fig, ax = plt.subplots(figsize=(11, 7.2))
    ax.barh(y, -data.negative, color=COLORS["negative"], label="Negative")
    ax.barh(y, data.positive, color=COLORS["positive"], label="Positive")
    ax.set_yticks(y, [re.sub(r"\s+", " ", x).replace("possibilities", "") for x in data.area])
    ax.axvline(0, color="#9a7b3d88", lw=.8)
    ax.set_xlim(-85, 85)
    ax.set_xticks([-80,-60,-40,-20,0,20,40,60,80], ["80%","60%","40%","20%","0","20%","40%","60%","80%"])
    ax.set_title("Mechanic reactions: negative vs. positive", loc="left", fontweight="bold")
    ax.legend(frameon=False, ncol=2, loc="lower right", labelcolor="#303a34")
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
                fmt="o", color="#8c7139", ecolor="#a29370", capsize=3)
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


def plot_experience(table: pd.DataFrame) -> None:
    labels = {
        "High-end or competitive Feral player": "High-end / competitive",
        "Regular organized-raiding Feral player": "Regular organized raider",
        "Experienced but primarily casual Feral player": "Experienced, primarily casual",
        "New or prospective Feral player": "New or prospective",
        "I mainly play another Druid role/spec": "Mainly another Druid role",
        "I mainly play another class": "Mainly another class",
    }
    data = table.assign(category=table.category.map(labels).fillna(table.category))
    experience_colors = {
        "High-end / competitive": "#5f7f99",
        "Regular organized raider": "#8296a6",
        "Experienced, primarily casual": "#9a7b3d",
        "New or prospective": "#668675",
        "Mainly another Druid role": "#8b8171",
        "Mainly another class": "#756b83",
    }
    plot_donut(data, FIG_DIR / "experience-profile.svg",
               "Self-described Feral experience", experience_colors)


def make_wordclouds(freqs: dict[int, pd.DataFrame]) -> None:
    wc_paths = []
    for q, frame in freqs.items():
        frequencies = dict(zip(frame.term, frame.response_mentions))
        cloud_colors = LinearSegmentedColormap.from_list(
            "forever", ["#2f4a3b", "#6f5d31", "#596b61", "#3f5a4b"]
        )
        cloud = WordCloud(width=1800, height=1100, background_color="#ffffff", colormap=cloud_colors,
                          random_state=SEED, prefer_horizontal=.9, collocations=False,
                          max_words=75).generate_from_frequencies(frequencies)
        path = FIG_DIR / f"wordcloud-q{q}.png"
        cloud.to_file(str(path)); wc_paths.append(path)
    fig, axes = plt.subplots(1, 3, figsize=(18, 6), facecolor="#ffffff")
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
    tables["survey_instrument"] = survey_instrument(df, columns)

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
                        ("excitement", "Excitement relative to Classic Feral")]:
        plot_donut(tables[name], FIG_DIR / f"{name.replace('_','-')}.svg", title, label_colors)
    plot_bar(tables["likelihood_to_play"], "category", "percent",
             FIG_DIR / "likelihood-to-play.svg", "Likelihood of regularly playing Feral", label_colors)
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
    plot_topics(all_prev); plot_experience(tables["experience"]); make_wordclouds(freqs)

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
        "Do not require literal powershifting": float(power_short.loc[power_short.category.isin(["Functional replacement is acceptable", "Prefer non-powershifting if engaging"]), "percent"].sum()),
        "Specifically want Classic powershifting restored": float(power_short.loc[power_short.category.eq("Specifically restore Classic powershifting"), "percent"].iloc[0]),
        "Negative reaction to Furor/loss of powershifting": float(tables["mechanic_reactions"].query("area == 'Furor and the loss/reduction of powershifting' and category == 'Negative'").percent.iloc[0]),
        "Rotation/activity selected for developer attention": attention_map.get("Rotation/activity level", 0),
        "Powershifting/Furor selected": attention_map.get("Powershifting/Furor", 0),
        "Energy economy selected": attention_map.get("Energy economy", 0),
        "Shapeshifting/weaving identity selected": attention_map.get("Shapeshifting or weaving identity", 0),
        "AoE selected": attention_map.get("AoE", 0),
    }
    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=select_autoescape())
    template = env.get_template("report.html.j2")
    html_tables = {name: table.round(1).to_html(index=False, classes="data-table", border=0)
                   for name, table in tables.items()}
    sample_counts = {name: dict(zip(table.category, table["count"]))
                     for name, table in tables.items()
                     if name in {"familiarity", "primary_interest", "experience"}}
    subgroup_summary: dict[str, dict[str, float]] = {}
    for _, row in tables["subgroups"].iterrows():
        subgroup_summary.setdefault(row["group"], {})[row["outcome"]] = float(row["percent"])
    mechanic_summary = {
        row.area: float(row.percent)
        for row in tables["mechanic_reactions"].itertuples()
        if row.category == "Positive"
    }
    priority_summary = dict(zip(tables["developer_attention"].category,
                                tables["developer_attention"].percent))
    direction_summary = dict(zip(tables["directions_to_test"].category,
                                 tables["directions_to_test"].percent))
    negative_mechanics = {
        row.area: float(row.percent)
        for row in tables["mechanic_reactions"].itertuples()
        if row.category == "Negative"
    }
    disagreement_summary = {
        row.statement: float(row.percent)
        for row in tables["agreement_matrix"].itertuples()
        if row.category == "Disagree + Strongly disagree"
    }
    importance_summary = {
        row.quality: float(row.percent)
        for row in tables["importance_matrix"].itertuples()
        if row.category == "Essential + Very important"
    }
    featured_viewpoints = {
        "acad144b7596a53f": "Functional replacement",
        "80e25be9def5d6b7": "AoE and group viability",
        "9f8efc112574893d": "Hybrid and off-tank play",
        "d8e9ffa150c3b8b4": "Shapeshifting without powershifting",
    }
    featured_quotes = tables["anonymous_excerpts"][
        tables["anonymous_excerpts"].text_id.isin(featured_viewpoints)
    ].copy()
    featured_quotes["viewpoint"] = featured_quotes.text_id.map(featured_viewpoints)
    phrase_top = {q: frame.head(5).to_dict("records") for q, frame in freqs.items()}
    context = {"metadata": metadata, "tables": tables, "html_tables": html_tables, "current": current,
               "sample_counts": sample_counts,
               "subgroup_summary": subgroup_summary,
               "mechanic_summary": mechanic_summary, "priority_summary": priority_summary,
               "direction_summary": direction_summary,
               "negative_mechanics": negative_mechanics,
               "disagreement_summary": disagreement_summary,
               "importance_summary": importance_summary,
               "phrase_top": phrase_top,
               "featured_quotes": featured_quotes,
               "retrieved_display": datetime.fromisoformat(retrieved).astimezone(ZoneInfo("America/Chicago")).strftime("%B %-d, %Y at %-I:%M %p %Z"),
               "collection_start": duplicate_summary["collection_start"], "collection_end": duplicate_summary["collection_end"]}
    (PUBLIC_DIR / "index.html").write_text(template.render(**context), encoding="utf-8")
    methods = env.get_template("methodology.html.j2")
    (PUBLIC_DIR / "methodology.html").write_text(methods.render(**context), encoding="utf-8")
    shutil.copyfile(TEMPLATE_DIR / "report.css", PUBLIC_DIR / "report.css")
    # Matplotlib SVGs and templated HTML can contain harmless trailing spaces;
    # normalize generated text so `git diff --check` remains a useful gate.
    for generated in PUBLIC_DIR.rglob("*"):
        if generated.is_file() and generated.suffix.lower() in {".svg", ".html", ".csv", ".json"}:
            normalized = "\n".join(line.rstrip() for line in generated.read_text(encoding="utf-8").splitlines()) + "\n"
            generated.write_text(normalized, encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
