import Link from "next/link";
import type { Metadata } from "next";
import { articlesIn, helpCategories } from "@/lib/content/help";
import { Card, Display, Eyebrow, Section } from "@/components/ui";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Help desk",
  description: "Guides for the board, the drill format, practice plans and billing.",
};

export default function HelpPage() {
  return (
    <div className="py-14">
      <Section>
        <Eyebrow>Help desk</Eyebrow>
        <Display className="mt-4 max-w-[14ch]">Getting unstuck</Display>
        <p className="mt-5 max-w-[58ch] text-lg text-ink-soft">
          Short guides, written for someone standing on rubber matting with
          twenty minutes before the Zamboni.
        </p>
      </Section>

      <Section className="mt-12">
        <div className="grid gap-6 md:grid-cols-3">
          {helpCategories().map((c) => (
            <Card key={c.slug} accent="blue" className="flex h-full flex-col p-5">
              <h2 className="font-display text-xl font-bold uppercase tracking-tight text-ink">
                <Link href={`/help/${c.slug}`}>{c.title}</Link>
              </h2>
              <p className="mt-2 text-sm text-ink-muted">{c.blurb}</p>
              <ul className="mt-4 space-y-2 border-t border-hair pt-4">
                {articlesIn(c.slug).map((a) => (
                  <li key={a.slug}>
                    <Link
                      href={`/help/${c.slug}/${a.slug}`}
                      className="text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                    >
                      {a.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>

        <p className="mt-10 text-ink-soft">
          Still stuck?{" "}
          <Link href="/help/contact" className="text-accent underline underline-offset-4">
            Send us a message
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}
