import nock from "nock";

export const API = "https://api.github.com";

const b64 = (s: string) => Buffer.from(s).toString("base64");

export const TEMPLATE = "## Summary\n\n<!-- What and why -->\n\n## Testing\n\n<!-- How you verified it -->\n";

export const pr = (over: Record<string, unknown> = {}) => ({
  number: 42,
  node_id: "PR_kwDOAAAB",
  state: "open",
  title: "Update utils.ts",
  body: TEMPLATE,
  draft: false,
  user: { login: "drive-by", type: "User" },
  author_association: "FIRST_TIME_CONTRIBUTOR",
  labels: [],
  created_at: "2026-10-07T10:00:00Z",
  head: { sha: "abc123", repo: { full_name: "drive-by/widget" } },
  base: { sha: "def456", repo: { full_name: "acme/widget" } },
  ...over,
});

export interface Recorded {
  method: string;
  path: string;
  body: string;
}

export function mockRepo(opts: { policy?: string | null; pr?: Record<string, unknown>; comments?: unknown[]; mergedCount?: number } = {}): Recorded[] {
  const log: Recorded[] = [];
  const scope = nock(API).persist();
  scope.on("request", (req: Request, _int: unknown, body: string) => log.push({ method: req.method, path: new URL(req.url).pathname, body: body ?? "" }));

  scope
    .get(/\/repos\/acme\/widget\/contents\/\.github(%2F|\/)effortgate\.yml/)
    .reply(opts.policy === null || opts.policy === undefined ? 404 : 200, opts.policy ? { type: "file", content: b64(opts.policy), encoding: "base64" } : { message: "Not Found" });
  scope.get(/\/repos\/acme\/widget\/contents\/CONTRIBUTING\.md/).reply(404, { message: "Not Found" });
  scope.get("/repos/acme/widget/pulls/42").reply(200, pr(opts.pr));
  scope.get("/users/drive-by").reply(200, { login: "drive-by", created_at: "2026-10-01T00:00:00Z" });
  scope
    .get("/search/issues")
    .query((q) => String(q.q).includes("is:merged"))
    .reply(200, { total_count: opts.mergedCount ?? 0, items: [] }, { "x-ratelimit-remaining": "29" });
  scope
    .get("/search/issues")
    .query((q) => String(q.q).startsWith("is:pr author:drive-by"))
    .reply(200, {
      total_count: 3,
      items: [
        { number: 42, title: "Update utils.ts", repository_url: `${API}/repos/acme/widget` },
        { number: 7, title: "Update utils.ts", repository_url: `${API}/repos/other/thing` },
        { number: 9, title: "Add retry helper", repository_url: `${API}/repos/third/lib` },
      ],
    });
  scope
    .get("/repos/acme/widget/pulls/42/files")
    .query(true)
    .reply(200, [
      { filename: "src/utils.ts", additions: 610, deletions: 40, status: "modified", patch: "@@ -1,3 +1,3 @@\n-export const x = 1\n+export const x = 2" },
      { filename: "package-lock.json", additions: 900, deletions: 100, status: "modified" },
    ]);
  scope.get(/\/repos\/acme\/widget\/contents\/\.github(\?|$)/).reply(200, [
    { name: "workflows", path: ".github/workflows", type: "dir" },
    { name: "PULL_REQUEST_TEMPLATE.md", path: ".github/PULL_REQUEST_TEMPLATE.md", type: "file" },
  ]);
  scope
    .get(/\/repos\/acme\/widget\/contents\/\.github(%2F|\/)PULL_REQUEST_TEMPLATE\.md/)
    .reply(200, { type: "file", content: b64(TEMPLATE), encoding: "base64" });
  scope.post("/graphql", (b: { query?: string } | undefined) => !!b?.query?.includes("closingIssuesReferences")).reply(200, {
    data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [] } } } },
  });
  scope.get("/repos/acme/widget/commits/abc123/check-runs").query(true).reply(200, {
    total_count: 2,
    check_runs: [
      { name: "test", status: "completed", conclusion: "failure" },
      { name: "effortgate", status: "in_progress", conclusion: null },
    ],
  });
  scope.get("/repos/acme/widget/commits/abc123/status").reply(200, { state: "success", statuses: [] });
  scope.get("/repos/acme/widget/pulls").query(true).reply(200, [{ number: 41, title: "Refactor date parsing", body: "" }]);
  scope.get("/repos/acme/widget/issues/42/comments").query(true).reply(200, opts.comments ?? []);
  return log;
}

export function mockWrites() {
  const sent: { comment?: string; labels?: string[] } = {};
  return {
    sent,
    labels: nock(API)
      .post("/repos/acme/widget/issues/42/labels", (b: { labels: string[] }) => ((sent.labels = b.labels), true))
      .reply(200, []),
    comment: nock(API)
      .post("/repos/acme/widget/issues/42/comments", (b: { body: string }) => ((sent.comment = b.body), true))
      .reply(201, { id: 1 }),
    draft: nock(API)
      .post("/graphql", (b: { query?: string } | undefined) => !!b?.query?.includes("convertPullRequestToDraft"))
      .reply(200, { data: { convertPullRequestToDraft: { clientMutationId: null } } }),
  };
}
