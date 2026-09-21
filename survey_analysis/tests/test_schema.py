import pytest

from forever_survey.schema import SchemaError, detect_columns


def valid_headers():
    headers = ["Timestamp"]
    single = {
        1:"How familiar", 2:"Which versions", 3:"main interest", 4:"experience level",
        5:"feel about the direction", 6:"how likely", 7:"Compared with Classic",
        8:"view of powershifting", 12:"most need developer attention", 13:"open to testing",
        14:"single most important thing", 15:"most want preserved", 16:"change one mechanic",
        17:"quoted anonymously",
    }
    for q in range(1,18):
        count = 10 if q in (9,10,11) else 1
        for i in range(count): headers.append(f"{q}. {single.get(q, 'matrix')} {i}")
    return headers


def test_column_detection():
    cols = detect_columns(valid_headers())
    assert len(cols.by_question[9]) == 10
    assert cols.one(14).startswith("14.")


def test_column_detection_fails_clearly_on_rename():
    headers = valid_headers(); headers[1] = "1. unrelated"
    with pytest.raises(SchemaError, match="Q1"):
        detect_columns(headers)
