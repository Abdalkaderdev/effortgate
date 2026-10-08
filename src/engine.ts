import { checkIssue, checkPull } from "./checks.js";
import type { Policy } from "./policy.js";
import type { CheckResult, Decision, LlmReview, Outcome, Subject } from "./types.js";

const CREDIT = { pass: 1, warn: 0.5, fail: 0, skip: 0 } as const;
const PENALTY = { pass: 0, warn: 4, fail: 10, skip: 0 } as const;

export const RED_FLAGS = new Set(["claims", "scope", "references", "duplicates", "mass_pr", "account"]);

export function trustReason(s: Subject, p: Policy): string | null {
  const a = s.author;
  if (p.trusted.users.some((u) => u.toLowerCase() === a.login.toLowerCase())) return "listed in trusted.users";
  if (p.trusted.bots && a.isBot) return "bot account";
  if ((p.trusted.associations as string[]).includes(a.association)) return `repository ${a.association.toLowerCase()}`;
  if (p.trusted.min_merged_prs > 0 && (a.mergedPrs ?? 0) >= p.trusted.min_merged_prs) return `${a.mergedPrs} merged pull requests`;
  return null;
}

export function score(checks: CheckResult[]): number {
  const evidence = checks.filter((c) => !RED_FLAGS.has(c.id) && c.status !== "skip" && c.weight > 0);
  const total = evidence.reduce((n, c) => n + c.weight, 0);
  const base = total === 0 ? 100 : (100 * evidence.reduce((n, c) => n + c.weight * CREDIT[c.status], 0)) / total;
  const penalty = checks.filter((c) => RED_FLAGS.has(c.id)).reduce((n, c) => n + c.weight * PENALTY[c.status], 0);
  return Math.max(0, Math.min(100, Math.round(base - penalty)));
}

export function outcomeFor(checks: CheckResult[], value: number, p: Policy): Exclude<Outcome, "trusted"> {
  const blocking = checks.some((c) => c.status === "fail" && (c.required || RED_FLAGS.has(c.id)));
  if (value >= p.thresholds.pass && !blocking) return "pass";
  if (value >= p.thresholds.needs_info) return "needs_info";
  return "low_effort";
}

export function decide(s: Subject, p: Policy, llm: LlmReview | null = null): Decision {
  const reason = trustReason(s, p);
  const checks = s.kind === "pull_request" ? checkPull(s, p) : checkIssue(s, p);
  const value = score(checks);
  return {
    kind: s.kind,
    outcome: reason ? "trusted" : outcomeFor(checks, value, p),
    score: value,
    trusted: reason !== null,
    trustReason: reason,
    checks,
    llm,
  };
}
