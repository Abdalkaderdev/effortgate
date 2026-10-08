import picomatch from "picomatch";
import type { IssuePolicy, PullPolicy, Policy } from "./policy.js";
import {
  headingKey,
  mentionedPaths,
  mentionedSymbols,
  realText,
  sections,
  similarity,
  stripComments,
  stripTemplate,
  templateLineSet,
} from "./text.js";
import type { CheckResult, IssueSubject, PullSubject, Status, Subject } from "./types.js";

type Conf = { enabled: boolean; weight: number; required: boolean };

const GENERATED = picomatch(["**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml", "**/Cargo.lock", "**/go.sum", "**/poetry.lock", "**/uv.lock", "**/*.snap", "**/dist/**", "**/*.min.js"], { dot: true });
const DOCS = picomatch(["**/*.md", "**/*.mdx", "**/*.rst", "**/*.txt", "docs/**", "doc/**", "**/LICENSE*"], { dot: true, nocase: true });
const INLINE_TEST = /^\+\s*(>>> |#\[test\]|#\[cfg\(test\)\])/m;
const FIRST_TIME = new Set(["FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE", "MANNEQUIN"]);

const result = (
  id: string,
  title: string,
  conf: Conf,
  status: Status,
  detail: string,
  todo?: string,
): CheckResult => ({ id, title, status, weight: conf.weight, required: conf.required, detail, ...(todo && status !== "pass" ? { todo } : {}) });

const skip = (id: string, title: string, conf: Conf, detail: string) => result(id, title, conf, "skip", detail);

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function isFirstTime(s: Subject): boolean {
  return FIRST_TIME.has(s.author.association) && (s.author.mergedPrs ?? 0) === 0;
}

export interface PullFacts {
  lines: number;
  trivial: boolean;
  testsTouched: boolean;
  sourceTouched: boolean;
  docsOnly: boolean;
  forceTests: boolean;
  forceIssue: boolean;
  maxLines: number;
}

export function pullFacts(s: PullSubject, p: Policy): PullFacts {
  const pr = p.pull_requests;
  const counted = s.files.filter((f) => !GENERATED(f.path));
  const lines = counted.reduce((n, f) => n + f.additions + f.deletions, 0);
  const trivialPath = picomatch(p.trivial.paths, { dot: true });
  const isTest = picomatch(pr.tests.tests, { dot: true });
  const isSource = picomatch(pr.tests.source, { dot: true });
  const rules = pr.paths.filter((r) => s.files.some((f) => picomatch(r.match, { dot: true })(f.path)));
  return {
    lines,
    trivial: s.files.length > 0 && (lines <= p.trivial.max_changed_lines || s.files.every((f) => trivialPath(f.path))),
    testsTouched: s.files.some((f) => isTest(f.path) || INLINE_TEST.test(f.patch ?? "")),
    sourceTouched: s.files.some((f) => isSource(f.path) && !isTest(f.path)),
    docsOnly: s.files.length > 0 && s.files.every((f) => DOCS(f.path)),
    forceTests: rules.some((r) => r.require_tests),
    forceIssue: rules.some((r) => r.require_linked_issue),
    maxLines: Math.min(pr.size.first_time_max_lines, ...rules.map((r) => r.first_time_max_lines ?? Infinity)),
  };
}

function templateCheck(s: Subject, conf: Conf & { min_chars: number; sections?: string[] }, kind: string): CheckResult {
  const id = "template";
  const title = "Template filled in";
  if (!conf.enabled) return skip(id, title, conf, "Disabled.");
  const tpl = s.templates[0] ?? "";
  const checklist = (content: string) => {
    const lines = stripComments(content).split(/\r?\n/).filter((l) => l.trim());
    return lines.length > 0 && lines.every((l) => /^\s*[-*]\s+\[[ xX]\]/.test(l));
  };
  const wanted = conf.sections?.length
    ? conf.sections
    : sections(tpl)
        .filter((x) => !/optional/i.test(x.heading) && !checklist(x.content))
        .map((x) => x.heading);
  const bodySections = sections(s.body);
  if (wanted.length === 0 && bodySections.length === 0) return skip(id, title, conf, "No template found.");
  const tplLines = new Set(s.templates.flatMap((t) => [...templateLineSet(t)]));
  const targets = wanted.length ? wanted : bodySections.map((x) => x.heading);
  const missing: string[] = [];
  const empty: string[] = [];
  for (const h of targets) {
    const key = headingKey(h);
    const found = bodySections.find((b) => headingKey(b.heading) === key || headingKey(b.heading).includes(key));
    if (!found) missing.push(h);
    else if (realText(found.content, tplLines).length < conf.min_chars) empty.push(h);
  }
  const bad = [...missing, ...empty];
  if (bad.length === 0) return result(id, title, conf, "pass", `All ${plural(targets.length, "section")} have content.`);
  const names = bad.map((h) => `"${h}"`).join(", ");
  const echo = tpl && stripTemplate(s.body, s.templates).length === 0;
  return result(
    id,
    title,
    conf,
    echo || bad.length === targets.length ? "fail" : "warn",
    echo ? "The description is the unedited template." : `${plural(bad.length, "section")} missing or left as template text: ${names}.`,
    `Fill in ${names} in the ${kind} description with details specific to this change.`,
  );
}

function descriptionCheck(s: Subject, conf: Conf & { min_chars: number }, kind: string): CheckResult {
  const id = "description";
  const title = "Describes the change";
  if (!conf.enabled) return skip(id, title, conf, "Disabled.");
  const own = stripTemplate(s.body, s.templates);
  if (own.length >= conf.min_chars) return result(id, title, conf, "pass", `${own.length} characters of description beyond the template.`);
  return result(
    id,
    title,
    conf,
    "fail",
    own.length === 0 ? "No description beyond the template." : `Only ${own.length} characters of description beyond the template.`,
    kind === "pull request"
      ? "Explain what this changes and why, in your own words. A few sentences is enough."
      : "Describe the problem in your own words: what you did, what you expected, what happened instead.",
  );
}

function duplicatesCheck(s: Subject, conf: Conf & { threshold: number }): CheckResult {
  const id = "duplicates";
  const title = "Not a duplicate";
  if (!conf.enabled) return skip(id, title, conf, "Disabled.");
  if (!s.others) return skip(id, title, conf, "Open items could not be listed.");
  const own = stripTemplate(s.body, s.templates);
  const hits = s.others
    .filter((o) => o.number !== s.number)
    .map((o) => ({ n: o.number, score: similarity(s.title, own, o.title, stripTemplate(o.body, s.templates)) }))
    .filter((h) => h.score >= conf.threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (hits.length === 0) return result(id, title, conf, "pass", `No close match among ${plural(s.others.length, "open item")}.`);
  const refs = hits.map((h) => `#${h.n}`).join(", ");
  return result(
    id,
    title,
    conf,
    "warn",
    `Similar to open ${refs}.`,
    `Check whether ${refs} already covers this. If it does, comment there instead; if not, say how this differs.`,
  );
}

function accountCheck(s: Subject, conf: Conf & { min_age_days: number }): CheckResult {
  const id = "account";
  const title = "Contributor history";
  if (!conf.enabled) return skip(id, title, conf, "Disabled.");
  if (!s.author.createdAt) return skip(id, title, conf, "Account age unavailable.");
  const days = Math.floor((Date.parse(s.createdAt) - Date.parse(s.author.createdAt)) / 86_400_000);
  const merged = s.author.mergedPrs;
  const history = merged === null ? "" : `, ${plural(merged, "merged PR")} here`;
  if (days < conf.min_age_days)
    return result(id, title, conf, "warn", `Account is ${plural(days, "day")} old${history}. Signal only; never blocks on its own.`);
  return result(id, title, conf, "pass", `Account is ${plural(days, "day")} old${history}.`);
}

export function checkPull(s: PullSubject, p: Policy): CheckResult[] {
  const pr: PullPolicy = p.pull_requests;
  const f = pullFacts(s, p);
  const out: CheckResult[] = [];
  const first = isFirstTime(s);

  out.push(descriptionCheck(s, pr.description, "pull request"));
  out.push(templateCheck(s, pr.template, "pull request"));

  {
    const id = "linked_issue";
    const title = "Linked issue";
    const conf = { ...pr.linked_issue, enabled: pr.linked_issue.enabled || f.forceIssue };
    if (!conf.enabled) out.push(skip(id, title, conf, "Not required by policy."));
    else if (f.trivial && !f.forceIssue) out.push(skip(id, title, conf, "Trivial change; no issue needed."));
    else {
      const label = pr.linked_issue.required_label;
      const ok = s.linkedIssues.filter(
        (i) => (!pr.linked_issue.require_open || i.state === "open") && (!label || i.labels.includes(label)),
      );
      const todo = label
        ? `Link an open issue labelled \`${label}\` (add \`Fixes #123\` to the description). If none exists, open one first and wait for a maintainer to approve it.`
        : "Link the issue this addresses (add `Fixes #123` to the description). If none exists, open one first.";
      if (ok.length) out.push(result(id, title, conf, "pass", `Linked to ${ok.map((i) => `#${i.number}`).join(", ")}.`));
      else if (s.linkedIssues.length)
        out.push(
          result(
            id,
            title,
            conf,
            "fail",
            `Linked ${s.linkedIssues.map((i) => `#${i.number}`).join(", ")}, but ${label ? `none is open with the \`${label}\` label` : "none is open"}.`,
            todo,
          ),
        );
      else out.push(result(id, title, conf, "fail", "No linked issue.", todo));
    }
  }

  {
    const id = "tests";
    const title = "Tests updated";
    const conf = pr.tests;
    const need = f.sourceTouched || f.forceTests;
    if (!conf.enabled && !f.forceTests) out.push(skip(id, title, conf, "Disabled."));
    else if (!need) out.push(skip(id, title, conf, "No source files changed."));
    else if (f.trivial && !f.forceTests) out.push(skip(id, title, conf, "Trivial change."));
    else if (f.testsTouched) out.push(result(id, title, conf, "pass", "Source and tests both changed."));
    else
      out.push(
        result(id, title, conf, "fail", "Source files changed but no test files did.", "Add or update tests that cover this change, or explain in the description why none are needed."),
      );
  }

  {
    const id = "ci";
    const title = "CI passing";
    const conf = pr.ci;
    if (!conf.enabled) out.push(skip(id, title, conf, "Disabled."));
    else if (!s.ci || s.ci.state === "none") out.push(skip(id, title, conf, "No CI results yet (fork workflows may need maintainer approval)."));
    else if (s.ci.state === "pending") out.push(skip(id, title, conf, "CI still running."));
    else if (s.ci.state === "success") out.push(result(id, title, conf, "pass", "All checks green."));
    else
      out.push(
        result(id, title, conf, "fail", `Failing: ${s.ci.failing.slice(0, 5).join(", ")}.`, `Fix the failing checks (${s.ci.failing.slice(0, 3).join(", ")}) before review is requested.`),
      );
  }

  {
    const id = "size";
    const title = "Reviewable size";
    const conf = pr.size;
    if (!conf.enabled) out.push(skip(id, title, conf, "Disabled."));
    else if (!first) out.push(skip(id, title, conf, "Limit applies to first-time contributors only."));
    else if (f.lines <= f.maxLines) out.push(result(id, title, conf, "pass", `${f.lines} changed lines (limit ${f.maxLines} for a first contribution).`));
    else
      out.push(
        result(
          id,
          title,
          conf,
          "fail",
          `${f.lines} changed lines; first contributions here are capped at ${f.maxLines}.`,
          `Split this into smaller pull requests of at most ${f.maxLines} changed lines, or open an issue to agree on the approach first.`,
        ),
      );
  }

  out.push(claimsCheck(s, pr, f));
  out.push(scopeCheck(s, pr, f));
  out.push(referencesCheck(s, pr));
  out.push(duplicatesCheck(s, pr.duplicates));

  {
    const id = "mass_pr";
    const title = "Not part of a mass submission";
    const conf = pr.mass_pr;
    const a = s.activity;
    if (!conf.enabled) out.push(skip(id, title, conf, "Disabled."));
    else if (!a) out.push(skip(id, title, conf, "Author activity not checked (trusted, rate limit, or search unavailable)."));
    else if (a.sameRepoSimilar >= 2)
      out.push(
        result(
          id,
          title,
          conf,
          "fail",
          `Author opened ${a.sameRepoSimilar} other pull requests with near-identical titles here in ${conf.window_days} days.`,
          "Keep one pull request for this change and close the others.",
        ),
      )
    else if (a.otherRepos >= conf.max_repos && a.similarTitles >= 5)
      out.push(
        result(
          id,
          title,
          conf,
          "fail",
          `Author opened ${plural(a.total, "pull request")} across ${plural(a.otherRepos, "other repository")} in ${conf.window_days} days, ${a.similarTitles} with near-identical titles.`,
          "Explain why this change is needed in this project specifically, and how you tested it here.",
        ),
      );
    else if (a.otherRepos >= conf.max_repos)
      out.push(result(id, title, conf, "warn", `Author opened ${plural(a.total, "pull request")} across ${plural(a.otherRepos, "other repository")} in ${conf.window_days} days.`));
    else out.push(result(id, title, conf, "pass", `${plural(a.total, "pull request")} by this author in ${conf.window_days} days.`));
  }

  out.push(accountCheck(s, pr.account));
  return out;
}

const TESTS_CLAIM = /\b(add(?:ed|s|ing)?|wr(?:ote|ite|itten)|updated?|includ(?:e|es|ed|ing)|new|extend(?:ed)?)\b[^.\n]{0,40}\b(unit |integration |e2e |regression )?tests?\b/i;
const DOCS_CLAIM = /\b(updated?|add(?:ed)?|wrote|document(?:ed)?)\b[^.\n]{0,30}\b(docs|documentation|readme|changelog)\b/i;
const SMALL_CLAIM = /\b(typo|one[- ]line(?:r)?|small fix|minor (?:fix|change|tweak)|tiny|trivial)\b/i;
const NEGATED = /\b(no|not|without|n't|none)\b[^.\n]{0,30}$/i;

function claimed(re: RegExp, text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line);
    if (m && !NEGATED.test(line.slice(0, m.index + m[0].length))) return true;
  }
  return false;
}

function claimsCheck(s: PullSubject, pr: PullPolicy, f: PullFacts): CheckResult {
  const id = "claims";
  const title = "Description matches the diff";
  const conf = pr.claims;
  if (!conf.enabled) return skip(id, title, conf, "Disabled.");
  const text = stripComments(s.body)
    .split(/\r?\n/)
    .filter((l) => !/^\s*[-*]\s+\[\s\]/.test(l))
    .join("\n");
  const problems: string[] = [];
  const missing: string[] = [];
  let worst: Status = "pass";
  if (claimed(TESTS_CLAIM, text) && !f.testsTouched) {
    problems.push("the description says tests were added, but no test files changed");
    missing.push("tests");
    worst = "fail";
  }
  if (claimed(DOCS_CLAIM, text) && !s.files.some((x) => DOCS(x.path))) {
    problems.push("the description says docs were updated, but no documentation files changed");
    missing.push("documentation");
    worst = "fail";
  }
  const todos = missing.length ? [`Push the ${missing.join(" and ")} the description mentions, or correct the description.`] : [];
  if (SMALL_CLAIM.test(s.title) && f.lines > 100) {
    problems.push(`the title calls this a small change, but it touches ${f.lines} lines`);
    todos.push("Describe the full scope of the change.");
    if (worst === "pass") worst = "warn";
  }
  if (problems.length === 0) return result(id, title, conf, "pass", "No contradictions between description and diff.");
  const detail = problems.join("; ");
  return result(id, title, conf, worst, `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`, todos.join(" "));
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?!?:\s/;
const GENERIC = /^(update|fix|change|edit|modify|patch|improve)s?\s+(\S+\.\w+|readme|code|file|files|bug|issue|it|this)\s*$/i;

function scopeCheck(s: PullSubject, pr: PullPolicy, f: PullFacts): CheckResult {
  const id = "scope";
  const title = "Title matches the files";
  const conf = pr.scope;
  if (!conf.enabled) return skip(id, title, conf, "Disabled.");
  const t = s.title.trim();
  if (GENERIC.test(t) || t.length < 10)
    return result(id, title, conf, "warn", `Title "${t}" doesn't say what changed.`, "Rename the pull request so the title says what it changes and why, e.g. `fix(parser): handle empty input`.");
  const type = CONVENTIONAL.exec(t)?.[1]?.toLowerCase();
  if (type === "docs" && !f.docsOnly)
    return result(id, title, conf, "warn", "Title says docs, but non-documentation files changed.", "Retitle to describe the code change, or move it into a separate pull request.");
  if (type === "ci" && s.files.some((x) => !x.path.startsWith(".github/")))
    return result(id, title, conf, "warn", "Title says ci, but files outside .github/ changed.", "Retitle to describe the full change, or split it.");
  if (type === "test" && f.sourceTouched)
    return result(id, title, conf, "warn", "Title says test, but source files changed.", "Retitle to describe the source change, or split it.");
  return result(id, title, conf, "pass", "Title is consistent with the files changed.");
}

const BUILD_OUTPUT = /(^|\/)(dist|build|out|target|node_modules|vendor|\.next|coverage)\//;

function referencesCheck(s: PullSubject, pr: PullPolicy): CheckResult {
  const id = "references";
  const title = "References exist";
  const conf = pr.references;
  if (!conf.enabled) return skip(id, title, conf, "Disabled.");
  const own = stripTemplate(s.body, s.templates);
  const paths = mentionedPaths(own).filter((p) => !BUILD_OUTPUT.test(p));
  const symbols = mentionedSymbols(own);
  if (s.missingRefs.length)
    return result(
      id,
      title,
      conf,
      "fail",
      `Description references ${s.missingRefs.map((n) => `#${n}`).join(", ")}, which ${s.missingRefs.length === 1 ? "doesn't" : "don't"} exist in this repository.`,
      "Fix the issue number in the description so it points at the issue this change addresses.",
    );
  if (paths.length === 0 && symbols.length === 0) return skip(id, title, conf, "Description names no files, functions or issues.");
  const changed = new Set(s.files.map((x) => x.path));
  const exists = (p: string) =>
    changed.has(p) || (s.tree?.has(p) ?? true) || [...changed, ...(s.tree ?? [])].some((x) => x.endsWith("/" + p));
  const missingPaths = paths.filter((p) => !exists(p));
  const patchText = s.files.map((x) => `${x.path}\n${x.patch ?? ""}`).join("\n");
  const missingSymbols = symbols.filter((sym) => !patchText.includes(sym));
  if (missingPaths.length)
    return result(
      id,
      title,
      conf,
      missingPaths.length >= 2 && missingPaths.length * 2 > paths.length ? "fail" : "warn",
      `Description mentions ${missingPaths.map((p) => `\`${p}\``).join(", ")}, which ${missingPaths.length === 1 ? "doesn't" : "don't"} exist in this repository or diff.`,
      "Correct the file names in the description so they match what this pull request actually changes.",
    );
  if (missingSymbols.length)
    return result(
      id,
      title,
      conf,
      "warn",
      `Description mentions ${missingSymbols.map((x) => `\`${x}()\``).join(", ")}, which ${missingSymbols.length === 1 ? "doesn't" : "don't"} appear in the diff.`,
      "Make sure the functions the description talks about are the ones this change touches.",
    );
  return result(id, title, conf, "pass", `All ${plural(paths.length + symbols.length, "reference")} found.`);
}

const REPRO = /\b(reproduc|steps|to reproduce|how to trigger|minimal example|repro)\b/i;
const VERSION_HEAD = /\b(version|environment|platform|setup|system info)\b/i;
const VERSION = /\bv?\d+\.\d+(?:\.\d+)?\b|\b[0-9a-f]{7,40}\b/;

export function checkIssue(s: IssueSubject, p: Policy): CheckResult[] {
  const ip: IssuePolicy = p.issues;
  const out: CheckResult[] = [descriptionCheck(s, ip.description, "issue"), templateCheck(s, ip.template, "issue")];
  {
    const id = "bug_report";
    const title = "Bug report is actionable";
    const conf = ip.bug_report;
    const isBug = s.labels.some((l) => conf.labels.includes(l)) || new RegExp(conf.title_pattern, "i").test(s.title);
    if (!conf.enabled) out.push(skip(id, title, conf, "Disabled."));
    else if (!isBug) out.push(skip(id, title, conf, "Not a bug report."));
    else {
      const secs = sections(s.body);
      const tplLines = new Set(s.templates.flatMap((t) => [...templateLineSet(t)]));
      const own = stripTemplate(s.body, s.templates);
      const reproSec = secs.find((x) => REPRO.test(x.heading));
      const hasRepro = reproSec
        ? realText(reproSec.content, tplLines).length >= 15
        : /^\s*(1\.|-)\s+\S.*\n\s*(2\.|-)\s+\S/m.test(own) || /```[\s\S]+?```/.test(own);
      const verSec = secs.find((x) => VERSION_HEAD.test(x.heading));
      const hasVersion = verSec ? VERSION.test(realText(verSec.content, tplLines)) : VERSION.test(own);
      const missing = [!hasRepro && "steps to reproduce", !hasVersion && "the version you're running"].filter(Boolean) as string[];
      if (missing.length === 0) out.push(result(id, title, conf, "pass", "Has reproduction steps and a version."));
      else
        out.push(
          result(
            id,
            title,
            conf,
            "fail",
            `Missing ${missing.join(" and ")}.`,
            `Add ${missing.join(" and ")}. A minimal set of steps or a snippet that triggers the bug is the single most useful thing here.`,
          ),
        );
    }
  }
  out.push(duplicatesCheck(s, ip.duplicates));
  out.push(accountCheck(s, ip.account));
  return out;
}
