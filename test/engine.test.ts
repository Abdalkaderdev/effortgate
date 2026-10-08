import { describe, expect, it } from "vitest";
import { decide, outcomeFor, score, trustReason } from "../src/engine.js";
import { PolicyError, parsePolicy } from "../src/policy.js";
import type { CheckResult } from "../src/types.js";
import { PR_TEMPLATE, issue, policy, pull } from "./helpers.js";

const c = (status: CheckResult["status"], weight = 1, required = false): CheckResult => ({ id: "x", title: "x", status, weight, required, detail: "" });

describe("score", () => {
  it("weights evidence pass 1, warn 0.5, fail 0 and ignores skips", () => {
    expect(score([c("pass", 3), c("fail", 1), c("skip", 10)])).toBe(75);
    expect(score([c("warn", 2), c("pass", 2)])).toBe(75);
  });
  it("deducts red flags without rewarding their absence", () => {
    const flag = (status: CheckResult["status"], weight: number) => ({ ...c(status, weight), id: "references" });
    expect(score([c("pass", 1), flag("pass", 2)])).toBe(100);
    expect(score([c("pass", 1), flag("fail", 2)])).toBe(80);
    expect(score([c("pass", 1), flag("warn", 2)])).toBe(92);
    expect(score([c("fail", 1), flag("fail", 2)])).toBe(0);
  });
  it("is 100 when nothing applies", () => {
    expect(score([c("skip")])).toBe(100);
  });
});

describe("outcome", () => {
  const p = policy();
  it("maps score to thresholds", () => {
    expect(outcomeFor([], 70, p)).toBe("pass");
    expect(outcomeFor([], 69, p)).toBe("needs_info");
    expect(outcomeFor([], 39, p)).toBe("low_effort");
  });
  it("never passes with a failed required check or a failed red flag", () => {
    expect(outcomeFor([c("fail", 1, true)], 95, p)).toBe("needs_info");
    expect(outcomeFor([{ ...c("fail"), id: "mass_pr" }], 80, p)).toBe("needs_info");
    expect(outcomeFor([{ ...c("warn"), id: "mass_pr" }], 80, p)).toBe("pass");
  });
});

describe("trust", () => {
  it("trusts listed users, bots, maintainers, and returning contributors", () => {
    const p = policy("trusted:\n  users: [Friend]");
    expect(trustReason(pull({ author: { ...pull().author, login: "friend" } }), p)).toBe("listed in trusted.users");
    expect(trustReason(pull({ author: { ...pull().author, login: "dependabot[bot]", isBot: true } }), p)).toBe("bot account");
    expect(trustReason(pull({ author: { ...pull().author, association: "MEMBER" } }), p)).toBe("repository member");
    expect(trustReason(pull({ author: { ...pull().author, association: "CONTRIBUTOR", mergedPrs: 3 } }), p)).toBe("3 merged pull requests");
    expect(trustReason(pull(), p)).toBeNull();
  });
  it("can turn bot trust off", () => {
    expect(trustReason(pull({ author: { ...pull().author, isBot: true } }), policy("trusted:\n  bots: false"))).toBeNull();
  });
});

describe("decide", () => {
  it("passes a good PR", () => {
    expect(decide(pull(), policy())).toMatchObject({ outcome: "pass", trusted: false });
  });
  it("flags a template-only PR from a newcomer as low effort", () => {
    const d = decide(pull({ title: "Update parser.ts", body: PR_TEMPLATE, files: [{ path: "src/parser.ts", additions: 700, deletions: 20, status: "modified", patch: "" }] }), policy());
    expect(d.outcome).toBe("low_effort");
    expect(d.score).toBeLessThan(40);
  });
  it("marks trusted authors trusted regardless of score", () => {
    const d = decide(pull({ body: "", author: { ...pull().author, association: "OWNER" } }), policy());
    expect(d.outcome).toBe("trusted");
  });
  it("handles issues", () => {
    expect(decide(issue(), policy()).outcome).toBe("pass");
    expect(decide(issue({ body: "broken" }), policy()).outcome).not.toBe("pass");
  });
});

describe("policy", () => {
  it("applies defaults for an empty file", () => {
    const p = parsePolicy(null);
    expect(p.mode).toBe("dry-run");
    expect(p.actions.needs_info.labels).toEqual(["effortgate:needs-info"]);
    expect(p.actions.pass.comment).toBe(false);
  });
  it("reports every problem with its path", () => {
    expect(() => parsePolicy("mode: yolo\npull_requests:\n  tests:\n    wieght: 2\n")).toThrowError(PolicyError);
    try {
      parsePolicy("mode: yolo\npull_requests:\n  tests:\n    wieght: 2\n");
    } catch (e) {
      expect((e as Error).message).toContain("mode:");
      expect((e as Error).message).toContain('pull_requests.tests: Unrecognized key: "wieght"');
    }
  });
  it("rejects invalid YAML", () => {
    expect(() => parsePolicy("mode: [")).toThrowError(/invalid YAML/);
  });
});
