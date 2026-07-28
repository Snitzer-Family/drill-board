import Link from "next/link";
import type { Metadata } from "next";
import { allDrills, drillFacets, label } from "@/lib/content/drills";
import { DrillDiagramBand } from "@/components/DrillDiagram";
import { Card, Chip, Display, Eyebrow, Section } from "@/components/ui";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Drill library",
  description:
    "Animated hockey drills with rink diagrams, coaching notes and a gear list — filterable by zone, age group and skill.",
};

export default function DrillsPage() {
  const drills = allDrills();
  const facets = drillFacets();

  return (
    <div className="py-14">
      <Section>
        <Eyebrow>Library</Eyebrow>
        <Display className="mt-4 max-w-[16ch]">Every drill, animated</Display>
        <p className="mt-5 max-w-[62ch] text-lg text-ink-soft">
          Each drill is a diagram you can read at a glance, the coaching points
          underneath, and a link that opens the whole thing moving in the board.
        </p>

        {/* The scoreboard strip: real counts, not a fake logo wall. */}
        <dl className="mt-10 flex flex-wrap gap-x-12 gap-y-4 rounded-card bg-sunken px-6 py-5">
          {([
            ["Drills", drills.length],
            ["Zones", facets.zones.length],
            ["Age groups", facets.levels.length],
            ["Skills", facets.skills.length],
          ] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                {k}
              </dt>
              <dd className="tnum font-display text-2xl font-bold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section className="mt-12">
        <div className="flex flex-wrap gap-2">
          {facets.zones.map(([z, n]) => (
            <Chip key={z}>
              {label("zones", z)} <span className="tnum ml-1.5 text-ink-faint">{n}</span>
            </Chip>
          ))}
        </div>

        <ul className="mt-8 grid gap-6 md:grid-cols-2">
          {drills.map((d) => (
            <li key={d.slug}>
              <Card
                accent="blue"
                className="h-full overflow-hidden transition-shadow hover:shadow-lift"
              >
                <Link href={`/drills/${d.slug}`} className="block">
                  <DrillDiagramBand
                    svg={d.svg}
                    title={d.title}
                    rink={d.rink}
                    className="border-b border-b-hair"
                  />
                  <div className="p-5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                      <span>{label("levels", d.level)}</span>
                      <span aria-hidden>·</span>
                      <span className="tnum">{d.duration} min</span>
                      <span aria-hidden>·</span>
                      <span className="tnum">{d.players} skaters</span>
                    </div>
                    <h2 className="mt-2 font-display text-xl font-bold uppercase leading-tight tracking-[-0.01em] text-ink">
                      {d.title}
                    </h2>
                    <p className="mt-2 text-sm text-ink-muted">{d.summary}</p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {d.skills.map((s) => (
                        <Chip key={s}>{label("skills", s)}</Chip>
                      ))}
                    </div>
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
