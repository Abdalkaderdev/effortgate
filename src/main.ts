import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { describe, execute, findComment, plan, planClose, type Action } from "./apply.js";
import type { Ctx } from "./gather.js";
import type { Policy } from "./policy.js";
import { PolicyError } from "./policy.js";
import { renderSummary } from "./render.js";
import { evaluate, loadPolicy, type LlmKeys } from "./run.js";
import type { Kind } from "./types.js";

interface Target {
  kind: Kind;
  number: number;
  authorActed: boolean;
}

async function targets(ctx: Ctx, p: Policy): Promise<{ list: Target[]; sweep: boolean }> {
  const payload = context.payload;
  const sender = payload.sender?.login as string | undefined;
  switch (context.eventName) {
    case "pull_request":
    case "pull_request_target": {
      const pr = payload.pull_request!;
      if (pr.state === "closed") return { list: [], sweep: false };
      return { list: [{ kind: "pull_request", number: pr.number, authorActed: sender === pr.user?.login }], sweep: false };
    }
    case "issues": {
      const issue = payload.issue!;
      if (issue.pull_request || issue.state === "closed") return { list: [], sweep: false };
      return { list: [{ kind: "issue", number: issue.number, authorActed: sender === issue.user?.login }], sweep: false };
    }
    case "issue_comment": {
      const issue = payload.issue!;
      if (sender !== issue.user?.login || issue.state !== "open") return { list: [], sweep: false };
      return { list: [{ kind: issue.pull_request ? "pull_request" : "issue", number: issue.number, authorActed: true }], sweep: false };
    }
    case "workflow_run": {
      const run = payload.workflow_run as { head_sha: string; pull_requests: { number: number }[] };
      let numbers = run.pull_requests.map((x) => x.number);
      if (numbers.length === 0) {
        const { data } = await ctx.octokit.rest.search.issuesAndPullRequests({ q: `repo:${ctx.owner}/${ctx.repo} is:pr is:open sha:${run.head_sha}`, advanced_search: "true" });
        numbers = data.items.map((i) => i.number);
      }
      return { list: numbers.map((n) => ({ kind: "pull_request" as const, number: n, authorActed: false })), sweep: false };
    }
    case "schedule":
    case "workflow_dispatch": {
      const labels = new Set([...p.actions.needs_info.labels, ...p.actions.low_effort.labels]);
      const seen = new Map<number, Target>();
      for (const label of labels) {
        const items = await ctx.octokit.paginate(ctx.octokit.rest.issues.listForRepo, { owner: ctx.owner, repo: ctx.repo, state: "open", labels: label, per_page: 100 });
        for (const i of items) seen.set(i.number, { kind: i.pull_request ? "pull_request" : "issue", number: i.number, authorActed: false });
      }
      return { list: [...seen.values()], sweep: true };
    }
    default:
      core.warning(`effortgate does nothing on ${context.eventName} events.`);
      return { list: [], sweep: false };
  }
}

export async function run(): Promise<void> {
  const token = core.getInput("github-token", { required: true });
  const { owner, repo } = context.repo;
  const ctx: Ctx = { octokit: getOctokit(token), owner, repo, searchBudget: { remaining: 8 }, log: (m) => core.info(m) };
  const policy = await loadPolicy(ctx, core.getInput("policy") || ".github/effortgate.yml");
  let mode = (core.getInput("mode") || policy.mode) as "dry-run" | "enforce";
  if (mode !== "dry-run" && mode !== "enforce") throw new PolicyError(`mode must be dry-run or enforce, got "${mode}"`);
  const pr = context.payload.pull_request;
  if (context.eventName === "pull_request" && pr && pr.head?.repo?.full_name !== pr.base?.repo?.full_name && mode === "enforce") {
    core.warning("pull_request events from forks get a read-only token. Running as dry-run; use pull_request_target to enforce.");
    mode = "dry-run";
  }
  const keys: LlmKeys = {
    anthropic: core.getInput("anthropic-api-key") || process.env.ANTHROPIC_API_KEY || undefined,
    openai: core.getInput("openai-api-key") || process.env.OPENAI_API_KEY || undefined,
  };

  const { list, sweep } = await targets(ctx, policy);
  const results: { number: number; outcome: string; score: number; actions: string[] }[] = [];
  const now = new Date();
  for (const t of list) {
    if (t.kind === "pull_request" ? !policy.pull_requests.enabled : !policy.issues.enabled) continue;
    const { subject, decision } = await evaluate(ctx, t.kind, t.number, policy, keys);
    const existing = await findComment(ctx, t.number);
    const { actions, state } = plan(decision, subject, policy, existing, now, t.authorActed);
    const all: Action[] = [...actions];
    if (sweep && !decision.trusted) {
      const close = planClose(state, policy, now, subject.author.login);
      if (close) all.push(close);
    }
    const described = all.map(describe);
    if (mode === "enforce") await execute(ctx, subject, all);
    const target = `${t.kind === "pull_request" ? "PR" : "issue"} #${t.number}`;
    core.info(`${target}: ${decision.outcome} (${decision.score}/100)${described.length ? `; ${mode === "enforce" ? "did" : "would"}: ${described.join(", ")}` : ""}`);
    await core.summary.addRaw(renderSummary(decision, target, mode, described)).write();
    results.push({ number: t.number, outcome: decision.outcome, score: decision.score, actions: described });
    if (list.length === 1) {
      core.setOutput("outcome", decision.outcome);
      core.setOutput("score", decision.score);
      core.setOutput("checks", JSON.stringify(decision.checks));
    }
  }
  core.setOutput("results", JSON.stringify(results));
}
