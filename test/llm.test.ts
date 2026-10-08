import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decide } from "../src/engine.js";
import { buildPrompt, review } from "../src/llm.js";
import { renderComment } from "../src/render.js";
import { policy, pull } from "./helpers.js";

const verdict = { follows_guidelines: false, addresses_linked_issue: null, concerns: ["CONTRIBUTING.md asks for a changelog entry; none was added."], summary: "Fix lacks a changelog entry." };

beforeEach(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

describe("prompt", () => {
  it("wraps untrusted content and says when the diff was shortened", () => {
    const s = pull({ files: [{ path: "src/a.ts", additions: 1, deletions: 0, status: "added", patch: "x".repeat(500) }] });
    const prompt = buildPrompt(s, "Add a changelog entry.", 100);
    expect(prompt).toContain("<guidelines>\nAdd a changelog entry.\n</guidelines>");
    expect(prompt).toContain('<contribution type="pull request">');
    expect(prompt).toMatch(/diff shortened from \d+ to 100 characters/);
  });
});

describe("review", () => {
  it("parses structured output from Anthropic", async () => {
    let sent: { model: string; output_config: { format: { type: string } } } | undefined;
    nock("https://api.anthropic.com")
      .post("/v1/messages", (b) => ((sent = b), true))
      .reply(200, {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(verdict) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    const r = await review(pull(), policy("llm:\n  enabled: true"), null, { anthropic: "key" });
    expect(sent?.model).toBe("claude-opus-5-5");
    expect(sent?.output_config.format.type).toBe("json_schema");
    expect(r).toMatchObject({ provider: "anthropic", followsGuidelines: false, concerns: verdict.concerns });
  });

  it("parses structured output from OpenAI", async () => {
    nock("https://api.openai.com")
      .post("/v1/chat/completions", (b: { response_format: { type: string } }) => b.response_format.type === "json_schema")
      .reply(200, { choices: [{ message: { content: JSON.stringify(verdict) } }] });
    const r = await review(pull(), policy("llm:\n  enabled: true\n  provider: openai\n  model: some-model"), null, { openai: "key" });
    expect(r).toMatchObject({ provider: "openai", model: "some-model", summary: verdict.summary });
  });

  it("requires a key and, for OpenAI, a model", async () => {
    await expect(review(pull(), policy("llm:\n  enabled: true"), null, {})).rejects.toThrow(/anthropic-api-key/);
    await expect(review(pull(), policy("llm:\n  enabled: true\n  provider: openai"), null, { openai: "k" })).rejects.toThrow(/llm.model/);
  });

  it("is advisory: concerns show in the comment but do not change the outcome", () => {
    const p = policy();
    const plain = decide(pull(), p);
    const withLlm = decide(pull(), p, { provider: "anthropic", model: "m", followsGuidelines: false, addressesIssue: null, concerns: verdict.concerns, summary: "" });
    expect(withLlm.outcome).toBe(plain.outcome);
    expect(withLlm.score).toBe(plain.score);
    expect(renderComment(withLlm, p, "x", { outcome: "pass", score: 100, since: "2026-10-01T00:00:00Z", failed: [] })).toContain("changelog entry");
  });
});
