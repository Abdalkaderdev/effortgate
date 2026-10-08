import { getOctokit } from "@actions/github";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Ctx } from "./gather.js";
import { parsePolicy, PolicyError, type Policy } from "./policy.js";
import { renderComment, renderSummary } from "./render.js";
import { collect, toHtml, toMarkdown } from "./report.js";
import { evaluate, loadPolicy } from "./run.js";
import type { Kind } from "./types.js";

const USAGE = `effortgate: score pull requests and issues on effort and evidence. Read-only.

Usage:
  effortgate check  <owner/repo> <number> [--policy file] [--json] [--comment]
  effortgate report <owner/repo> [--days 30] [--limit 50] [--kind pr|issue|all]
                    [--format md|html|json] [--out file] [--no-live] [--policy file]

Token: GITHUB_TOKEN, GH_TOKEN, or \`gh auth token\`.
--policy reads a local file; otherwise .github/effortgate.yml from the repository, else defaults.
report reads effortgate comments where present and evaluates the rest live (dry-run).`;

function token(): string {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (t) return t;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new PolicyError("No token. Set GITHUB_TOKEN or log in with `gh auth login`.");
  }
}

function repoArg(s: string | undefined): [string, string] {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(s ?? "");
  if (!m) throw new PolicyError(`Expected owner/repo, got "${s ?? ""}".\n\n${USAGE}`);
  return [m[1]!, m[2]!];
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      policy: { type: "string" },
      json: { type: "boolean" },
      comment: { type: "boolean" },
      days: { type: "string", default: "30" },
      limit: { type: "string", default: "50" },
      kind: { type: "string", default: "pr" },
      format: { type: "string", default: "md" },
      out: { type: "string" },
      "no-live": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, repoName, num] = positionals;
  if (values.help || !cmd) {
    console.log(USAGE);
    return;
  }
  const [owner, repo] = repoArg(repoName);
  const ctx: Ctx = {
    octokit: getOctokit(token()),
    owner,
    repo,
    searchBudget: { remaining: 400, intervalMs: 2200 },
    cache: new Map(),
    log: (m) => console.error(`  ${m}`),
  };
  const policy: Policy = values.policy ? parsePolicy(readFileSync(values.policy, "utf8"), values.policy) : await loadPolicy(ctx, ".github/effortgate.yml");

  if (cmd === "check") {
    const n = Number(num);
    if (!Number.isInteger(n) || n <= 0) throw new PolicyError(`Expected an issue or PR number.\n\n${USAGE}`);
    const { data } = await ctx.octokit.rest.issues.get({ owner, repo, issue_number: n });
    const kind: Kind = data.pull_request ? "pull_request" : "issue";
    const { subject, decision } = await evaluate(ctx, kind, n, policy, { anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY });
    if (values.json) console.log(JSON.stringify(decision, null, 2));
    else if (values.comment)
      console.log(renderComment(decision, policy, subject.author.login, { outcome: decision.outcome, score: decision.score, since: new Date().toISOString(), failed: [] }));
    else console.log(renderSummary(decision, `${owner}/${repo}#${n}`, "dry-run", []));
    return;
  }

  if (cmd === "report") {
    const kinds: Kind[] = values.kind === "all" ? ["pull_request", "issue"] : values.kind === "issue" ? ["issue"] : ["pull_request"];
    const days = Number(values.days);
    const rows = await collect(ctx, policy, { days, limit: Number(values.limit), kinds, live: !values["no-live"] }, (r) =>
      console.error(`#${r.number} ${r.outcome} ${r.score}`),
    );
    const name = `${owner}/${repo}`;
    const out = values.format === "html" ? toHtml(name, days, rows) : values.format === "json" ? JSON.stringify(rows, null, 2) : toMarkdown(name, days, rows);
    if (values.out) writeFileSync(values.out, out);
    else console.log(out);
    return;
  }
  throw new PolicyError(`Unknown command "${cmd}".\n\n${USAGE}`);
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof PolicyError ? e.message : e);
  process.exit(1);
});
