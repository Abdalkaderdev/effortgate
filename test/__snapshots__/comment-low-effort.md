<!-- effortgate:v1 {"outcome":"low_effort","score":0,"since":"2026-10-01T00:00:00.000Z","failed":[]} -->
### effortgate: needs more effort · effort score 0/100

Thanks for opening this, @newcomer. This pull request doesn't yet show enough context for a maintainer to review it. The checklist below says exactly what would change that.

**What would help**

- [ ] Fill in "Testing" in the pull request description with details specific to this change. _(suggested)_
- [ ] Add or update tests that cover this change, or explain in the description why none are needed.
- [ ] Fix the failing checks (lint, test (node 24)) before review is requested.
- [ ] Split this into smaller pull requests of at most 500 changed lines, or open an issue to agree on the approach first.
- [ ] Push the tests the description mentions, or correct the description.
- [ ] Rename the pull request so the title says what it changes and why, e.g. `fix(parser): handle empty input`. _(suggested)_
- [ ] Correct the file names in the description so they match what this pull request actually changes. _(suggested)_
- [ ] Check whether #38 already covers this. If it does, comment there instead; if not, say how this differs. _(suggested)_

<details><summary>All checks: 3 passed, 4 failed, 4 to look at, 1 not applicable</summary>

| | Check | Result |
|---|---|---|
| ✅ | Describes the change * | 70 characters of description beyond the template. |
| ⚠️ | Template filled in | 1 section missing or left as template text: "Testing". |
| ➖ | Linked issue | Not required by policy. |
| ❌ | Tests updated | Source files changed but no test files did. |
| ❌ | CI passing | Failing: lint, test (node 24). |
| ❌ | Reviewable size | 672 changed lines; first contributions here are capped at 500. |
| ❌ | Description matches the diff | The description says tests were added, but no test files changed. |
| ⚠️ | Title matches the files | Title "Update parser.ts" doesn't say what changed. |
| ⚠️ | References exist | Description mentions `src/lexer/scan.ts`, which doesn't exist in this repository or diff. |
| ⚠️ | Not a duplicate | Similar to open #38. |
| ✅ | Not part of a mass submission | 1 pull request by this author in 7 days. |
| ✅ | Contributor history | Account is 2465 days old, 0 merged PRs here. |

\* required by this repository's policy

</details>

<sub>Checks are automated and based on this repository's policy. If one is wrong, say so in a reply and a maintainer will look.</sub>