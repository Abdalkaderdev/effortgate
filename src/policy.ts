import { parse } from "yaml";
import { z } from "zod";

const weight = z.number().min(0).max(10);

const check = <T extends z.ZodRawShape>(shape: T, defaults: { weight: number; required?: boolean; enabled?: boolean }) =>
  z
    .object({
      enabled: z.boolean().default(defaults.enabled ?? true),
      weight: weight.default(defaults.weight),
      required: z.boolean().default(defaults.required ?? false),
      ...shape,
    })
    .strict()
    .prefault({} as never);

const outcomeActionBase = (labels: string[], closeAfterDays: number | null) =>
  z
    .object({
      labels: z.array(z.string()).default(labels),
      comment: z.boolean().default(true),
      draft: z.boolean().default(false),
      request_changes: z.boolean().default(false),
      close_after_days: z.number().int().positive().nullable().default(closeAfterDays),
    })
    .strict();

const outcomeAction = (labels: string[], closeAfterDays: number | null) =>
  outcomeActionBase(labels, closeAfterDays).prefault({});

const pathRule = z
  .object({
    match: z.array(z.string()).min(1),
    require_tests: z.boolean().optional(),
    require_linked_issue: z.boolean().optional(),
    first_time_max_lines: z.number().int().positive().optional(),
  })
  .strict();

export const policySchema = z
  .object({
    mode: z.enum(["dry-run", "enforce"]).default("dry-run"),
    trusted: z
      .object({
        users: z.array(z.string()).default([]),
        bots: z.boolean().default(true),
        associations: z.array(z.enum(["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR"])).default(["OWNER", "MEMBER", "COLLABORATOR"]),
        min_merged_prs: z.number().int().min(0).default(3),
      })
      .strict()
      .prefault({}),
    trivial: z
      .object({
        max_changed_lines: z.number().int().min(0).default(10),
        paths: z.array(z.string()).default(["**/*.md", "docs/**", ".github/**"]),
      })
      .strict()
      .prefault({}),
    pull_requests: z
      .object({
        enabled: z.boolean().default(true),
        linked_issue: check(
          { required_label: z.string().nullable().default(null), require_open: z.boolean().default(true) },
          { weight: 3, enabled: false },
        ),
        template: check(
          {
            sections: z.array(z.string()).default([]),
            min_chars: z.number().int().min(0).default(20),
          },
          { weight: 3 },
        ),
        description: check({ min_chars: z.number().int().min(0).default(40) }, { weight: 2, required: true }),
        tests: check(
          {
            source: z
              .array(z.string())
              .default(["**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,kts,rb,php,cs,c,cc,cpp,h,hpp,m,swift,scala,ex,exs,dart,lua,vue,svelte,zig,sh}"]),
            tests: z.array(z.string()).default(["**/test/**", "**/tests/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/test_*"]),
          },
          { weight: 2 },
        ),
        ci: check({ ignore: z.array(z.string()).default(["effortgate"]) }, { weight: 2 }),
        size: check({ first_time_max_lines: z.number().int().positive().default(500) }, { weight: 2 }),
        claims: check({}, { weight: 2 }),
        scope: check({}, { weight: 1 }),
        references: check({}, { weight: 2 }),
        duplicates: check({ threshold: z.number().min(0).max(1).default(0.6) }, { weight: 1 }),
        mass_pr: check(
          {
            window_days: z.number().int().positive().default(7),
            max_repos: z.number().int().positive().default(15),
          },
          { weight: 2 },
        ),
        account: check({ min_age_days: z.number().int().min(0).default(14) }, { weight: 1 }),
        paths: z.array(pathRule).default([]),
      })
      .strict()
      .prefault({}),
    issues: z
      .object({
        enabled: z.boolean().default(true),
        description: check({ min_chars: z.number().int().min(0).default(60) }, { weight: 2, required: true }),
        template: check({ min_chars: z.number().int().min(0).default(10) }, { weight: 2 }),
        bug_report: check(
          {
            labels: z.array(z.string()).default(["bug"]),
            title_pattern: z.string().default("\\b(bug|crash|error|broken|fails?|regression)\\b"),
          },
          { weight: 3, required: true },
        ),
        duplicates: check({ threshold: z.number().min(0).max(1).default(0.6) }, { weight: 1 }),
        account: check({ min_age_days: z.number().int().min(0).default(14) }, { weight: 1 }),
      })
      .strict()
      .prefault({}),
    llm: z
      .object({
        enabled: z.boolean().default(false),
        provider: z.enum(["anthropic", "openai"]).default("anthropic"),
        model: z.string().nullable().default(null),
        max_diff_chars: z.number().int().positive().default(20000),
      })
      .strict()
      .prefault({}),
    thresholds: z
      .object({
        pass: z.number().min(0).max(100).default(70),
        needs_info: z.number().min(0).max(100).default(40),
      })
      .strict()
      .refine((t) => t.needs_info <= t.pass, "needs_info must be <= pass")
      .prefault({}),
    actions: z
      .object({
        pass: outcomeActionBase([], null).prefault({ comment: false }),
        needs_info: outcomeAction(["effortgate:needs-info"], 14),
        low_effort: outcomeAction(["effortgate:low-effort"], 7),
      })
      .strict()
      .prefault({}),
    tone: z
      .object({
        greeting: z.string().default("Thanks for opening this, @{author}."),
        needs_info: z
          .string()
          .default("Before a maintainer reviews it, a few things are missing. Update the {kind} and this comment refreshes on its own."),
        low_effort: z
          .string()
          .default(
            "This {kind} doesn't yet show enough context for a maintainer to review it. The checklist below says exactly what would change that.",
          ),
        pass: z.string().default("Everything this project asks for is here. A maintainer will take it from here."),
        footer: z
          .string()
          .default("Checks are automated and based on this repository's policy. If one is wrong, say so in a reply and a maintainer will look."),
        close: z
          .string()
          .default("Closing for now since the checklist above hasn't been addressed in {days} days. Reopen any time once it is."),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type Policy = z.infer<typeof policySchema>;
export type PullPolicy = Policy["pull_requests"];
export type IssuePolicy = Policy["issues"];

export class PolicyError extends Error {}

export function parsePolicy(source: string | null, origin = ".github/effortgate.yml"): Policy {
  let raw: unknown = {};
  if (source?.trim()) {
    try {
      raw = parse(source) ?? {};
    } catch (e) {
      throw new PolicyError(`${origin}: invalid YAML: ${(e as Error).message}`);
    }
  }
  const result = policySchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new PolicyError(`${origin} is invalid:\n${lines.join("\n")}`);
  }
  return result.data;
}
