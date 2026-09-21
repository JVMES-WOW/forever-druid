import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_main_report_is_plain_language_and_context_is_not_evidence():
    template = (ROOT / "survey_analysis/templates/report.html.j2").read_text().casefold()
    for jargon in ("tf-idf", "non-negative matrix", "wilson", "reconstruction error"):
        assert jargon not in template
    assert "were not coded, counted, quoted, or included" in template
    assert "i’m <strong>jvmes</strong>" in template
    assert "not a petition for one implementation" in template
    assert "#forever-general" in template
    assert "wordcloud-q{{ q }}.png" in template
    assert "competitive” is a self-report" in template
    assert "combat logs, parses, rankings" in template
    assert template.index("three results tell the story") < template.index("project intent")
    assert "this is primarily a cat and hybrid-play concern" in template
    assert 'current["do not require literal powershifting"]' in template
    assert 'current["functional replacement acceptable"]' in template
    assert "played the test build" in template
    assert "developer design brief" in template
    assert "these full excerpts" in template
    assert "featured_quote_columns" in template
    assert "shortened for display" not in template
    assert "meaningful pooling" not in template
    assert "meaningful resource decisions without excessive empty time" in template
    assert "risk to validate" not in template
    assert "excessive apm" not in template
    assert "making energy irrelevant" not in template
    assert template.count("donut chart") == 3
    assert "these respondents give the design team" in template
    assert "combo points stored on the player" not in template
    assert "player-stored combo points" not in template


def test_methods_page_keeps_technical_detail_and_downloads():
    methods = (ROOT / "survey_analysis/templates/methodology.html.j2").read_text().casefold()
    assert "tf-idf" in methods
    assert "wilson 95%" in methods
    assert "aggregate downloads" in methods
    assert "two- or three-word phrase" in methods
    assert "675-response" not in methods
    assert "reddit.com/r/classicwow/comments/1wljuy6/" in methods
    assert "not part of the analyzed corpus" in methods
    assert "survey instrument and interpretation boundary" in methods
    assert "exact duplicate answer rows" in methods
    assert "design reference boundary" in methods
    assert "github.com/jvmes-wow/forever-druid/tree/main/survey_analysis" in methods
    assert "survey_instrument.csv" in methods
    assert "live response sheet is not publicly linked" in methods
    assert "subject to respondent privacy and consent" in methods
    assert "docs.google.com/spreadsheets" not in methods
    assert "source_spreadsheet_id" not in methods


def test_public_metadata_does_not_identify_private_source():
    metadata = json.loads((ROOT / "analysis/tables/source_metadata.json").read_text())
    assert "source_spreadsheet_id" not in metadata
    assert "worksheet" not in metadata


def test_report_theme_matches_existing_dark_green_and_gold_palette():
    css = (ROOT / "survey_analysis/templates/report.css").read_text().casefold()
    assert "#0b1010" in css
    assert "#f4f6f3" in css
    assert "color-scheme:light" in css
    assert ".topbar" in css and ".brand" in css
    assert "radial-gradient" not in css


def test_obsolete_rake_scaling_quote_is_not_selected():
    config = json.loads((ROOT / "survey_analysis/config/quote_selections.json").read_text())
    assert "e1f9bbbc08954840" not in config["selected_text_ids"]
    assert "80e25be9def5d6b7" in config["selected_text_ids"]


def test_shapeshifting_quote_supports_non_powershifting_design_goal():
    config = json.loads((ROOT / "survey_analysis/config/quote_selections.json").read_text())
    assert "b455da06728cb871" not in config["selected_text_ids"]
    assert "d8e9ffa150c3b8b4" in config["selected_text_ids"]


def test_five_featured_quotes_use_balanced_columns():
    refresh = (ROOT / "survey_analysis/scripts/refresh_analysis.py").read_text()
    assert '"0f380cd545d49755": "Activity and resource decisions"' in refresh
    assert 'featured_quotes.loc[["80e25be9def5d6b7", "acad144b7596a53f", "9f8efc112574893d"]]' in refresh
    assert 'featured_quotes.loc[["d8e9ffa150c3b8b4", "0f380cd545d49755"]]' in refresh
