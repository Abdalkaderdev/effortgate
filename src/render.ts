import type { Policy } from "./policy.js";
import type { CheckResult, Decision, Outcome } from "./types.js";

export const MARKER = "<!-- effortgate:v1";

export interface MarkerState {
  outcome: Outcome;
  score: number;
  since: string;
  failed: string[];
}

const ICON = { pass: "✅", warn: "⚠️", fail: "❌", skip: "➖" } as const;
const LABEL: Record<Outcome, string> = {
  trusted: "trusted",
  pass: "ready for review",
  needs_info: "needs info",
  low_effort: "needs more effort",
};

export function readMarker(body: string): MarkerState | null {
  const m = /<!-- effortgate:v1 (\{.*?\}) -->/.exec(body);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]) as MarkerState;
  } catch {
    return null;
  }
}

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (all, k: string) => vars[k] ?? all);

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function table(checks: CheckResult[]): string {
  const rows = checks.map((c) => `| ${ICON[c.status]} | ${c.title}${c.required ? " *" : ""} | ${esc(c.detail)} |`);
  return ["| | Check | Result |", "|---|---|---|", ...rows].join("\n");
}

function tally(checks: CheckResult[]): string {
  const n = (s: CheckResult["status"]) => checks.filter((c) => c.status === s).length;
  const parts = [`${n("pass")} passed`, `${n("fail")} failed`, `${n("warn")} to look at`];
  if (n("skip")) parts.push(`${n("skip")} not applicable`);
  return parts.join(", ");
}

export function renderComment(d: Decision, p: Policy, author: string, state: MarkerState): string {
  const kind = d.kind === "pull_request" ? "pull request" : "issue";
  const vars = { author, kind };
  const todo = d.checks.filter((c) => c.todo && (c.status === "fail" || c.status === "warn"));
  const intro = d.outcome === "pass" ? p.tone.pass : d.outcome === "low_effort" ? p.tone.low_effort : p.tone.needs_info;
  const lines = [
    `${MARKER} ${JSON.stringify(state)} -->`,
    `### effortgate: ${LABEL[d.outcome]} · effort score ${d.score}/100`,
    "",
    `${fill(p.tone.greeting, vars)} ${fill(intro, vars)}`,
  ];
  if (todo.length) {
    lines.push("", "**What would help**", "");
    for (const c of todo) lines.push(`- [ ] ${c.todo}${c.status === "warn" ? " _(suggested)_" : ""}`);
  }
  if (d.llm && d.llm.concerns.length) {
    lines.push("", `**Notes from an automated read of the guidelines** (advisory, ${d.llm.model})`, "");
    for (const c of d.llm.concerns.slice(0, 5)) lines.push(`- ${c}`);
  }
  lines.push("", `<details><summary>All checks: ${tally(d.checks)}</summary>`, "", table(d.checks), "", "\\* required by this repository's policy", "", "</details>");
  lines.push("", `<sub>${fill(p.tone.footer, vars)}</sub>`);
  return lines.join("\n");
}

export function renderSummary(d: Decision, target: string, mode: string, actions: string[]): string {
  const head = `## effortgate: ${target}\n\n**Outcome:** ${LABEL[d.outcome]} · **score** ${d.score}/100 · **mode** ${mode}`;
  const trust = d.trustReason ? `\n\nTrusted: ${d.trustReason}. No action taken.` : "";
  const acts = actions.length ? `\n\n**Actions${mode === "dry-run" ? " (not taken, dry-run)" : ""}:**\n${actions.map((a) => `- ${a}`).join("\n")}` : "";
  const llm = d.llm
    ? `\n\n**LLM review (${d.llm.provider}/${d.llm.model}, advisory):** ${d.llm.summary}${d.llm.concerns.map((c) => `\n- ${c}`).join("")}`
    : "";
  return `${head}${trust}${acts}\n\n${table(d.checks)}${llm}\n`;
}
