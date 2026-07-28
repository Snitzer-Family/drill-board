import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractDrill,
  parseDrill,
  deriveInventory,
} from "@coachvision/drill-core/drill-format.js";
import { drillSvg } from "@coachvision/drill-core/drill-svg.js";
import { mdBlock } from "@coachvision/drill-core/md.js";
import { bool, list, num, parseFrontmatter, str } from "./frontmatter";
import taxonomy from "@/content/taxonomy.json";

// Drill pages are fully static: this reads the filesystem once at build time and
// the result is baked into HTML. That is deliberate — it means a malformed drill
// FAILS THE BUILD rather than 500ing for a coach on a phone at the rink.
//
// This module is server-only by construction (node:fs won't bundle for the
// client), so it needs no `server-only` marker package.
//
// cwd, not `new URL(..., import.meta.url)`: webpack statically analyses the
// latter and tries to resolve the content directory as a module. Next always
// runs with the app directory as cwd, locally and on Vercel.
const DIR = join(process.cwd(), "content", "drills");

export interface DrillDoc {
  slug: string;
  title: string;
  summary: string;
  zone: string;
  level: string;
  tags: string[];
  skills: string[];
  duration: number;
  players: number;
  featured: boolean;
  updated: string;
  /** The prose between the H1 and the ```drill fence, as HTML. */
  bodyHtml: string;
  dsl: string;
  rink: "full" | "half" | "quarter";
  /** A complete <svg…> document string from the same renderer the board uses. */
  svg: string;
  steps: { at?: number; on?: string; text: string }[];
  notesHtml: string;
  inventory: { key: string; label: string; count: number }[];
  /** "#d=…" — append to the board's origin to deep-link this drill into it. */
  shareHash: string;
}

/** Exactly previewLink()'s encoding in the board, computed at build time. */
export const shareHash = (dsl: string) =>
  "#d=" +
  Buffer.from(dsl, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function assertInTaxonomy(kind: keyof typeof taxonomy, value: string, where: string) {
  const table = taxonomy[kind] as Record<string, string>;
  if (!(value in table)) {
    throw new Error(
      `${where}: ${String(kind)} "${value}" is not in content/taxonomy.json ` +
        `(have: ${Object.keys(table).join(", ")})`,
    );
  }
}

function load(file: string): DrillDoc {
  const where = `content/drills/${file}`;
  const raw = readFileSync(join(DIR, file), "utf8");
  const { data, body } = parseFrontmatter(raw, where);

  const slug = str(data, "slug", where);
  if (slug !== file.replace(/\.md$/, ""))
    throw new Error(`${where}: slug "${slug}" does not match the filename`);

  // extractDrill returns its INPUT UNCHANGED when there is no fence, so a file
  // missing its ```drill block would quietly try to parse prose as DSL. Assert
  // the fence exists rather than trusting the return value.
  if (!/```drill\s/.test(body))
    throw new Error(`${where}: no \`\`\`drill fence`);

  const dsl = extractDrill(body);
  const parsed = parseDrill(dsl);
  if (parsed.errors.length)
    throw new Error(`${where}: drill has parse errors:\n  ${parsed.errors.join("\n  ")}`);

  // The H1 and the DSL TITLE are authored separately and WILL drift.
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  if (!h1) throw new Error(`${where}: no "# " heading`);
  if (h1 !== parsed.title)
    throw new Error(`${where}: H1 "${h1}" != DSL TITLE "${parsed.title}"`);

  const zone = str(data, "zone", where);
  const level = str(data, "level", where);
  const tags = list(data, "tags", where);
  const skills = list(data, "skills", where);
  assertInTaxonomy("zones", zone, where);
  assertInTaxonomy("levels", level, where);
  tags.forEach((t) => assertInTaxonomy("tags", t, where));
  skills.forEach((s) => assertInTaxonomy("skills", s, where));

  // Prose = everything between the H1 and the fence.
  const prose = body
    .replace(/^#\s+.+$/m, "")
    .split("```drill")[0]
    .trim();

  return {
    slug,
    title: parsed.title,
    summary: str(data, "summary", where),
    zone,
    level,
    tags,
    skills,
    duration: num(data, "duration", where),
    players: num(data, "players", where),
    featured: bool(data, "featured"),
    updated: str(data, "updated", where),
    bodyHtml: mdBlock(prose),
    dsl,
    rink: parsed.rink,
    svg: drillSvg(dsl, { width: 960 }),
    steps: parsed.steps,
    notesHtml: parsed.notes ? mdBlock(parsed.notes) : "",
    inventory: deriveInventory(parsed.pieces, parsed.items)
      .filter((r) => !r.hide && r.count > 0)
      .map((r) => ({ key: r.key, label: r.label, count: r.count })),
    shareHash: shareHash(dsl),
  };
}

let cache: DrillDoc[] | null = null;

export function allDrills(): DrillDoc[] {
  if (cache) return cache;
  const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
  const docs = files.map(load);
  const dupes = docs.map((d) => d.slug).filter((s, i, a) => a.indexOf(s) !== i);
  if (dupes.length) throw new Error(`duplicate drill slugs: ${dupes.join(", ")}`);
  docs.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  cache = docs;
  return docs;
}

export function getDrill(slug: string): DrillDoc | undefined {
  return allDrills().find((d) => d.slug === slug);
}

/** Facet counts for the library filters. Zero-count values are omitted. */
export function drillFacets() {
  const docs = allDrills();
  const count = (pick: (d: DrillDoc) => string[]) => {
    const n = new Map<string, number>();
    for (const d of docs) for (const v of pick(d)) n.set(v, (n.get(v) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]);
  };
  return {
    zones: count((d) => [d.zone]),
    levels: count((d) => [d.level]),
    tags: count((d) => d.tags),
    skills: count((d) => d.skills),
  };
}

export const label = (kind: keyof typeof taxonomy, key: string) =>
  (taxonomy[kind] as Record<string, string>)[key] ?? key;
