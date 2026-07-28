import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { articlesIn, getCategory, helpCategories } from "@/lib/content/help";
import { Card, Display, Eyebrow, Section } from "@/components/ui";

export const dynamic = "force-static";
export function generateStaticParams() {
  return helpCategories().map((c) => ({ category: c.slug }));
}
export async function generateMetadata({
  params,
}: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const c = getCategory((await params).category);
  return c ? { title: c.title, description: c.blurb } : {};
}

export default async function CategoryPage({
  params,
}: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const cat = getCategory(category);
  if (!cat) notFound();

  return (
    <div className="py-14">
      <Section>
        <Eyebrow>
          <Link href="/help" className="hover:text-ink">Help desk</Link>
        </Eyebrow>
        <Display className="mt-4 max-w-[16ch]">{cat.title}</Display>
        <p className="mt-5 max-w-[58ch] text-lg text-ink-soft">{cat.blurb}</p>
      </Section>

      <Section className="mt-10">
        <ul className="space-y-3">
          {articlesIn(category).map((a) => (
            <li key={a.slug}>
              <Card accent="none">
                <Link href={`/help/${category}/${a.slug}`} className="block p-4">
                  <p className="font-display text-lg font-bold uppercase tracking-tight text-ink">
                    {a.title}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">{a.summary}</p>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
