import { writeFileSync } from "node:fs";
import { decide } from "../src/engine.js";
import { parsePolicy } from "../src/policy.js";
import { renderComment } from "../src/render.js";
import { PR_TEMPLATE, pull } from "../test/helpers.js";

const p = parsePolicy("pull_requests:\n  linked_issue:\n    enabled: true\n    required_label: approved\n");
const s = pull({
  title: "Add retry option to HTTP client",
  body: PR_TEMPLATE.replace(
    "<!-- What does this change and why? -->",
    "Adds a `retries` option to the HTTP client so transient 5xx responses are retried with backoff.",
  ),
  files: [{ path: "src/http/client.ts", additions: 184, deletions: 12, status: "modified", patch: "+  retries?: number" }],
  author: { login: "contributor", isBot: false, association: "FIRST_TIME_CONTRIBUTOR", createdAt: "2021-03-04T00:00:00Z", mergedPrs: 0 },
});
const d = decide(s, p);
writeFileSync(process.argv[2] ?? "comment.md", renderComment(d, p, "contributor", { outcome: d.outcome, score: d.score, since: "2026-10-08T00:00:00Z", failed: [] }));
console.log(d.outcome, d.score);
