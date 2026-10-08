import type { getOctokit } from "@actions/github";
import type { Policy } from "./policy.js";
import { issueRefs, jaccard, mentionedPaths, stripTemplate, words } from "./text.js";
import type { Author, AuthorActivity, CiState, IssueSubject, LinkedIssue, OtherItem, PullSubject } from "./types.js";

export type Octokit = ReturnType<typeof getOctokit>;

export interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  searchBudget: { remaining: number; intervalMs?: number; last?: number };
  cache?: Map<string, unknown>;
  log?: (msg: string) => void;
}

const TRUSTED_ASSOC = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

async function soft<T>(ctx: Ctx, what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    ctx.log?.(`${what} unavailable: ${(e as Error).message}`);
    return null;
  }
}

type SearchResult = Awaited<ReturnType<Octokit["rest"]["search"]["issuesAndPullRequests"]>>["data"];

async function search(ctx: Ctx, q: string, perPage = 1): Promise<SearchResult | null> {
  const key = `search:${perPage}:${q}`;
  if (ctx.cache?.has(key)) return ctx.cache.get(key) as SearchResult | null;
  const b = ctx.searchBudget;
  if (b.remaining <= 0) return null;
  b.remaining--;
  if (b.intervalMs && b.last) {
    const wait = b.last + b.intervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  b.last = Date.now();
  const out = await soft(ctx, `search "${q}"`, async () => {
    const res = await ctx.octokit.rest.search.issuesAndPullRequests({ q, per_page: perPage, advanced_search: "true" });
    const left = Number(res.headers["x-ratelimit-remaining"] ?? 1);
    if (left <= 2) b.remaining = 0;
    return res.data;
  });
  ctx.cache?.set(key, out);
  return out;
}

async function fileText(ctx: Ctx, path: string, ref?: string): Promise<string | null> {
  return soft(ctx, path, async () => {
    const { data } = await ctx.octokit.rest.repos.getContent({ owner: ctx.owner, repo: ctx.repo, path, ...(ref ? { ref } : {}) });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  });
}

async function listDir(ctx: Ctx, path: string): Promise<{ name: string; path: string; type: string }[]> {
  try {
    const { data } = await ctx.octokit.rest.repos.getContent({ owner: ctx.owner, repo: ctx.repo, path });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function readPolicySource(ctx: Ctx, path: string): Promise<string | null> {
  try {
    const { data } = await ctx.octokit.rest.repos.getContent({ owner: ctx.owner, repo: ctx.repo, path });
    if (Array.isArray(data) || !("content" in data)) return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

export async function pullTemplates(ctx: Ctx): Promise<string[]> {
  for (const dir of [".github", "", "docs"]) {
    const entry = (await listDir(ctx, dir)).find((e) => /^pull_request_template\.md$/i.test(e.name));
    if (entry) {
      const text = await fileText(ctx, entry.path);
      return text ? [text] : [];
    }
  }
  const multi = (await listDir(ctx, ".github/PULL_REQUEST_TEMPLATE")).filter((e) => e.name.endsWith(".md")).slice(0, 5);
  return (await Promise.all(multi.map((e) => fileText(ctx, e.path)))).filter((t): t is string => !!t);
}

export async function issueTemplates(ctx: Ctx): Promise<string[]> {
  const files = (await listDir(ctx, ".github/ISSUE_TEMPLATE")).filter((e) => /\.md$/i.test(e.name)).slice(0, 8);
  const texts = await Promise.all(files.map((e) => fileText(ctx, e.path)));
  return texts.filter((t): t is string => !!t).map((t) => t.replace(/^---[\s\S]*?---\s*/, ""));
}

async function author(ctx: Ctx, login: string, type: string, association: string, p: Policy): Promise<Author> {
  const isBot = type === "Bot" || login.endsWith("[bot]");
  const a: Author = { login, isBot, association, createdAt: null, mergedPrs: null };
  if (isBot || TRUSTED_ASSOC.has(association)) return a;
  const user = await soft(ctx, "user", () => ctx.octokit.rest.users.getByUsername({ username: login }));
  a.createdAt = user?.data.created_at ?? null;
  if (p.trusted.min_merged_prs > 0 || p.pull_requests.size.enabled) {
    const r = await search(ctx, `repo:${ctx.owner}/${ctx.repo} is:pr is:merged author:${login}`);
    a.mergedPrs = r?.total_count ?? null;
  }
  return a;
}

async function openItems(ctx: Ctx, kind: "pr" | "issue", self: number): Promise<OtherItem[] | null> {
  return soft(ctx, "open items", async () => {
    if (kind === "pr") {
      const { data } = await ctx.octokit.rest.pulls.list({ owner: ctx.owner, repo: ctx.repo, state: "open", per_page: 100 });
      return data.filter((d) => d.number !== self).map((d) => ({ number: d.number, title: d.title, body: d.body ?? "" }));
    }
    const { data } = await ctx.octokit.rest.issues.listForRepo({ owner: ctx.owner, repo: ctx.repo, state: "open", per_page: 100 });
    return data.filter((d) => !d.pull_request && d.number !== self).map((d) => ({ number: d.number, title: d.title, body: d.body ?? "" }));
  });
}

async function ci(ctx: Ctx, sha: string, ignore: string[]): Promise<CiState | null> {
  return soft(ctx, "ci", async () => {
    const skipName = (n: string) => ignore.some((i) => n.toLowerCase().includes(i.toLowerCase()));
    const [{ data: runs }, { data: combined }] = await Promise.all([
      ctx.octokit.rest.checks.listForRef({ owner: ctx.owner, repo: ctx.repo, ref: sha, per_page: 100 }),
      ctx.octokit.rest.repos.getCombinedStatusForRef({ owner: ctx.owner, repo: ctx.repo, ref: sha }),
    ]);
    const checks = runs.check_runs.filter((r) => !skipName(r.name));
    const statuses = combined.statuses.filter((s) => !skipName(s.context));
    const failing = [
      ...checks.filter((r) => r.status === "completed" && ["failure", "timed_out", "cancelled", "action_required"].includes(r.conclusion ?? "")).map((r) => r.name),
      ...statuses.filter((s) => s.state === "failure" || s.state === "error").map((s) => s.context),
    ];
    const pending = checks.some((r) => r.status !== "completed") || statuses.some((s) => s.state === "pending");
    const state = failing.length ? "failure" : pending ? "pending" : checks.length + statuses.length ? "success" : "none";
    return { state, failing };
  });
}

async function linked(ctx: Ctx, number: number, body: string): Promise<{ issues: LinkedIssue[]; missing: number[] }> {
  const nums = new Set(issueRefs(body, ctx.owner, ctx.repo));
  const gql = await soft(ctx, "closing references", () =>
    ctx.octokit.graphql<{ repository: { pullRequest: { closingIssuesReferences: { nodes: { number: number }[] } } } }>(
      `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){closingIssuesReferences(first:10){nodes{number}}}}}`,
      { o: ctx.owner, r: ctx.repo, n: number },
    ),
  );
  for (const n of gql?.repository.pullRequest.closingIssuesReferences.nodes ?? []) nums.add(n.number);
  const out: LinkedIssue[] = [];
  const missing: number[] = [];
  for (const n of [...nums].slice(0, 5)) {
    let notFound = false;
    const res = await ctx.octokit.rest.issues.get({ owner: ctx.owner, repo: ctx.repo, issue_number: n }).catch((e: { status?: number; message?: string }) => {
      notFound = e.status === 404 || e.status === 410;
      if (!notFound) ctx.log?.(`issue #${n} unavailable: ${e.message}`);
      return null;
    });
    if (notFound) {
      const d = await soft(ctx, `discussion #${n}`, () =>
        ctx.octokit.graphql<{ repository: { discussion: { id: string } | null } }>(
          `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){discussion(number:$n){id}}}`,
          { o: ctx.owner, r: ctx.repo, n },
        ),
      );
      if (d && !d.repository.discussion) missing.push(n);
    }
    if (!res || res.data.pull_request) continue;
    out.push({
      number: n,
      title: res.data.title,
      body: res.data.body ?? "",
      state: res.data.state,
      labels: res.data.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
    });
  }
  return { issues: out, missing };
}

async function activity(ctx: Ctx, login: string, number: number, title: string, days: number): Promise<AuthorActivity | null> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const r = await search(ctx, `is:pr author:${login} created:>=${since}`, 100);
  if (!r) return null;
  const own = words(title);
  const repos = new Set<string>();
  let similar = 0;
  let sameRepo = 0;
  for (const item of r.items) {
    const repo = (item.repository_url.split("/repos/")[1] ?? "").toLowerCase();
    const alike = jaccard(own, words(item.title)) >= 0.6;
    if (repo === `${ctx.owner}/${ctx.repo}`.toLowerCase()) {
      if (alike && item.number !== number) sameRepo++;
      continue;
    }
    repos.add(repo);
    if (alike) similar++;
  }
  return { total: r.total_count, otherRepos: repos.size, similarTitles: similar, sameRepoSimilar: sameRepo };
}

async function tree(ctx: Ctx, sha: string): Promise<Set<string> | null> {
  return soft(ctx, "tree", async () => {
    const { data } = await ctx.octokit.rest.git.getTree({ owner: ctx.owner, repo: ctx.repo, tree_sha: sha, recursive: "true" });
    if (data.truncated) return null;
    return new Set(data.tree.filter((t) => t.path).map((t) => t.path!));
  });
}

export async function gatherPull(ctx: Ctx, number: number, p: Policy): Promise<PullSubject> {
  const { data: pr } = await ctx.octokit.rest.pulls.get({ owner: ctx.owner, repo: ctx.repo, pull_number: number });
  const body = pr.body ?? "";
  const pp = p.pull_requests;
  const a = await author(ctx, pr.user?.login ?? "ghost", pr.user?.type ?? "User", pr.author_association, p);
  const fullCheck = !a.isBot && !TRUSTED_ASSOC.has(a.association);
  const files = await ctx.octokit.paginate(ctx.octokit.rest.pulls.listFiles, { owner: ctx.owner, repo: ctx.repo, pull_number: number, per_page: 100 });
  const templates = await pullTemplates(ctx);
  const needsTree = pp.references.enabled && mentionedPaths(stripTemplate(body, templates)).length > 0;
  const [links, ciState, others, treeSet, act] = await Promise.all([
    linked(ctx, number, body),
    pp.ci.enabled ? ci(ctx, pr.head.sha, pp.ci.ignore) : Promise.resolve(null),
    pp.duplicates.enabled ? openItems(ctx, "pr", number) : Promise.resolve(null),
    needsTree ? tree(ctx, pr.base.sha) : Promise.resolve(null),
    pp.mass_pr.enabled && fullCheck ? activity(ctx, a.login, number, pr.title, pp.mass_pr.window_days) : Promise.resolve(null),
  ]);
  return {
    kind: "pull_request",
    owner: ctx.owner,
    repo: ctx.repo,
    number,
    nodeId: pr.node_id,
    title: pr.title,
    body,
    author: a,
    labels: pr.labels.map((l) => l.name ?? ""),
    createdAt: pr.created_at,
    draft: pr.draft ?? false,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    files: files.map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions, status: f.status, patch: f.patch ?? null })),
    linkedIssues: links.issues,
    missingRefs: links.missing,
    ci: ciState,
    others,
    tree: treeSet,
    activity: act,
    templates,
  };
}

export async function gatherIssue(ctx: Ctx, number: number, p: Policy): Promise<IssueSubject> {
  const { data: issue } = await ctx.octokit.rest.issues.get({ owner: ctx.owner, repo: ctx.repo, issue_number: number });
  const [a, others, templates] = await Promise.all([
    author(ctx, issue.user?.login ?? "ghost", issue.user?.type ?? "User", issue.author_association ?? "NONE", p),
    p.issues.duplicates.enabled ? openItems(ctx, "issue", number) : Promise.resolve(null),
    issueTemplates(ctx),
  ]);
  return {
    kind: "issue",
    owner: ctx.owner,
    repo: ctx.repo,
    number,
    nodeId: issue.node_id,
    title: issue.title,
    body: issue.body ?? "",
    author: a,
    labels: issue.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
    createdAt: issue.created_at,
    others,
    templates,
  };
}
