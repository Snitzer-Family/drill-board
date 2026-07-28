import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SEED_USERS } from "@/content/seed/users";
import { allDrills } from "@/lib/content/drills";
import { DrillDiagramBand } from "@/components/DrillDiagram";
import { Card, Display, Eyebrow, Section } from "@/components/ui";

// Public, so it is cached rather than dynamic — but it must revalidate, because
// a coach editing their profile should not need a deploy to see it change.
export const revalidate = 3600;

const find = (handle: string) => SEED_USERS.find((u) => u.handle === handle);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const u = find((await params).handle);
  return u ? { title: u.name ?? u.handle!, description: `Drills shared by ${u.name}.` } : {};
}

export default async function CoachPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const user = find((await params).handle);
  if (!user) notFound();

  // Public page: only ever the fields a coach chose to publish. Never spread
  // the whole user object into a public view — email would ride along.
  const shared = allDrills().slice(0, 2);

  return (
    <div className="py-14">
      <Section>
        <Eyebrow>Coach</Eyebrow>
        <Display className="mt-4">{user.name ?? user.handle}</Display>
        <p className="mt-4 text-ink-muted">
          Coaching since <span className="tnum">{user.createdAt.slice(0, 4)}</span>
        </p>
      </Section>

      <Section className="mt-12">
        <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Shared drills
        </h2>
        <ul className="mt-4 grid gap-5 sm:grid-cols-2">
          {shared.map((d) => (
            <li key={d.slug}>
              <Card accent="blue" className="h-full overflow-hidden">
                <Link href={`/drills/${d.slug}`} className="block">
                  <DrillDiagramBand svg={d.svg} title={d.title} rink={d.rink} className="border-b border-b-hair" />
                  <div className="p-4">
                    <p className="font-display text-base font-bold uppercase tracking-tight text-ink">
                      {d.title}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">{d.summary}</p>
                  </div>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
