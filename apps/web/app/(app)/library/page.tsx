import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { billing, planOf, withinLimit } from "@/lib/billing";
import { allDrills } from "@/lib/content/drills";
import { DrillDiagramBand } from "@/components/DrillDiagram";
import { Card, Display, Eyebrow } from "@/components/ui";

export const metadata: Metadata = { title: "My drills" };

export default async function MyLibraryPage() {
  const user = await requireUser();
  const sub = await billing.getSubscription(user.id);
  const plan = planOf(sub.planId);

  // Stands in for a saved-drills table. Reading the real library keeps the page
  // honest about what a saved drill looks like.
  const saved = allDrills().filter((d) => d.featured);
  const cap = plan?.limits.savedDrills;
  const canSaveMore = withinLimit(sub, "savedDrills", saved.length);

  return (
    <div>
      <Eyebrow>Your drills</Eyebrow>
      <Display size="md" className="mt-4">Saved drills</Display>
      <p className="mt-4 text-ink-soft">
        <span className="tnum">{saved.length}</span>
        {cap !== null && cap !== undefined ? <> of <span className="tnum">{cap}</span></> : null} saved
        {!canSaveMore && (
          <>
            {" — "}
            <Link href="/pricing" className="font-semibold text-accent underline underline-offset-4">
              upgrade for unlimited
            </Link>
          </>
        )}
      </p>

      <ul className="mt-8 grid gap-5 sm:grid-cols-2">
        {saved.map((d) => (
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
    </div>
  );
}
