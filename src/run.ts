import { decide } from "./engine.js";
import { gatherIssue, gatherPull, readPolicySource, type Ctx } from "./gather.js";
import { review } from "./llm.js";
import { parsePolicy, type Policy } from "./policy.js";
import type { Decision, Kind, Subject } from "./types.js";

export async function loadPolicy(ctx: Ctx, path: string): Promise<Policy> {
  return parsePolicy(await readPolicySource(ctx, path), path);
}

export interface LlmKeys {
  anthropic?: string;
  openai?: string;
}

export async function evaluate(
  ctx: Ctx,
  kind: Kind,
  number: number,
  policy: Policy,
  keys: LlmKeys = {},
): Promise<{ subject: Subject; decision: Decision }> {
  const subject = kind === "pull_request" ? await gatherPull(ctx, number, policy) : await gatherIssue(ctx, number, policy);
  let decision = decide(subject, policy);
  if (policy.llm.enabled && !decision.trusted) {
    try {
      const contributing = (await readPolicySource(ctx, "CONTRIBUTING.md")) ?? (await readPolicySource(ctx, ".github/CONTRIBUTING.md"));
      decision = { ...decision, llm: await review(subject, policy, contributing, keys) };
    } catch (e) {
      ctx.log?.(`LLM review skipped: ${(e as Error).message}`);
    }
  }
  return { subject, decision };
}
