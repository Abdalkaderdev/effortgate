import { findComment } from "./apply.js";
import type { Ctx } from "./gather.js";
import type { Policy } from "./policy.js";
import { readMarker } from "./render.js";
import { evaluate } from "./run.js";
import type { Kind, Outcome } from "./types.js";

export interface ReportRow {
  kind: Kind;
  number: number;
  title: string;
  state: string;
  outcome: Outcome;
  score: number;
  failed: string[];
  warned: string[];
  source: "comment" | "live";
}

export interface ReportOptions {
  days: number;
  limit: number;
  kinds: Kind[];
  live: boolean;
}

export async function collect(ctx: Ctx, policy: Policy, o: ReportOptions, onRow?: (r: ReportRow) => void): Promise<ReportRow[]> {
  const since = new Date(Date.now() - o.days * 86_400_000).toISOString();
  const items = [];
  for await (const page of ctx.octokit.paginate.iterator(ctx.octokit.rest.issues.listForRepo, {
    owner: ctx.owner,
    repo: ctx.repo,
    state: "all",
    since,
    sort: "created",
    direction: "desc",
    per_page: 100,
  })) {
    for (const i of page.data) {
      if (i.created_at < since) continue;
      const kind: Kind = i.pull_request ? "pull_request" : "issue";
      if (o.kinds.includes(kind)) items.push(i);
    }
    if (items.length >= o.limit || page.data.every((i) => i.created_at < since)) break;
  }
  const rows: ReportRow[] = [];
  for (const i of items.slice(0, o.limit)) {
    const kind: Kind = i.pull_request ? "pull_request" : "issue";
    const base = { kind, number: i.number, title: i.title, state: i.pull_request?.merged_at ? "merged" : i.state };
    const marker = readMarker((await findComment(ctx, i.number)).commentBody ?? "");
    let row: ReportRow | null = null;
    if (marker) row = { ...base, outcome: marker.outcome, score: marker.score, failed: marker.failed, warned: [], source: "comment" };
    else if (o.live) {
      try {
        const { decision } = await evaluate(ctx, kind, i.number, policy);
        row = {
          ...base,
          outcome: decision.outcome,
          score: decision.score,
          failed: decision.checks.filter((c) => c.status === "fail").map((c) => c.id),
          warned: decision.checks.filter((c) => c.status === "warn").map((c) => c.id),
          source: "live",
        };
      } catch (e) {
        ctx.log?.(`#${i.number}: ${(e as Error).message}`);
      }
    }
    if (row) {
      rows.push(row);
      onRow?.(row);
    }
  }
  return rows;
}

const ORDER: Outcome[] = ["pass", "needs_info", "low_effort", "trusted"];
const NAME: Record<Outcome, string> = { trusted: "trusted (skipped)", pass: "pass", needs_info: "needs info", low_effort: "low effort" };

function counts(rows: ReportRow[]) {
  const outcome = new Map<Outcome, number>(ORDER.map((o) => [o, 0]));
  const failed = new Map<string, number>();
  for (const r of rows) {
    outcome.set(r.outcome, (outcome.get(r.outcome) ?? 0) + 1);
    for (const f of r.failed) failed.set(f, (failed.get(f) ?? 0) + 1);
  }
  return { outcome, failed: [...failed.entries()].sort((a, b) => b[1] - a[1]) };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 70);

export function toMarkdown(repo: string, days: number, rows: ReportRow[]): string {
  const c = counts(rows);
  const gated = rows.filter((r) => r.outcome === "needs_info" || r.outcome === "low_effort").length;
  const lines = [
    `# effortgate report: ${repo}`,
    "",
    `Last ${days} days, ${rows.length} items, ${gated} gated.`,
    "",
    "| Outcome | Count |",
    "|---|---|",
    ...ORDER.map((o) => `| ${NAME[o]} | ${c.outcome.get(o)} |`),
  ];
  if (c.failed.length) lines.push("", "| Most failed check | Count |", "|---|---|", ...c.failed.map(([k, v]) => `| ${k} | ${v} |`));
  lines.push(
    "",
    "| # | Type | State | Title | Outcome | Score | Failed | Source |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.number} | ${r.kind === "pull_request" ? "PR" : "issue"} | ${r.state} | ${cell(r.title)} | ${NAME[r.outcome]} | ${r.outcome === "trusted" ? "" : r.score} | ${r.failed.join(", ")} | ${r.source} |`,
    ),
  );
  return lines.join("\n") + "\n";
}

const h = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export function toHtml(repo: string, days: number, rows: ReportRow[]): string {
  const c = counts(rows);
  const tr = (cells: string[], tag = "td") => `<tr>${cells.map((x) => `<${tag}>${x}</${tag}>`).join("")}</tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>effortgate report</title>
<style>
:root{color-scheme:light dark;--fg:#1f2328;--bg:#fff;--line:#d0d7de;--muted:#59636e}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--bg:#0d1117;--line:#30363d;--muted:#9198a1}}
body{font:14px/1.5 system-ui,sans-serif;color:var(--fg);background:var(--bg);max-width:1100px;margin:0 auto;padding:16px}
table{border-collapse:collapse;margin:12px 0;width:100%}td,th{border:1px solid var(--line);padding:4px 8px;text-align:left}
.muted{color:var(--muted)}.wrap{overflow-x:auto}
</style></head><body>
<h1>effortgate report: ${h(repo)}</h1>
<p class="muted">Last ${days} days, ${rows.length} items.</p>
<table>${tr(["Outcome", "Count"], "th")}${ORDER.map((o) => tr([NAME[o], String(c.outcome.get(o))])).join("")}</table>
${c.failed.length ? `<table>${tr(["Most failed check", "Count"], "th")}${c.failed.map(([k, v]) => tr([h(k), String(v)])).join("")}</table>` : ""}
<div class="wrap"><table>${tr(["#", "Type", "State", "Title", "Outcome", "Score", "Failed", "Source"], "th")}${rows
    .map((r) =>
      tr([
        `<a href="https://github.com/${h(repo)}/${r.kind === "pull_request" ? "pull" : "issues"}/${r.number}">${r.number}</a>`,
        r.kind === "pull_request" ? "PR" : "issue",
        r.state,
        h(r.title),
        NAME[r.outcome],
        r.outcome === "trusted" ? "" : String(r.score),
        h(r.failed.join(", ")),
        r.source,
      ]),
    )
    .join("")}</table></div>
</body></html>
`;
}
