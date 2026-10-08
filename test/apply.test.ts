import { describe, expect, it } from "vitest";
import { describe as describeAction, plan, planClose } from "../src/apply.js";
import { decide } from "../src/engine.js";
import { renderComment } from "../src/render.js";
import { PR_TEMPLATE, policy, pull } from "./helpers.js";

const now = new Date("2026-10-08T00:00:00Z");
const none = { commentId: null, commentBody: null };
const bad = () => pull({ body: PR_TEMPLATE, title: "Update parser.ts", files: [{ path: "src/parser.ts", additions: 800, deletions: 0, status: "modified", patch: "" }] });

describe("plan", () => {
  it("labels, comments and drafts a newly gated PR", () => {
    const p = policy("actions:\n  low_effort:\n    draft: true\n    request_changes: true");
    const s = bad();
    const { actions, state } = plan(decide(s, p), s, p, none, now, true);
    expect(actions.map((a) => a.type)).toEqual(["add_labels", "comment", "draft", "request_changes"]);
    expect(state).toMatchObject({ outcome: "low_effort", since: now.toISOString() });
  });

  it("swaps labels when the outcome changes and keeps one sticky comment", () => {
    const p = policy();
    const s = pull({ labels: ["effortgate:low-effort", "bug"] });
    const prev = renderComment(decide(bad(), p), p, "x", { outcome: "low_effort", score: 10, since: "2026-10-01T00:00:00Z", failed: [] });
    const { actions } = plan(decide(s, p), s, p, { commentId: 9, commentBody: prev }, now, true);
    expect(actions).toContainEqual({ type: "remove_label", label: "effortgate:low-effort" });
    expect(actions.find((a) => a.type === "comment")).toMatchObject({ commentId: 9 });
    expect(actions.some((a) => a.type === "add_labels")).toBe(false);
  });

  it("posts nothing for a PR that passes on first sight", () => {
    const p = policy();
    expect(plan(decide(pull(), p), pull(), p, none, now, true).actions).toEqual([]);
  });

  it("does nothing for trusted authors except clearing stale labels", () => {
    const p = policy();
    const s = pull({ labels: ["effortgate:needs-info"], author: { ...pull().author, association: "MEMBER" } });
    expect(plan(decide(s, p), s, p, none, now, false).actions).toEqual([{ type: "remove_label", label: "effortgate:needs-info" }]);
  });

  it("keeps the clock running when the author has not responded", () => {
    const p = policy();
    const s = bad();
    const first = plan(decide(s, p), s, p, none, new Date("2026-10-01T00:00:00Z"), true);
    const body = (first.actions.find((a) => a.type === "comment") as { body: string }).body;
    const again = plan(decide(s, p), { ...s, labels: ["effortgate:low-effort"] }, p, { commentId: 1, commentBody: body }, now, false);
    expect(again.state?.since).toBe("2026-10-01T00:00:00.000Z");
    expect(again.actions).toEqual([]);
    const responded = plan(decide(s, p), s, p, { commentId: 1, commentBody: body }, now, true);
    expect(responded.state?.since).toBe(now.toISOString());
  });

  it("does not re-draft on every run", () => {
    const p = policy("actions:\n  low_effort:\n    draft: true");
    const s = bad();
    const body = (plan(decide(s, p), s, p, none, now, true).actions.find((a) => a.type === "comment") as { body: string }).body;
    expect(plan(decide(s, p), s, p, { commentId: 1, commentBody: body }, now, true).actions.some((a) => a.type === "draft")).toBe(false);
  });
});

describe("planClose", () => {
  const p = policy();
  it("closes after the configured days", () => {
    expect(planClose({ outcome: "low_effort", score: 10, since: "2026-09-30T00:00:00Z", failed: [] }, p, now, "x")?.type).toBe("close");
    expect(planClose({ outcome: "low_effort", score: 10, since: "2026-10-05T00:00:00Z", failed: [] }, p, now, "x")).toBeNull();
  });
  it("never closes passing items or when disabled", () => {
    expect(planClose({ outcome: "pass", score: 90, since: "2020-01-01T00:00:00Z", failed: [] }, p, now, "x")).toBeNull();
    const off = policy("actions:\n  low_effort:\n    close_after_days: null");
    expect(planClose({ outcome: "low_effort", score: 10, since: "2020-01-01T00:00:00Z", failed: [] }, off, now, "x")).toBeNull();
  });
  it("describes actions for the job summary", () => {
    expect(describeAction({ type: "add_labels", labels: ["a", "b"] })).toBe("add labels `a`, `b`");
  });
});
