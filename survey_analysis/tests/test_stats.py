from forever_survey.stats import can_quote, clean, grouped_percent, normalize_text, parse_multiselect


def test_multiselect_parsing():
    assert parse_multiselect("Cat, Bear,  AoE ") == ["Cat", "Bear", "AoE"]
    assert parse_multiselect("") == []


def test_grouped_percentage_denominator_and_missing():
    result = grouped_percent(["Agree", "Strongly agree", "", None], {"Agree", "Strongly agree"})
    assert result == {"count": 2, "denominator": 4, "percent": 50.0}


def test_missing_value_handling():
    assert clean(None) == ""
    assert clean(" NaN ") == ""


def test_quote_permission_enforcement():
    assert can_quote("Yes, it may be quoted anonymously")
    assert not can_quote("No, summarize it only in aggregate")
    assert not can_quote("")


def test_text_normalization():
    assert normalize_text(" Tiger’s  Fury — TEST! https://x.invalid ") == "tiger's fury test"
