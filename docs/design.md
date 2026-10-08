# Design

## Goals

1. Give maintainers a criteria-based gate between "anyone can open a pull request" and "pull requests are off".
2. Every decision is explainable as a list of checks with a reason and a concrete fix.
3. Never judge writing style. Judge evidence: what changed, what was claimed, what was filled in.
4. Safe on `pull_request_target`: no checkout, no execution of contributor code, policy from the default branch.
5. Cheap: a few REST calls per item, search calls budgeted, no external service unless the LLM option is on.

## Pipeline

```
event ──> targets ──> gather ──> checks ──> score/outcome ──> plan ──> execute (enforce only)
                        │                                      │
                     GitHub API                          job summary, outputs
```

| Module | Role | Side effects |
|---|---|---|
| `src/main.ts` | Maps the event to target items, runs the pipeline, writes the summary | reads env, calls GitHub |
| `src/gather.ts` | Fetches everything a check needs into a plain `Subject` | GitHub reads only |
| `src/checks.ts` | One function per check, `Subject + Policy -> CheckResult` | none |
| `src/engine.ts` | Trust, score, outcome | none |
| `src/render.ts` | Sticky comment, hidden state marker, job summary | none |
| `src/apply.ts` | `plan()` decides actions from decision and previous state; `execute()` performs them | GitHub writes |
| `src/llm.ts` | Optional advisory review | model API |
| `src/report.ts`, `src/cli.ts` | Read-only CLI over the same `evaluate()` | GitHub reads only |

Checks are pure, so nearly all behaviour is tested without HTTP. The GitHub boundary is covered by integration tests that run `run()` against nock fixtures and assert, among other things, that `dry-run` issues no write request (any non-GET other than a GraphQL query fails the test).

## Gathering

`gatherPull` fetches the pull request, author, changed files with patches, the repository's PR templates, linked issues (closing keywords and `Refs #n` from the body, plus GraphQL `closingIssuesReferences`), check runs and statuses for the head commit, open pull requests for duplicate detection, the base tree when the description names file paths, and the author's recent pull requests across GitHub.

Every non-essential fetch goes through `soft()`: a failure is logged and the dependent check reports `skip` instead of failing the run. A missing permission or a rate limit never turns into a false accusation.

Search is the scarce resource (30 requests per minute). The action allows 8 search calls per run, stops early when `x-ratelimit-remaining` gets low, and caches results per run. The CLI spaces calls 2.2 seconds apart.

## Scoring

Two kinds of checks:

- **Evidence** answers "did the author do the work the project asks for": description, template, linked issue, tests, CI, size, bug report details. Score is the weighted share of evidence present: pass 1, warn 0.5, fail 0, skip excluded.
- **Red flags** answer "is something off": claims that contradict the diff, generic titles, references to files that do not exist, duplicates, mass submissions, new accounts. They only subtract (`weight x 10` on fail, `weight x 4` on warn).

An earlier version averaged all checks together. Absence-of-problem checks then inflated the score of template-only pull requests to around 47, because "not a duplicate" and "not spam" counted as passes. Separating the two kinds fixed that: the score now measures effort and only goes down for red flags.

A failed `required` check caps the outcome at needs info regardless of score, so a policy can make a single criterion (for example an approved linked issue) mandatory. A failed red flag does the same: a description that contradicts the diff or a burst of copies is worth a question even when everything else is in place. Red flags prone to false positives (unknown symbols, a single unknown path, new accounts) only ever warn.

## State

The sticky comment carries a hidden marker:

```
<!-- effortgate:v1 {"outcome":"needs_info","score":55,"since":"2026-10-01T09:00:00.000Z","failed":["template"]} -->
```

- `since` is when the current outcome started, reset whenever the outcome changes or the author acts (opens, pushes, edits, replies). The scheduled sweep closes items where `now - since > close_after_days`.
- Draft conversion and request-changes reviews only happen on an outcome transition, read from the marker.
- Only comments authored by a bot account are considered, so a contributor cannot plant a marker to reset their own timer.
- `report` reads the same marker to summarise past decisions without re-evaluating.

## Text heuristics

- **Template echo.** Lines that also appear in any of the repository's templates (normalised to lowercase alphanumerics), unchecked checkboxes, HTML comments, and placeholders such as `_No response_` or `N/A` are removed before measuring content.
- **Sections.** Markdown headings and bold-only lines. Sections that are checklists or marked optional are not required.
- **Claims.** Line-based patterns for "added tests", "updated docs", "typo fix", ignoring lines with a nearby negation and unchecked boxes.
- **References.** Paths with a directory and an extension, outside URLs, must exist in the diff or the base tree. Backticked `calls()` must appear in the patch text; this only warns because descriptions legitimately mention unchanged functions.
- **Similarity.** Jaccard over word sets with stop words removed, weighted 0.6 title and 0.4 body, with template lines stripped so two untouched templates do not look identical.

These are deliberately simple and conservative. Each one maps to a sentence the contributor can verify.

## LLM option

Advisory by construction: the review is attached to the decision after the outcome is computed and is never read by `score()` or `outcomeFor()`. It uses structured output (Zod schema via the Anthropic SDK, JSON schema with OpenAI) so the rendering never parses prose. GitHub Models was considered and dropped: GitHub retired its inference API on July 30, 2026.

## Non-goals

- AI-authorship detection.
- Running or building contributor code.
- Replacing review. A passing pull request still gets a human reviewer.
