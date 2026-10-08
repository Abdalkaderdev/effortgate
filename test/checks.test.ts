import { describe, expect, it } from "vitest";
import { checkIssue, checkPull, pullFacts } from "../src/checks.js";
import type { CheckResult, FileChange } from "../src/types.js";
import { PR_TEMPLATE, issue, policy, pull } from "./helpers.js";

const by = (rs: CheckResult[], id: string) => {
  const r = rs.find((x) => x.id === id);
  if (!r) throw new Error(`no ${id}`);
  return r;
};
const file = (path: string, lines = 5, patch = ""): FileChange => ({ path, additions: lines, deletions: 0, status: "modified", patch });

describe("a well-prepared pull request", () => {
  it("passes or skips every check", () => {
    const rs = checkPull(pull(), policy());
    expect(rs.filter((r) => r.status === "fail" || r.status === "warn")).toEqual([]);
  });
});

describe("description", () => {
  it("fails when only the template is present", () => {
    const r = by(checkPull(pull({ body: PR_TEMPLATE }), policy()), "description");
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/No description/);
    expect(r.todo).toBeDefined();
  });
});

describe("template", () => {
  it("fails on the unedited template", () => {
    expect(by(checkPull(pull({ body: PR_TEMPLATE }), policy()), "template")).toMatchObject({ status: "fail", detail: "The description is the unedited template." });
  });
  it("warns when one section is still placeholder", () => {
    const body = pull().body.replace(/## Testing[\s\S]*?## Checklist/, "## Testing\n\n<!-- How did you verify it? -->\n\n## Checklist");
    const r = by(checkPull(pull({ body }), policy()), "template");
    expect(r.status).toBe("warn");
    expect(r.detail).toContain('"Testing"');
  });
  it("uses sections from the policy when given", () => {
    const r = by(checkPull(pull({ templates: [] }), policy("pull_requests:\n  template:\n    sections: [Motivation]")), "template");
    expect(r.status).toBe("fail");
  });
  it("skips when there is no template and no headings", () => {
    expect(by(checkPull(pull({ templates: [], body: "plain text ".repeat(10) }), policy()), "template").status).toBe("skip");
  });
});

describe("linked_issue", () => {
  const p = policy("pull_requests:\n  linked_issue:\n    enabled: true\n    required_label: approved");
  it("is off by default", () => {
    expect(by(checkPull(pull(), policy()), "linked_issue").status).toBe("skip");
  });
  it("fails without a link", () => {
    expect(by(checkPull(pull(), p), "linked_issue").status).toBe("fail");
  });
  it("fails when the issue lacks the approval label", () => {
    const r = by(checkPull(pull({ linkedIssues: [{ number: 3, title: "", body: "", state: "open", labels: [] }] }), p), "linked_issue");
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("approved");
  });
  it("passes with an approved open issue", () => {
    expect(by(checkPull(pull({ linkedIssues: [{ number: 3, title: "", body: "", state: "open", labels: ["approved"] }] }), p), "linked_issue").status).toBe("pass");
  });
  it("is not needed for trivial changes", () => {
    expect(by(checkPull(pull({ files: [file("README.md", 2)] }), p), "linked_issue").status).toBe("skip");
  });
  it("is forced by a path rule even when disabled", () => {
    const rule = policy("pull_requests:\n  paths:\n    - match: ['src/**']\n      require_linked_issue: true");
    expect(by(checkPull(pull(), rule), "linked_issue").status).toBe("fail");
  });
});

describe("tests", () => {
  it("fails when source changes without tests", () => {
    expect(by(checkPull(pull({ files: [file("src/parser.ts", 40)] }), policy()), "tests").status).toBe("fail");
  });
  it("accepts doctests and inline Rust tests as tests", () => {
    expect(by(checkPull(pull({ files: [file("algo/sort.py", 40, "+    >>> sort([2, 1])\n+    [1, 2]")] }), policy()), "tests").status).toBe("pass");
    expect(by(checkPull(pull({ files: [file("src/lib.rs", 40, "+#[cfg(test)]\n+mod tests {}")] }), policy()), "tests").status).toBe("pass");
    expect(by(checkPull(pull({ files: [file("src/lib.rs", 40, " #[test] unchanged context")] }), policy()), "tests").status).toBe("fail");
  });
  it("skips docs-only changes", () => {
    expect(by(checkPull(pull({ files: [file("docs/guide.md", 40)] }), policy()), "tests").status).toBe("skip");
  });
  it("skips trivial source changes unless a path rule demands tests", () => {
    expect(by(checkPull(pull({ files: [file("src/a.ts", 2)] }), policy()), "tests").status).toBe("skip");
    const rule = policy("pull_requests:\n  paths:\n    - match: ['src/core/**']\n      require_tests: true");
    expect(by(checkPull(pull({ files: [file("src/core/a.ts", 2)] }), rule), "tests").status).toBe("fail");
  });
});

describe("ci", () => {
  it("fails with failing checks and names them", () => {
    const r = by(checkPull(pull({ ci: { state: "failure", failing: ["lint", "test (24)"] } }), policy()), "ci");
    expect(r.status).toBe("fail");
    expect(r.todo).toContain("lint");
  });
  it("skips while pending or absent", () => {
    expect(by(checkPull(pull({ ci: { state: "pending", failing: [] } }), policy()), "ci").status).toBe("skip");
    expect(by(checkPull(pull({ ci: null }), policy()), "ci").status).toBe("skip");
  });
});

describe("size", () => {
  it("fails first-time contributors over the limit, ignoring lockfiles", () => {
    const files = [file("src/a.ts", 450), file("test/a.test.ts", 100), file("package-lock.json", 5000)];
    const r = by(checkPull(pull({ files }), policy()), "size");
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("550");
  });
  it("uses the tightest path rule", () => {
    const p = policy("pull_requests:\n  paths:\n    - match: ['src/core/**']\n      first_time_max_lines: 50");
    expect(by(checkPull(pull({ files: [file("src/core/a.ts", 60), file("test/a.test.ts", 1)] }), p), "size").status).toBe("fail");
  });
  it("does not apply to returning contributors", () => {
    const author = { ...pull().author, association: "CONTRIBUTOR", mergedPrs: 2 };
    expect(by(checkPull(pull({ author, files: [file("src/a.ts", 5000)] }), policy()), "size").status).toBe("skip");
  });
});

describe("claims", () => {
  it("fails when the description claims tests that are not in the diff", () => {
    const r = by(checkPull(pull({ files: [file("src/parser.ts", 20)] }), policy()), "claims");
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("tests");
  });
  it("ignores negated and unchecked claims", () => {
    const body = "This does not add tests because the change is a rename.\n\n- [ ] I added tests\n- [ ] I updated the docs";
    expect(by(checkPull(pull({ body, files: [file("src/parser.ts", 20)] }), policy()), "claims").status).toBe("pass");
  });
  it("fails on a docs claim with no docs change", () => {
    const body = "Updated the README with the new flag.";
    expect(by(checkPull(pull({ body }), policy()), "claims").status).toBe("fail");
  });
  it("warns when a 'typo fix' touches hundreds of lines", () => {
    const r = by(checkPull(pull({ title: "Fix typo in parser", body: "Keeps the workflow tiny.", files: [file("src/parser.ts", 300), file("test/p.test.ts", 1)] }), policy()), "claims");
    expect(r.status).toBe("warn");
  });
});

describe("scope", () => {
  it("warns on generic titles", () => {
    expect(by(checkPull(pull({ title: "Update parser.ts" }), policy()), "scope").status).toBe("warn");
  });
  it("warns when a docs: title touches code", () => {
    expect(by(checkPull(pull({ title: "docs: clarify parser behaviour" }), policy()), "scope").status).toBe("warn");
  });
  it("passes a consistent conventional title", () => {
    expect(by(checkPull(pull({ title: "docs: clarify parser behaviour", files: [file("docs/parser.md")] }), policy()), "scope").status).toBe("pass");
  });
});

describe("references", () => {
  it("fails when most named files exist nowhere", () => {
    const body = "Refactored src/tokenizer/lexer.ts and src/tokenizer/state.ts to share state with the parser.";
    const r = by(checkPull(pull({ body }), policy()), "references");
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("src/tokenizer/lexer.ts");
  });
  it("only warns on a single unknown path, and ignores build output", () => {
    expect(by(checkPull(pull({ body: "The generated .github/workflows/upgrade.yml calls src/parser.ts." }), policy()), "references").status).toBe("warn");
    expect(by(checkPull(pull({ body: "Loads dist/terminal.js lazily." }), policy()), "references").status).toBe("skip");
  });
  it("passes paths that exist in the repository", () => {
    expect(by(checkPull(pull({ body: "Touches README.md and src/parser.ts only." }), policy()), "references").status).toBe("pass");
  });
  it("warns on functions not present in the diff", () => {
    const r = by(checkPull(pull({ body: "Rewrote `normalizeAst()` for speed." }), policy()), "references");
    expect(r.status).toBe("warn");
  });
  it("fails on issue numbers that do not exist", () => {
    const r = by(checkPull(pull({ missingRefs: [35700] }), policy()), "references");
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("#35700");
  });
  it("does not fail when the tree is unavailable", () => {
    expect(by(checkPull(pull({ tree: null, body: "Changes src/nowhere/x.ts" }), policy()), "references").status).toBe("pass");
  });
});

describe("duplicates", () => {
  it("warns and links similar open items", () => {
    const others = [{ number: 40, title: "fix(parser): handle empty input without crash", body: "" }];
    const r = by(checkPull(pull({ others }), policy()), "duplicates");
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("#40");
  });
  it("skips when the list is unavailable", () => {
    expect(by(checkPull(pull({ others: null }), policy()), "duplicates").status).toBe("skip");
  });
});

describe("mass_pr", () => {
  it("fails a burst of near-identical PRs across many repos", () => {
    const r = by(checkPull(pull({ activity: { total: 60, otherRepos: 40, similarTitles: 30, sameRepoSimilar: 0 } }), policy()), "mass_pr");
    expect(r.status).toBe("fail");
  });
  it("fails repeated copies in the same repo", () => {
    expect(by(checkPull(pull({ activity: { total: 3, otherRepos: 0, similarTitles: 0, sameRepoSimilar: 2 } }), policy()), "mass_pr").status).toBe("fail");
  });
  it("only warns for prolific but varied authors", () => {
    expect(by(checkPull(pull({ activity: { total: 60, otherRepos: 40, similarTitles: 1, sameRepoSimilar: 0 } }), policy()), "mass_pr").status).toBe("warn");
  });
});

describe("account", () => {
  it("warns on new accounts but never fails", () => {
    const author = { ...pull().author, createdAt: "2026-09-28T00:00:00Z" };
    const r = by(checkPull(pull({ author }), policy()), "account");
    expect(r.status).toBe("warn");
    expect(r.todo).toBeUndefined();
  });
});

describe("pullFacts", () => {
  it("treats docs-only PRs as trivial", () => {
    expect(pullFacts(pull({ files: [file("docs/a.md", 500)] }), policy()).trivial).toBe(true);
  });
});

describe("issues", () => {
  it("passes a complete bug report", () => {
    expect(checkIssue(issue(), policy()).filter((r) => r.status === "fail" || r.status === "warn")).toEqual([]);
  });
  it("asks for reproduction steps and version", () => {
    const r = by(checkIssue(issue({ body: "It is broken when I use it with the thing, please fix this soon, thanks a lot!" }), policy()), "bug_report");
    expect(r.status).toBe("fail");
    expect(r.detail).toBe("Missing steps to reproduce and the version you're running.");
  });
  it("treats issue-form '_No response_' as empty", () => {
    const body = "### Steps to reproduce\n\n_No response_\n\n### Version\n\n_No response_\n\n### What happened\n\nThe parser crashes whenever it sees an empty string.";
    expect(by(checkIssue(issue({ body }), policy()), "bug_report").status).toBe("fail");
  });
  it("skips the bug check for feature requests", () => {
    expect(by(checkIssue(issue({ title: "Support YAML input", labels: ["enhancement"] }), policy()), "bug_report").status).toBe("skip");
  });
});
