# Evaluation against real pull requests

effortgate 0.1.0 with the **default policy** (no `.github/effortgate.yml`), run read-only in dry-run against the 30 most recent pull requests (opened 2026-09-28 to 2026-10-07) from five busy public repositories. Nothing was posted, labelled, or changed. Command:

```sh
effortgate report <owner/repo> --days 10 --limit 6 --format json
```

Author names are left out on purpose. Titles are as they appear on GitHub. "State" is what the maintainers had done by 2026-10-08, which is the closest thing to ground truth available.

## Results

| Repository | PR | State | Outcome | Score | Failed | Warned | Assessment |
|---|---|---|---|---|---|---|---|
| langchain-ai/langchain | 41140 feat(anthropic): support Claude Haiku 5.5 | open | trusted | | | | correct, maintainer |
| langchain-ai/langchain | 41139 test(fireworks): stabilize forced tool-call extraction | merged | trusted | | | | correct, maintainer |
| langchain-ai/langchain | 41137 release(fireworks): 1.7.1 | merged | trusted | | | | correct, maintainer |
| langchain-ai/langchain | 41134 feat: Add x402 Markdown Scraper Tool to Community | closed | low effort | 16 | template, tests, ci, mass_pr | | correct: one of five identical copies, all closed by maintainers |
| langchain-ai/langchain | 41133 (same title) | closed | low effort | 16 | template, tests, ci, mass_pr | | correct |
| langchain-ai/langchain | 41132 (same title) | closed | low effort | 16 | template, tests, ci, mass_pr | | correct |
| ollama/ollama | 18855 Set CLAUDE_CODE_MAX_CONTEXT_TOKENS to model's context length | open | pass | 100 | | | correct: small, explained, test included |
| ollama/ollama | 18854 mlx: drop carried metal residency patch now that it is upstream | merged | trusted | | | | correct |
| ollama/ollama | 18852 manifest: avoid symlinks on Windows | merged | trusted | | | | correct |
| ollama/ollama | 18851 docs: adding research agent sample project | open | pass | 100 | | | debatable: 415-line docs addition with a two-line description; effort checks are satisfied, value is a maintainer call |
| ollama/ollama | 18849 llm: report transport errors instead of JSON errors on truncated llama-server streams | open | pass | 100 | | | correct: linked issue, root-cause write-up |
| ollama/ollama | 18848 compatmigrate: fix Statfs space math on FreeBSD | open | pass | 100 | | | correct |
| vercel/next.js | 99837 test: add a `vercel` gate condition for Vercel-specific deploy tests | open | trusted | | | | correct |
| vercel/next.js | 99835 docs: clarify metadata runtime caching | open | trusted | | | | correct |
| vercel/next.js | 99834 test: add regression suite for component stack generation | open | trusted | | | | correct |
| vercel/next.js | 99833 Add `next upgrade --ci` and GitHub Action for agent upgrades | open | trusted | | | | correct (see references note below) |
| vercel/next.js | 99832 Move upgrade workflows into @next/upgrade | open | trusted | | | | correct |
| vercel/next.js | 99829 Fix empty segment and lost title when navigating during a LoadingBoundary | open | pass | 96 | | account | correct: account-age warning did not block |
| excalidraw/excalidraw | 12244 fix(editor): pan once and keep editing on a wheel-button drag | merged | trusted | | | | correct |
| excalidraw/excalidraw | 12242 updated readme | closed | needs info | 67 | description | | correct: empty description, closed unmerged |
| excalidraw/excalidraw | 12240 fix(app): explain that sharing and collaboration need HTTPS | open | pass | 100 | | | correct |
| excalidraw/excalidraw | 12239 fix(element): keep frame x and y of 0 in convertToExcalidrawElements | open | pass | 100 | | | correct |
| excalidraw/excalidraw | 12238 feat: support images in library | open | needs info | 75 | description | | correct: tested 258-line feature with an empty description; asking for one is the right nudge, not a rejection |
| excalidraw/excalidraw | 12237 feat(editor): alt-click to cycle the selection through overlapping elements | merged | trusted | | | | correct |
| TheAlgorithms/Python | 15539 feat(dynamic_programming): add weighted interval scheduling algorithm | open | pass | 100 | | | correct: doctests count as tests |
| TheAlgorithms/Python | 15538 Fix empty input in parallel odd-even transposition sort | open | needs info | 80 | mass_pr | | correct: the author opened the same pull request three times in 24 hours; two copies were auto-closed |
| TheAlgorithms/Python | 15537 (same title) | closed | needs info | 76 | mass_pr | duplicates | correct |
| TheAlgorithms/Python | 15536 maths: add Keith number algorithm | open | pass | 100 | | | correct |
| TheAlgorithms/Python | 15535 Type stalin sort for any comparable items | open | pass | 100 | | | correct |
| TheAlgorithms/Python | 15534 fix(geometry): remove unused TypeVar from graham_scan | closed | pass | 100 | | | plausible: tidy change, closed by maintainers for reasons the data doesn't show |

## Summary

| Outcome | Count |
|---|---|
| trusted (skipped) | 12 |
| pass | 11 |
| needs info | 4 |
| low effort | 3 |

- No pull request from a maintainer or returning contributor would have been touched.
- All three low-effort labels landed on copies of a spam submission that maintainers closed.
- The four needs-info outcomes each map to one concrete, fixable item (write a description, keep one copy).
- One pass is debatable on value, not effort. effortgate does not try to judge whether a feature is wanted; `linked_issue` with `required_label` is the tool for that.
- No outcome depended on writing style.

## What this run changed in the engine

Running against real data surfaced false positives that the unit tests did not. Each was fixed before the run above, and each now has a regression test:

| Finding | Fix |
|---|---|
| Absence-of-problem checks ("not a duplicate", "not spam") counted as passes and lifted a template-only pull request to about 47 | Scores now measure evidence; red flags only subtract |
| A description mentioning a build artifact (`dist/terminal.js`) failed `references` | Build output paths are ignored |
| A description describing a file the change generates in users' repositories failed `references` | A single unknown path only warns; failing needs at least two unknown paths and a majority |
| "keep the workflow tiny" in a 3000-line pull request tripped the small-change claim | Small-change wording is only checked in the title |
| Python doctests were not recognised as tests in TheAlgorithms/Python | Added lines with `>>>`, `#[test]` or `#[cfg(test)]` count as tests |
| Five identical pull requests in one repository were not flagged because duplicates only compares open items | `mass_pr` also counts near-identical pull requests by the same author in the same repository |
| `Resolves #35700` was briefly flagged as a nonexistent issue; it is a Discussion | Numbers that 404 as issues are checked against Discussions before being reported |
| Sections marked "(optional)" and checklist-only sections counted as unfilled template | Both are skipped |

## Limits of this evaluation

- 30 pull requests from five repositories is a sanity check, not a benchmark. Precision and recall are not measured.
- It is retrospective. Pull requests were evaluated after the fact, so CI status, open-item lists and author activity reflect 2026-10-08, not the moment each was opened.
- None of the five repositories has an effortgate policy, so per-repository choices (approved issues, path rules, tighter size limits) were not exercised. The default policy is deliberately lenient.
- Issues were not part of this run.
