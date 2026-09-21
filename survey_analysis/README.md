# Forever Feral survey analysis

This directory contains the reproducible source for the public report at
[`/analysis/`](../analysis/). Raw Google Forms responses are downloaded locally,
analyzed, and never committed.

The main page is written for the player community. Detailed methods, model
diagnostics, limitations, and downloads are generated as
`analysis/methodology.html` so transparency does not interrupt the narrative.

## Context archives

Three local DiscordKit HTML exports (`forever-general`, `forever-feral-dps`,
and `forever-feral-tank`) document the discussion that motivated the survey.
They are context only: the pipeline does not read, analyze, quote, copy, or
publish them. All quantitative and qualitative findings come from the survey.

## Refresh

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python survey_analysis/scripts/refresh_analysis.py
```

The refresh command downloads the `Form Responses 1` worksheet, validates the
45-column schema, records source provenance and a SHA-256 snapshot hash, runs
the structured and text analyses with a fixed seed, and rebuilds the public
HTML report plus aggregate downloads. Use `--input PATH` to reproduce from an
already-downloaded snapshot. The input remains ignored by Git.

## Privacy boundary

- `data/raw/` and `data/interim/` are ignored.
- Discord HTML exports are never copied into this public repository.
- The public report contains aggregate results and a small set of manually
  reviewed anonymous excerpts from respondents who allowed quotation.
- Topic-document tables contain anonymous document IDs and numerical weights,
  never response text or timestamps.
- `scripts/privacy_audit.py` fails if raw headers, email addresses, URLs, or
  aggregate-only response fragments appear in tracked public output.

## Validation

```bash
.venv/bin/python -m pytest
.venv/bin/python survey_analysis/scripts/privacy_audit.py
git diff --check
```
