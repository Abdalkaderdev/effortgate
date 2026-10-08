import { describe, expect, it } from "vitest";
import { decide } from "../src/engine.js";
import { readMarker, renderComment, renderSummary } from "../src/render.js";
import { PR_TEMPLATE, issue, policy, pull } from "./helpers.js";

const state = { outcome: "needs_info" as const, score: 0, since: "2026-10-01T00:00:00.000Z", failed: [] };

const lowEffort = () =>
  pull({
    title: "Update parser.ts",
    body: PR_TEMPLATE.replace("<!-- What does this change and why? -->", "Improved the parser and added tests. Also updated `src/lexer/scan.ts`."),
    files: [{ path: "src/parser.ts", additions: 640, deletions: 32, status: "modified", patch: "" }],
    ci: { state: "failure", failing: ["lint", "test (node 24)"] },
    others: [{ number: 38, title: "Update parser.ts", body: "" }],
  });

describe("comment", () => {
  it("renders a needs-work comment", async () => {
    const p = policy();
    const d = decide(lowEffort(), p);
    await expect(renderComment(d, p, "newcomer", { ...state, outcome: d.outcome as "low_effort", score: d.score })).toMatchFileSnapshot("__snapshots__/comment-low-effort.md");
  });
  it("renders a passing comment", async () => {
    const p = policy();
    const d = decide(pull(), p);
    await expect(renderComment(d, p, "newcomer", { ...state, outcome: "pass", score: d.score })).toMatchFileSnapshot("__snapshots__/comment-pass.md");
  });
  it("renders an issue comment", async () => {
    const p = policy();
    const d = decide(issue({ body: "Doesn't work on my machine. Please fix asap because I need this for work." }), p);
    await expect(renderComment(d, p, "reporter", { ...state, score: d.score })).toMatchFileSnapshot("__snapshots__/comment-issue.md");
  });
  it("uses tone templates from the policy", () => {
    const p = policy("tone:\n  greeting: 'Hi {author}!'\n  footer: 'Questions? Ask in #help.'");
    const body = renderComment(decide(lowEffort(), p), p, "sam", state);
    expect(body).toContain("Hi sam!");
    expect(body).toContain("<sub>Questions? Ask in #help.</sub>");
  });
  it("round-trips state through the hidden marker", () => {
    const p = policy();
    const body = renderComment(decide(lowEffort(), p), p, "sam", state);
    expect(readMarker(body)).toEqual(state);
    expect(readMarker("no marker")).toBeNull();
  });
  it("escapes table cells", () => {
    const p = policy();
    const d = decide(pull(), p);
    d.checks[0]!.detail = "a | b\nc";
    expect(renderComment(d, p, "x", state)).toContain("a \\| b c");
  });
});

describe("summary", () => {
  it("lists actions as not taken in dry-run", async () => {
    const d = decide(lowEffort(), policy());
    await expect(renderSummary(d, "PR #42", "dry-run", ["add label `effortgate:low-effort`", "post the effortgate comment"])).toMatchFileSnapshot(
      "__snapshots__/summary-dry-run.md",
    );
  });
});
