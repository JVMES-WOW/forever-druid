from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_main_report_is_plain_language_and_context_is_not_evidence():
    template = (ROOT / "survey_analysis/templates/report.html.j2").read_text().casefold()
    for jargon in ("tf-idf", "non-negative matrix", "wilson", "reconstruction error"):
        assert jargon not in template
    assert "were not coded, counted, quoted, or included" in template
    assert "#forever-general" in template


def test_methods_page_keeps_technical_detail_and_downloads():
    methods = (ROOT / "survey_analysis/templates/methodology.html.j2").read_text().casefold()
    assert "tf-idf" in methods
    assert "wilson 95%" in methods
    assert "aggregate downloads" in methods


def test_report_theme_matches_existing_dark_green_and_gold_palette():
    css = (ROOT / "survey_analysis/templates/report.css").read_text().casefold()
    assert "#080d0a" in css
    assert "#d8ad5d" in css
    assert ".topbar" in css and ".brand" in css
