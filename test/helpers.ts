import { parsePolicy, type Policy } from "../src/policy.js";
import type { IssueSubject, PullSubject } from "../src/types.js";

export const PR_TEMPLATE = `## Summary

<!-- What does this change and why? -->

## Testing

<!-- How did you verify it? -->

## Checklist

- [ ] I added tests
- [ ] I updated the docs
`;

export function pull(over: Partial<PullSubject> = {}): PullSubject {
  return {
    kind: "pull_request",
    owner: "acme",
    repo: "widget",
    number: 42,
    nodeId: "PR_node",
    title: "fix(parser): handle empty input without crashing",
    body: `## Summary

The parser threw on an empty string because \`readToken()\` assumed at least one character. It now returns an empty AST.

## Testing

Added a regression test in test/parser.test.ts and ran the full suite locally.

## Checklist

- [x] I added tests
- [ ] I updated the docs
`,
    author: { login: "newcomer", isBot: false, association: "FIRST_TIME_CONTRIBUTOR", createdAt: "2020-01-01T00:00:00Z", mergedPrs: 0 },
    labels: [],
    createdAt: "2026-10-01T00:00:00Z",
    others: [],
    templates: [PR_TEMPLATE],
    draft: false,
    headSha: "head",
    baseSha: "base",
    files: [
      { path: "src/parser.ts", additions: 6, deletions: 2, status: "modified", patch: "@@ -1 +1 @@\n-function readToken(s) {\n+function readToken(s = '') {" },
      { path: "test/parser.test.ts", additions: 12, deletions: 0, status: "modified", patch: "+it('handles empty input')" },
    ],
    linkedIssues: [],
    missingRefs: [],
    ci: { state: "success", failing: [] },
    tree: new Set(["src/parser.ts", "test/parser.test.ts", "README.md"]),
    activity: { total: 1, otherRepos: 0, similarTitles: 0, sameRepoSimilar: 0 },
    ...over,
  };
}

export function issue(over: Partial<IssueSubject> = {}): IssueSubject {
  return {
    kind: "issue",
    owner: "acme",
    repo: "widget",
    number: 7,
    nodeId: "I_node",
    title: "Parser crashes on empty input",
    body: `### Steps to reproduce

1. Install widget 2.3.1
2. Call \`parse("")\`

### Version

2.3.1 on Node 24

### What happened

TypeError: Cannot read properties of undefined (reading 'kind'), thrown from readToken.
`,
    author: { login: "reporter", isBot: false, association: "NONE", createdAt: "2019-05-01T00:00:00Z", mergedPrs: 0 },
    labels: ["bug"],
    createdAt: "2026-10-01T00:00:00Z",
    others: [],
    templates: [],
    ...over,
  };
}

export function policy(yaml = ""): Policy {
  return parsePolicy(yaml);
}
