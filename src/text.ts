const STOP = new Set(
  "the and for with this that from are was were have has had not but you your our its into when then than will would should could can does did been being which what who how why all any each some more most other such only own same very also just over under about after before again there here they them their these those use used using add adds added fix fixes fixed update updates updated issue pull request change changes".split(
    " ",
  ),
);

export function stripComments(md: string): string {
  return md.replace(/<!--[\s\S]*?(-->|$)/g, "");
}

export function normalizeLine(line: string): string {
  return line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface Section {
  heading: string;
  content: string;
}

export function sections(md: string): Section[] {
  const out: Section[] = [];
  let current: Section | null = null;
  for (const line of stripComments(md).split(/\r?\n/)) {
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line) ?? /^\s*\*\*([^*]+)\*\*:?\s*$/.exec(line);
    if (h?.[1]) {
      current = { heading: h[1].trim(), content: "" };
      out.push(current);
    } else if (current) {
      current.content += line + "\n";
    }
  }
  return out;
}

export function headingKey(heading: string): string {
  return normalizeLine(heading);
}

const EMPTY_LINE = /^\s*(_no response_|n\/a|none|na|-|\*|tbd|todo|\.\.\.)\s*$/i;

export function realText(content: string, templateLines: Set<string> = new Set()): string {
  return stripComments(content)
    .split(/\r?\n/)
    .filter((l) => !/^\s*[-*]\s+\[\s\]/.test(l))
    .filter((l) => !EMPTY_LINE.test(l))
    .filter((l) => {
      const n = normalizeLine(l);
      return n.length > 0 && !templateLines.has(n);
    })
    .join("\n")
    .trim();
}

export function templateLineSet(template: string): Set<string> {
  return new Set(
    stripComments(template)
      .split(/\r?\n/)
      .map((l) => normalizeLine(l.replace(/^\s*[-*]\s+\[[ xX]\]\s*/, "")))
      .filter(Boolean),
  );
}

export function stripTemplate(body: string, templates: string[]): string {
  const lines = new Set(templates.flatMap((t) => [...templateLineSet(t)]));
  return stripComments(body)
    .split(/\r?\n/)
    .filter((l) => !/^\s*[-*]\s+\[\s\]/.test(l))
    .filter((l) => {
      const n = normalizeLine(l.replace(/^\s*[-*]\s+\[[xX]\]\s*/, ""));
      return n.length > 0 && !lines.has(n) && !/^\s{0,3}#{1,6}\s/.test(l) && !EMPTY_LINE.test(l);
    })
    .join("\n")
    .trim();
}

export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

export function similarity(aTitle: string, aBody: string, bTitle: string, bBody: string): number {
  const t = jaccard(words(aTitle), words(bTitle));
  const ab = words(aBody);
  const bb = words(bBody);
  if (ab.size < 8 || bb.size < 8) return t;
  return 0.6 * t + 0.4 * jaccard(ab, bb);
}

export function issueRefs(body: string, owner: string, repo: string): number[] {
  const refs = new Set<number>();
  const kw = "(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references|part of|related to|addresses|see)";
  const local = new RegExp(`\\b${kw}\\s*:?\\s+#(\\d+)`, "gi");
  const url = new RegExp(`\\b${kw}\\s*:?\\s+https://github\\.com/${owner}/${repo}/issues/(\\d+)`, "gi");
  for (const m of stripComments(body).matchAll(local)) refs.add(Number(m[1]));
  for (const m of stripComments(body).matchAll(url)) refs.add(Number(m[1]));
  return [...refs];
}

const PATH = /(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]+\.[a-z][a-z0-9]{0,5})(?=$|[\s`'"),:;]|\.(?:\s|$))/gim;

export function mentionedPaths(body: string): string[] {
  const text = stripComments(body).replace(/https?:\/\/\S+/g, " ");
  const out = new Set<string>();
  for (const m of text.matchAll(PATH)) {
    const p = m[1]!.replace(/^\.\//, "");
    if (!p.includes("..") && !p.startsWith("/")) out.add(p);
  }
  return [...out];
}

export function mentionedSymbols(body: string): string[] {
  const out = new Set<string>();
  for (const m of stripComments(body).matchAll(/`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)`/g)) {
    out.add(m[1]!.split(".").pop()!);
  }
  return [...out];
}

