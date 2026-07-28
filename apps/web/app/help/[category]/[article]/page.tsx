import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { allHelpArticles, articlesIn, getArticle, getCategory } from "@/lib/content/help";
import { Display, Eyebrow, Section } from "@/components/ui";

export const dynamic = "force-static";
export function generateStaticParams() {
  return allHelpArticles().map((a) => ({ category: a.category, article: a.slug }));
}
export async function generateMetadata({
  params,
}: { params: Promise<{ category: string; article: string }> }): Promise<Metadata> {
  const p = await params;
  const a = getArticle(p.category, p.article);
  return a ? { title: a.title, description: a.summary } : {};
}

export default async function ArticlePage({
  params,
}: { params: Promise<{ category: string; article: string }> }) {
  const { category, article } = await params;
  const a = getArticle(category, article);
  const cat = getCategory(category);
  if (!a || !cat) notFound();

  const siblings = articlesIn(category).filter((s) => s.slug !== a.slug);

  return (
    <article className="py-14">
      <Section>
        <Eyebrow>
          <Link href={`/help/${category}`} className="hover:text-ink">{cat.title}</Link>
        </Eyebrow>
        <Display className="mt-4 max-w-[20ch]">{a.title}</Display>
        <p className="mt-5 max-w-[62ch] text-lg text-ink-soft">{a.summary}</p>

        <div className="prose-rink mt-10" dangerouslySetInnerHTML={{ __html: a.html }} />

        <p className="tnum mt-12 text-xs text-ink-faint">Updated {a.updated}</p>

        {siblings.length > 0 && (
          <nav className="mt-10 border-t-2 border-t-ice-blue pt-6">
            <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              More in {cat.title}
            </h2>
            <ul className="mt-3 space-y-2">
              {siblings.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={`/help/${category}/${s.slug}`}
                    className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                  >
                    {s.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </Section>
    </article>
  );
}
