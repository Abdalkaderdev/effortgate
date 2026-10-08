import type { Ctx } from "./gather.js";
import type { Policy } from "./policy.js";
import { MARKER, readMarker, renderComment, type MarkerState } from "./render.js";
import type { Decision, Subject } from "./types.js";

export type Action =
  | { type: "add_labels"; labels: string[] }
  | { type: "remove_label"; label: string }
  | { type: "comment"; body: string; commentId: number | null }
  | { type: "draft" }
  | { type: "request_changes"; body: string }
  | { type: "close"; body: string };

export interface Existing {
  commentId: number | null;
  commentBody: string | null;
}

export function describe(a: Action): string {
  switch (a.type) {
    case "add_labels":
      return `add label${a.labels.length > 1 ? "s" : ""} ${a.labels.map((l) => `\`${l}\``).join(", ")}`;
    case "remove_label":
      return `remove label \`${a.label}\``;
    case "comment":
      return a.commentId ? "update the effortgate comment" : "post the effortgate comment";
    case "draft":
      return "convert to draft";
    case "request_changes":
      return "submit a review requesting changes";
    case "close":
      return "close with a comment";
  }
}

function allLabels(p: Policy): Set<string> {
  return new Set([...p.actions.pass.labels, ...p.actions.needs_info.labels, ...p.actions.low_effort.labels]);
}

export function plan(
  d: Decision,
  s: Subject,
  p: Policy,
  existing: Existing,
  now: Date,
  authorActed: boolean,
): { actions: Action[]; state: MarkerState | null } {
  const actions: Action[] = [];
  const managed = allLabels(p);
  if (d.outcome === "trusted") {
    for (const l of s.labels) if (managed.has(l)) actions.push({ type: "remove_label", label: l });
    return { actions, state: null };
  }
  const cfg = p.actions[d.outcome];
  const prev = existing.commentBody ? readMarker(existing.commentBody) : null;
  const transition = prev?.outcome !== d.outcome;
  const state: MarkerState = {
    outcome: d.outcome,
    score: d.score,
    since: prev && !transition && !authorActed ? prev.since : now.toISOString(),
    failed: d.checks.filter((c) => c.status === "fail").map((c) => c.id),
  };
  for (const l of s.labels) if (managed.has(l) && !cfg.labels.includes(l)) actions.push({ type: "remove_label", label: l });
  const add = cfg.labels.filter((l) => !s.labels.includes(l));
  if (add.length) actions.push({ type: "add_labels", labels: add });
  if (cfg.comment || existing.commentId) {
    const body = renderComment(d, p, s.author.login, state);
    const strip = (b: string) => b.replace(/<!-- effortgate:v1 .*? -->/, "");
    if (!existing.commentBody || strip(existing.commentBody) !== strip(body) || prev?.since !== state.since)
      actions.push({ type: "comment", body, commentId: existing.commentId });
  }
  if (s.kind === "pull_request" && transition) {
    if (cfg.draft && !s.draft) actions.push({ type: "draft" });
    if (cfg.request_changes)
      actions.push({ type: "request_changes", body: "effortgate: see the checklist in the comment above before this is reviewed." });
  }
  return { actions, state };
}

export function planClose(state: MarkerState | null, p: Policy, now: Date, author: string): Action | null {
  if (!state || state.outcome === "pass" || state.outcome === "trusted") return null;
  const days = p.actions[state.outcome].close_after_days;
  if (!days) return null;
  if (now.getTime() - Date.parse(state.since) < days * 86_400_000) return null;
  return { type: "close", body: p.tone.close.replace("{days}", String(days)).replace("{author}", author) };
}

export async function findComment(ctx: Ctx, number: number): Promise<Existing> {
  const comments = await ctx.octokit.paginate(ctx.octokit.rest.issues.listComments, {
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: number,
    per_page: 100,
  });
  const c = comments.find((x) => x.user?.type === "Bot" && x.body?.startsWith(MARKER));
  return { commentId: c?.id ?? null, commentBody: c?.body ?? null };
}

export async function execute(ctx: Ctx, s: Subject, actions: Action[]): Promise<void> {
  const base = { owner: ctx.owner, repo: ctx.repo };
  for (const a of actions) {
    switch (a.type) {
      case "add_labels":
        await ctx.octokit.rest.issues.addLabels({ ...base, issue_number: s.number, labels: a.labels });
        break;
      case "remove_label":
        await ctx.octokit.rest.issues.removeLabel({ ...base, issue_number: s.number, name: a.label }).catch(() => undefined);
        break;
      case "comment":
        if (a.commentId) await ctx.octokit.rest.issues.updateComment({ ...base, comment_id: a.commentId, body: a.body });
        else await ctx.octokit.rest.issues.createComment({ ...base, issue_number: s.number, body: a.body });
        break;
      case "draft":
        await ctx.octokit.graphql(`mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){clientMutationId}}`, { id: s.nodeId });
        break;
      case "request_changes":
        await ctx.octokit.rest.pulls.createReview({ ...base, pull_number: s.number, event: "REQUEST_CHANGES", body: a.body });
        break;
      case "close":
        await ctx.octokit.rest.issues.createComment({ ...base, issue_number: s.number, body: a.body });
        if (s.kind === "pull_request") await ctx.octokit.rest.pulls.update({ ...base, pull_number: s.number, state: "closed" });
        else await ctx.octokit.rest.issues.update({ ...base, issue_number: s.number, state: "closed", state_reason: "not_planned" });
        break;
    }
  }
}
