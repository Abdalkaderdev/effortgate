# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-08

### Added

- GitHub Action (`node24`) that scores pull requests and issues against `.github/effortgate.yml`.
- Pull request checks: description, template completion, linked issue (optionally with an approval label),
  tests touched, CI status, first-contribution size, description-vs-diff claims, title scope,
  references (issue numbers, file paths, functions), duplicates, mass-submission pattern, account age.
- Issue checks: description, template completion, actionable bug report (reproduction and version), duplicates, account age.
- Per-path rules, trusted users, bots, associations and merged-PR threshold.
- Outcome actions: labels, one sticky comment, convert to draft, request changes, close after N days without a response.
- `dry-run` mode (default) that writes nothing and reports in the job summary.
- Optional advisory LLM review with Anthropic or OpenAI keys. Off by default, never decides the outcome.
- `effortgate check` and `effortgate report` CLI (markdown, HTML, JSON).
