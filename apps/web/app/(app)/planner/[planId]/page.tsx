import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { SEED_PLANS, planMinutes } from "@/content/seed/practice-plans";
import { getDrill } from "@/lib/content/drills";
import { DrillDiagramBand } from "@/components/DrillDiagram";
import { Display, Eyebrow } from "@/components/ui";
import { BOARD_URL } from "@/lib/config";

export default async function PlanPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const user = await requireUser();
  const { planId } = await params;
  const plan = SEED_PLANS.find((p) => p.id === planId);
  // Not just "does it exist" — a plan belonging to someone else must 404, not
  // render. Ownership is checked here because the seed store has no row-level
  // security; a real database should enforce it there too, not only here.
  if (!plan || plan.ownerId !== user.id) notFound();

  let clock = 0;

  return (
    <div>
      <Eyebrow>{plan.team}</Eyebrow>
      <Display size="md" className="mt-4">{plan.title}</Display>
      <p className="mt-4 text-ink-soft">
        <span className="tnum">{plan.date}</span> ·{" "}
        <span className="tnum">{planMinutes(plan)} minutes</span> ·{" "}
        <span className="tnum">{plan.blocks.length}</span> blocks
      </p>

      <ol className="mt-10 space-y-4">
        {plan.blocks.map((b, i) => {
          const start = clock;
          clock += b.minutes;
          const drill = b.drill ? getDrill(b.drill) : undefined;
          return (
            <li
              key={i}
              className="grid gap-4 rounded-card border border-line bg-panel p-4 sm:grid-cols-[5.5rem_minmax(0,1fr)]"
            >
              <div className="tnum font-mono text-sm text-ink-muted">
                <div className="text-ink">
                  {String(Math.floor(start / 60)).padStart(2, "0")}:
                  {String(start % 60).padStart(2, "0")}
                </div>
                <div>{b.minutes} min</div>
              </div>

              <div className="min-w-0">
                <p className="font-display text-base font-bold uppercase tracking-tight text-ink">
                  {b.title}
                </p>
                {b.note && <p className="mt-1 text-sm text-ink-muted">{b.note}</p>}

                {drill && (
                  <div className="mt-3">
                    <DrillDiagramBand
                      svg={drill.svg}
                      title={drill.title}
                      rink={drill.rink}
                      className="max-w-md rounded-card border border-line"
                    />
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <Link
                        href={`/drills/${drill.slug}`}
                        className="text-accent underline underline-offset-4"
                      >
                        Drill details
                      </Link>
                      <a
                        href={`${BOARD_URL}/${drill.shareHash}`}
                        className="text-accent underline underline-offset-4"
                      >
                        Open in the board
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
