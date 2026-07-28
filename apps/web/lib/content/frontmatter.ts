// A ~40-line frontmatter reader instead of gray-matter.
//
// The files are repo-authored and the value space is tiny: string, number,
// boolean, ISO date, and a flat [a, b, c] list. A YAML dependency here would be
// the first crack in the "no new dependencies without asking" rule that keeps
// this codebase legible — and it would pull in a parser far more powerful than
// the format needs.
//
// Deliberately strict: an unparseable line THROWS. These files are build inputs,
// so a typo must fail the build, not silently produce a drill with no tags.

export type FrontmatterValue = string | number | boolean | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

const DELIM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function coerce(raw: string, where: string): FrontmatterValue {
  const v = raw.trim();
  if (v === "") return "";

  // [a, b, c] — flat lists only; nesting is not part of this format.
  if (v.startsWith("[")) {
    if (!v.endsWith("]")) throw new Error(`${where}: unterminated list`);
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
  }

  if (/^["'].*["']$/.test(v)) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  // A bare ISO date must stay a string — Number("2026-07-14") is NaN, but a
  // future `2026` would coerce to a number and surprise the caller.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Splits a document into its frontmatter block and the body below it. */
export function parseFrontmatter(
  text: string,
  where = "<content>",
): { data: Frontmatter; body: string } {
  const m = DELIM.exec(text);
  if (!m) return { data: {}, body: text };

  const data: Frontmatter = {};
  m[1].split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return;
    const at = line.indexOf(":");
    if (at < 0) throw new Error(`${where}: frontmatter line ${i + 1} has no ":" — ${line}`);
    const key = line.slice(0, at).trim();
    if (!key) throw new Error(`${where}: frontmatter line ${i + 1} has an empty key`);
    data[key] = coerce(line.slice(at + 1), `${where} line ${i + 1}`);
  });

  return { data, body: text.slice(m[0].length) };
}

/* Accessors that fail loudly. Reaching into `data` directly is how a renamed
   field becomes an empty page instead of a build error. */

export function str(d: Frontmatter, k: string, where: string): string {
  const v = d[k];
  if (typeof v !== "string" || !v) throw new Error(`${where}: missing or empty "${k}"`);
  return v;
}

export function num(d: Frontmatter, k: string, where: string): number {
  const v = d[k];
  if (typeof v !== "number") throw new Error(`${where}: "${k}" must be a number`);
  return v;
}

export function list(d: Frontmatter, k: string, where: string): string[] {
  const v = d[k];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${where}: "${k}" must be a [list]`);
  return v;
}

export function bool(d: Frontmatter, k: string): boolean {
  return d[k] === true;
}
