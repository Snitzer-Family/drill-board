import Link from "next/link";
import { allDrills, drillFacets, label } from "@/lib/content/drills";
import { DrillDiagram, DrillDiagramBand } from "@/components/DrillDiagram";
import { Button, Card, Display, Eyebrow, Section } from "@/components/ui";
import { BOARD_URL } from "@/lib/config";

export const dynamic = "force-static";

export default function HomePage() {
  const drills = allDrills();
  const facets = drillFacets();
  // The hero shows a REAL drill from the library, rendered by the real
  // renderer — not a mockup. If the library breaks, the home page breaks, which
  // is the correct coupling.
  const hero = drills.find((d) => d.featured) ?? drills[0];
  const rest = drills.filter((d) => d.slug !== hero.slug).slice(0, 2);

  return (
    <div className="pb-8">
      {/* ---------- hero ---------- */}
      <Section className="pt-16">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div>
            <Eyebrow>Hockey drills that move</Eyebrow>
            <Display className="mt-5">Stop drawing on a whiteboard</Display>
            <p className="mt-6 max-w-[52ch] text-lg text-ink-soft">
              An animated drill library, a practice planner that prints on one
              page, and a board that lives on the phone in your pocket. You get
              the sheet for fifty minutes — spend them coaching.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button href="/drills">Browse the library</Button>
              <Button href={BOARD_URL} variant="secondary">Open the board</Button>
            </div>
            <p className="mt-4 text-sm text-ink-muted">
              Free for one team. No card, no account needed to look around.
            </p>
          </div>

          <div className="blueprint rounded-rink p-3 sm:p-5">
            <Link href={`/drills/${hero.slug}`} aria-label={`See the drill: ${hero.title}`}>
              <DrillDiagram svg={hero.svg} title={hero.title} rink={hero.rink} className="shadow-lift" />
            </Link>
            <p className="mt-3 text-center text-xs text-ink-muted">
              <Link href={`/drills/${hero.slug}`} className="underline underline-offset-4">
                {hero.title}
              </Link>{" "}
              — drawn from the drill itself, not a screenshot
            </p>
          </div>
        </div>
      </Section>

      {/* ---------- scoreboard strip ---------- */}
      <div className="mt-20 border-y-2 border-y-ice-blue bg-sunken">
        <Section className="py-8">
          <dl className="flex flex-wrap gap-x-14 gap-y-6">
            {([
              ["Drills in the library", drills.length],
              ["Zones covered", facets.zones.length],
              ["Age groups", facets.levels.length],
              ["Skills tagged", facets.skills.length],
            ] as const).map(([k, v]) => (
              <div key={k}>
                <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                  {k}
                </dt>
                <dd className="tnum mt-1 font-display text-3xl font-bold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      {/* ---------- the three things ---------- */}
      <Section className="mt-20">
        <Eyebrow>What you get</Eyebrow>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            {
              title: "A library that animates",
              body: "Every drill is a diagram you can read at a glance, with the coaching points underneath and a gear list. One tap opens it moving.",
              href: "/drills" as const,
              cta: "Browse drills",
            },
            {
              title: "A board in your pocket",
              body: "Draw where players go and it works out when they get there — timing comes from real distances on a 200 by 85 sheet, not from you setting numbers.",
              href: "/help/getting-started/first-drill" as const,
              cta: "How it works",
            },
            {
              title: "Plans that print",
              body: "Stack timed blocks, let the clock add itself up, and take one readable page to the bench.",
              href: "/planner" as const,
              cta: "See the planner",
            },
          ].map((f) => (
            <Card key={f.title} accent="blue" className="flex h-full flex-col p-5">
              <h2 className="font-display text-xl font-bold uppercase leading-tight tracking-tight text-ink">
                {f.title}
              </h2>
              <p className="mt-3 flex-1 text-sm text-ink-soft">{f.body}</p>
              <Link
                href={f.href}
                className="mt-5 text-sm font-semibold text-accent underline underline-offset-4"
              >
                {f.cta}
              </Link>
            </Card>
          ))}
        </div>
      </Section>

      {/* ---------- a couple of real drills ---------- */}
      <Section className="mt-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Eyebrow>From the library</Eyebrow>
          <Link href="/drills" className="text-sm font-semibold text-accent underline underline-offset-4">
            All {drills.length} drills
          </Link>
        </div>
        <ul className="mt-6 grid gap-6 md:grid-cols-2">
          {rest.map((d) => (
            <li key={d.slug}>
              <Card accent="blue" className="h-full overflow-hidden">
                <Link href={`/drills/${d.slug}`} className="block">
                  <DrillDiagramBand
                    svg={d.svg}
                    title={d.title}
                    rink={d.rink}
                    className="border-b border-b-hair"
                  />
                  <div className="p-5">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                      {label("levels", d.level)} · <span className="tnum">{d.duration} min</span>
                    </p>
                    <h3 className="mt-2 font-display text-lg font-bold uppercase tracking-tight text-ink">
                      {d.title}
                    </h3>
                    <p className="mt-2 text-sm text-ink-muted">{d.summary}</p>
                  </div>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      {/* ---------- close ---------- */}
      <Section className="mt-24">
        <Card accent="red" className="blueprint p-10 text-center">
          <Display size="md" className="mx-auto max-w-[18ch]">
            Practice is Tuesday. Be ready by Monday.
          </Display>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/register">Start free</Button>
            <Button href="/pricing" variant="secondary">See pricing</Button>
          </div>
        </Card>
      </Section>
    </div>
  );
}
