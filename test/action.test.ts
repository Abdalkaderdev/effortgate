import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API, mockRepo, mockWrites, pr } from "./fixtures/github.js";

let dir: string;

function setEnv(event: string, payload: unknown, inputs: Record<string, string> = {}) {
  dir = mkdtempSync(join(tmpdir(), "effortgate-"));
  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify(payload));
  writeFileSync(join(dir, "summary.md"), "");
  writeFileSync(join(dir, "output"), "");
  const env: Record<string, string> = {
    GITHUB_EVENT_NAME: event,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "acme/widget",
    GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
    GITHUB_OUTPUT: join(dir, "output"),
    "INPUT_GITHUB-TOKEN": "test-token",
    ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v])),
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

async function runAction() {
  vi.resetModules();
  const { run } = await import("../src/main.js");
  await run();
}

const outputs = () => readFileSync(join(dir, "output"), "utf8");
const writes = (log: { method: string; path: string; body: string }[]) =>
  log.filter((r) => r.method !== "GET" && !(r.path === "/graphql" && !r.body.includes("mutation")));

beforeEach(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  vi.unstubAllEnvs();
});

describe("pull_request_target", () => {
  const payload = { action: "opened", pull_request: pr(), sender: { login: "drive-by" }, repository: { name: "widget", owner: { login: "acme" } } };

  it("dry-run reads only and reports in the job summary", async () => {
    const log = mockRepo();
    setEnv("pull_request_target", payload);
    await runAction();
    expect(writes(log)).toEqual([]);
    expect(outputs()).toContain("low_effort");
    const summary = readFileSync(join(dir, "summary.md"), "utf8");
    expect(summary).toContain("not taken, dry-run");
    expect(summary).toContain("add label `effortgate:low-effort`");
    expect(log.some((r) => r.path.includes("/check-runs"))).toBe(true);
  });

  it("enforce labels, comments and converts to draft", async () => {
    const log = mockRepo({ policy: "mode: enforce\nactions:\n  low_effort:\n    draft: true\n" });
    const w = mockWrites();
    setEnv("pull_request_target", payload);
    await runAction();
    expect(w.labels.isDone()).toBe(true);
    expect(w.comment.isDone()).toBe(true);
    expect(w.draft.isDone()).toBe(true);
    expect(w.sent.labels).toEqual(["effortgate:low-effort"]);
    expect(w.sent.comment).toContain("effortgate: needs more effort");
    expect(writes(log)).toEqual([]);
  });

  it("the mode input overrides the policy", async () => {
    const log = mockRepo({ policy: "mode: enforce\n" });
    setEnv("pull_request_target", payload, { mode: "dry-run" });
    await runAction();
    expect(writes(log)).toEqual([]);
  });

  it("never acts on trusted authors", async () => {
    const log = mockRepo({ policy: "mode: enforce\n", pr: { author_association: "MEMBER" } });
    setEnv("pull_request_target", { ...payload, pull_request: pr({ author_association: "MEMBER" }) });
    await runAction();
    expect(writes(log)).toEqual([]);
    expect(outputs()).toContain("trusted");
  });

  it("fails with a readable message on a bad policy", async () => {
    mockRepo({ policy: "thresholds:\n  pass: 200\n" });
    setEnv("pull_request_target", payload);
    await expect(runAction()).rejects.toThrow(/thresholds.pass/);
  });
});

describe("schedule", () => {
  it("closes items gated longer than close_after_days without a response", async () => {
    const marker = `<!-- effortgate:v1 ${JSON.stringify({ outcome: "low_effort", score: 5, since: "2026-01-01T00:00:00.000Z", failed: [] })} -->\nold`;
    const log = mockRepo({
      policy: "mode: enforce\n",
      pr: { labels: [{ name: "effortgate:low-effort" }] },
      comments: [{ id: 5, user: { type: "Bot" }, body: marker }],
    });
    nock(API)
      .get("/repos/acme/widget/issues")
      .query((q) => q.labels === "effortgate:low-effort")
      .reply(200, [{ number: 42, pull_request: {} }]);
    nock(API).get("/repos/acme/widget/issues").query((q) => q.labels === "effortgate:needs-info").reply(200, []);
    const closed = nock(API).patch("/repos/acme/widget/pulls/42", { state: "closed" }).reply(200, {});
    const comment = nock(API).post("/repos/acme/widget/issues/42/comments").reply(201, {});
    const update = nock(API).patch("/repos/acme/widget/issues/comments/5").reply(200, {});
    setEnv("schedule", { schedule: "0 6 * * *" });
    await runAction();
    expect(update.isDone()).toBe(true);
    expect(comment.isDone()).toBe(true);
    expect(closed.isDone()).toBe(true);
    expect(log.filter((r) => r.method === "GET").length).toBeGreaterThan(5);
  });
});

describe("issues", () => {
  it("ignores pull request comments from people other than the author", async () => {
    const log = mockRepo();
    setEnv("issue_comment", { action: "created", issue: { number: 42, state: "open", user: { login: "drive-by" }, pull_request: {} }, sender: { login: "someone" } });
    await runAction();
    expect(log.map((r) => r.path)).toEqual(["/repos/acme/widget/contents/.github%2Feffortgate.yml"]);
  });
});
