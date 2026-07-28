import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { allDrills, getDrill, label } from "@/lib/content/drills";
import { DrillDiagram } from "@/components/DrillDiagram";
import { Button, Chip, Display, Eyebrow, Section, StepNumber } from "@/components/ui";
import { BOARD_URL } from "@/lib/config";

export const dynamic = "force-static";

export function generateStaticParams() {
  return allDrills().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const d = getDrill((await params).slug);
  return d ? { title: d.title, description: d.summary } : {};
}

export default async function DrillPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const d = getDrill((await params).slug);
  if (!d) notFound();

  return (
    <article className="py-14">
      <Section>
        <Eyebrow>{label("zones", d.zone)}</Eyebrow>
        <Display className="mt-4 max-w-[20ch]">{d.title}</Display>
        <p className="mt-5 max-w-[62ch] text-lg text-ink-soft">{d.summary}</p>

        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          <span>{label("levels", d.level)}</span>
          <span aria-hidden>·</span>
          <span className="tnum">{d.duration} min</span>
          <span aria-hidden>·</span>
          <span className="tnum">{d.players} skaters</span>
        </div>
      </Section>

      <Section className="mt-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <DrillDiagram svg={d.svg} title={d.title} rink={d.rink} />

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {/* No backend needed: the DSL is base64'd into the hash at build
                  time, exactly as the board's own share link does it. */}
              <Button href={`${BOARD_URL}/${d.shareHash}`}>Open in the board</Button>
              {d.tags.map((t) => (
                <Chip key={t}>{label("tags", t)}</Chip>
              ))}
            </div>

            {d.bodyHtml && (
              <div
                className="prose-rink mt-10"
                dangerouslySetInnerHTML={{ __html: d.bodyHtml }}
              />
            )}
            {d.notesHtml && (
              <div
                className="prose-rink mt-8"
                dangerouslySetInnerHTML={{ __html: d.notesHtml }}
              />
            )}
          </div>

          <aside className="space-y-10">
            {d.inventory.length > 0 && (
              <section>
                <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                  What you need
                </h2>
                <table className="mt-4 w-full text-sm">
                  <tbody>
                    {d.inventory.map((row) => (
                      <tr key={row.key} className="border-b border-hair last:border-0">
                        <td className="py-2 text-ink-soft">{row.label}</td>
                        <td className="py-2 text-right font-mono text-ink">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {d.steps.length > 0 && (
              <section>
                <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                  How it runs
                </h2>
                <ol className="mt-4 space-y-3">
                  {d.steps.map((s, i) => (
                    <li key={i} className="flex gap-3">
                      <StepNumber n={i + 1} />
                      <span
                        className="pt-0.5 text-sm text-ink-soft [&_code]:font-mono [&_code]:text-[0.9em] [&_strong]:font-semibold [&_strong]:text-ink"
                        dangerouslySetInnerHTML={{ __html: stepHtml(s.text) }}
                      />
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section>
              <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                Skills
              </h2>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {d.skills.map((s) => (
                  <Chip key={s}>{label("skills", s)}</Chip>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </Section>
    </article>
  );
}

// STEP captions allow inline markdown. mdInline expects already-escaped input —
// mdBlock would wrap each one in its own <p>, which fights the list layout.
import { mdEscape, mdInline } from "@coachvision/drill-core/md.js";
const stepHtml = (text: string) => mdInline(mdEscape(text));
