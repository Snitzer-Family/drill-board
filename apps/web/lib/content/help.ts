import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mdBlock } from "@coachvision/drill-core/md.js";
import { num, parseFrontmatter, str } from "./frontmatter";
import categoriesJson from "@/content/help/categories.json";

// Same shape as the drill loader on purpose: read once at build, throw on
// anything malformed, and let force-static turn that throw into a failed build.
// cwd rather than import.meta.url — webpack tries to resolve the latter as a
// module. See lib/content/drills.ts.
const DIR = join(process.cwd(), "content", "help");

export interface HelpCategory {
  slug: string;
  title: string;
  blurb: string;
}

export interface HelpArticle {
  slug: string;
  category: string;
  title: string;
  summary: string;
  order: number;
  updated: string;
  html: string;
}

export const helpCategories = (): HelpCategory[] => categoriesJson.categories;

function load(category: string, file: string): HelpArticle {
  const where = `content/help/${category}/${file}`;
  const { data, body } = parseFrontmatter(readFileSync(join(DIR, category, file), "utf8"), where);

  const slug = str(data, "slug", where);
  if (slug !== file.replace(/\.md$/, ""))
    throw new Error(`${where}: slug "${slug}" does not match the filename`);

  // The H1 and the frontmatter title are authored separately; if they disagree
  // the nav says one thing and the page says another.
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  if (!h1) throw new Error(`${where}: no "# " heading`);
  const title = str(data, "title", where);
  if (h1 !== title) throw new Error(`${where}: H1 "${h1}" != frontmatter title "${title}"`);

  return {
    slug,
    category,
    title,
    summary: str(data, "summary", where),
    order: num(data, "order", where),
    updated: str(data, "updated", where),
    // The H1 is rendered by the page as a Display heading, so drop it from the
    // body to avoid printing the title twice.
    html: mdBlock(body.replace(/^#\s+.+$/m, "").trim()),
  };
}

let cache: HelpArticle[] | null = null;

export function allHelpArticles(): HelpArticle[] {
  if (cache) return cache;
  const out: HelpArticle[] = [];
  for (const cat of helpCategories()) {
    const dir = join(DIR, cat.slug);
    if (!existsSync(dir))
      throw new Error(`categories.json lists "${cat.slug}" but content/help/${cat.slug} does not exist`);
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    if (!files.length) throw new Error(`content/help/${cat.slug} has no articles`);
    out.push(...files.map((f) => load(cat.slug, f)));
  }
  // A directory nobody listed would be silently unreachable — no nav entry, no
  // route, no error. Catch it here instead.
  const known = new Set(helpCategories().map((c) => c.slug));
  for (const e of readdirSync(DIR, { withFileTypes: true })) {
    if (e.isDirectory() && !known.has(e.name))
      throw new Error(`content/help/${e.name} is not listed in categories.json — it would be unreachable`);
  }
  out.sort((a, b) => a.order - b.order);
  cache = out;
  return out;
}

export const articlesIn = (category: string) =>
  allHelpArticles().filter((a) => a.category === category);

export const getArticle = (category: string, slug: string) =>
  allHelpArticles().find((a) => a.category === category && a.slug === slug);

export const getCategory = (slug: string) =>
  helpCategories().find((c) => c.slug === slug);
