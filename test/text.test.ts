import { describe, expect, it } from "vitest";
import { issueRefs, jaccard, mentionedPaths, mentionedSymbols, realText, sections, similarity, stripTemplate, templateLineSet, words } from "../src/text.js";
import { PR_TEMPLATE } from "./helpers.js";

describe("sections", () => {
  it("splits on headings and bold labels, ignoring comments", () => {
    const s = sections("intro\n## One\na\n<!-- ## Hidden -->\n**Two**\nb\n### Three ###\nc");
    expect(s.map((x) => x.heading)).toEqual(["One", "Two", "Three"]);
    expect(s[0]!.content.trim()).toBe("a");
  });
});

describe("realText", () => {
  it("drops unchecked boxes, placeholders, and template lines", () => {
    const tpl = templateLineSet("Describe your change here");
    expect(realText("- [ ] I added tests\n_No response_\nDescribe your change here\nN/A\n", tpl)).toBe("");
    expect(realText("Real content\n- [ ] nope", tpl)).toBe("Real content");
  });
});

describe("stripTemplate", () => {
  it("returns empty for an unedited template", () => {
    expect(stripTemplate(PR_TEMPLATE, [PR_TEMPLATE])).toBe("");
  });
  it("keeps contributor text", () => {
    expect(stripTemplate(PR_TEMPLATE.replace("## Testing", "Fixes the crash.\n\n## Testing"), [PR_TEMPLATE])).toBe("Fixes the crash.");
  });
  it("treats a checked template box as template text", () => {
    expect(stripTemplate(PR_TEMPLATE.replace("- [ ] I added tests", "- [x] I added tests"), [PR_TEMPLATE])).toBe("");
  });
});

describe("issueRefs", () => {
  it("finds closing keywords and same-repo URLs", () => {
    const body = "Fixes #12, closes: #13\nRefs https://github.com/acme/widget/issues/14\nsee #15\nmentions #99 casually\n<!-- fixes #100 -->";
    expect(issueRefs(body, "acme", "widget").sort((a, b) => a - b)).toEqual([12, 13, 14, 15]);
  });
  it("ignores other repositories", () => {
    expect(issueRefs("fixes https://github.com/other/repo/issues/1", "acme", "widget")).toEqual([]);
  });
});

describe("mentioned references", () => {
  it("extracts paths but not URLs", () => {
    expect(mentionedPaths("Changed `src/a/b.ts` and lib/c.py. See https://x.dev/docs/page.html").sort()).toEqual(["lib/c.py", "src/a/b.ts"]);
  });
  it("extracts called symbols in backticks", () => {
    expect(mentionedSymbols("Calls `parse()` and `Foo.bar()`, not `baz`.")).toEqual(["parse", "bar"]);
  });
});

describe("similarity", () => {
  it("scores identical items 1 and unrelated items near 0", () => {
    expect(jaccard(words("parser crash empty"), words("parser crash empty"))).toBe(1);
    expect(similarity("Add dark mode toggle", "", "Fix memory leak in cache", "")).toBe(0);
    expect(similarity("Add dark mode toggle", "", "add dark-mode toggle", "")).toBe(1);
  });
});
