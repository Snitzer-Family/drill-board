import { notFound } from "next/navigation";
import { THEMES, NON_COLOR_TOKENS } from "@coachvision/drill-core/theme.js";
import { ThemePicker } from "@/components/ThemePicker";
import { Button, Card, Chip, Display, Eyebrow, Section, StepNumber } from "@/components/ui";

// The cheapest thing that keeps a design system coherent: every token and every
// component on one page, switchable across all five themes. It is also the
// visual-regression surface — if something looks wrong here it IS wrong.
// Not shipped to production.
export const dynamic = "force-static";

const TIERS: { title: string; match: (k: string) => boolean }[] = [
  { title: "Surfaces", match: (k) => k.startsWith("surface-") },
  { title: "Text", match: (k) => k === "text" || k.startsWith("text-") },
  { title: "Borders", match: (k) => k.startsWith("border") },
  { title: "Ice / diagram", match: (k) => k.startsWith("ice") },
  { title: "Effects", match: (k) => k.startsWith("fx-") },
  {
    title: "State & accent",
    match: (k) =>
      !k.startsWith("surface-") && k !== "text" && !k.startsWith("text-") &&
      !k.startsWith("border") && !k.startsWith("ice") && !k.startsWith("fx-"),
  },
];

export default function StyleguidePage() {
  if (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production") {
    notFound();
  }

  const keys = Object.keys(THEMES.light);

  return (
    <div className="py-14">
      <Section>
        <Eyebrow>Design system</Eyebrow>
        <Display className="mt-4">Rink Chalk</Display>
        <p className="mt-4 max-w-[62ch] text-lg text-ink-soft">
          Every colour below resolves to a <code className="font-mono text-[0.9em]">--db-*</code>{" "}
          token from <code className="font-mono text-[0.9em]">drill-core/theme.js</code> — the same
          table the board and the drill diagrams paint from. Switch the theme and
          the whole product moves together.
        </p>
        <div className="mt-8">
          <ThemePicker />
        </div>
      </Section>

      {/* -------- type -------- */}
      <Section className="mt-16">
        <Eyebrow>Type</Eyebrow>
        <div className="mt-6 space-y-6">
          <Display size="lg">Chip off the boards</Display>
          <Display size="md" as="h2">Neutral-zone regroup</Display>
          <Display size="sm" as="h3">Breakout wheel</Display>
          <p className="max-w-[62ch] text-lg text-ink-soft">
            Body copy is Inter with the <code className="font-mono text-[0.9em]">cv05/cv11/ss03</code>{" "}
            alternates — legible on a phone at the bench, and not stock Inter.
          </p>
          <p className="tnum font-mono text-sm text-ink-muted">
            JetBrains Mono · 0123456789 · tabular numerals for counts and durations
          </p>
        </div>
      </Section>

      {/* -------- components -------- */}
      <Section className="mt-16">
        <Eyebrow>Components</Eyebrow>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button href="/drills">Browse drills</Button>
          <Button href="/pricing" variant="secondary">See pricing</Button>
          <Chip>neutral-zone</Chip>
          <Chip>u12</Chip>
          <StepNumber n={1} />
          <StepNumber n={2} />
          <StepNumber n={3} />
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          <Card accent="blue" className="p-5">
            <h3 className="font-display font-bold uppercase tracking-tight">Blue line</h3>
            <p className="mt-2 text-sm text-ink-muted">
              A 2px rule, not a hairline grey border. This is the structural motif.
            </p>
          </Card>
          <Card accent="red" className="p-5">
            <h3 className="font-display font-bold uppercase tracking-tight">Goal line</h3>
            <p className="mt-2 text-sm text-ink-muted">Brand red, used sparingly for emphasis.</p>
          </Card>
          <Card accent="none" className="p-5">
            <h3 className="font-display font-bold uppercase tracking-tight">Plain</h3>
            <p className="mt-2 text-sm text-ink-muted">No accent — the quiet default.</p>
          </Card>
        </div>

        <div className="mt-8">
          <div className="blueprint rink-ratio flex items-center justify-center rounded-rink border border-line bg-ice">
            <span className="text-sm text-ink-muted">
              blueprint grid · rink-ratio (200:85) · radius-rink
            </span>
          </div>
        </div>
      </Section>

      {/* -------- tokens -------- */}
      <Section className="mt-16">
        <Eyebrow>Tokens</Eyebrow>
        <p className="mt-4 text-sm text-ink-muted">
          {keys.length} tokens. Swatches read live from the cascade, so what you see
          is what the current theme actually paints.
        </p>
        {TIERS.map((tier) => {
          const tokens = keys.filter(tier.match);
          if (!tokens.length) return null;
          return (
            <div key={tier.title} className="mt-8">
              <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                {tier.title}
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {tokens.map((k) => {
                  const nonColor = (NON_COLOR_TOKENS as string[]).includes(k);
                  return (
                    <div
                      key={k}
                      className="flex items-center gap-3 rounded-chip border border-hair bg-panel px-3 py-2"
                    >
                      <span
                        aria-hidden
                        className="size-8 shrink-0 rounded-[6px] border border-line"
                        style={
                          nonColor
                            ? { boxShadow: `var(--db-${k})`, background: "var(--db-surface-raised)" }
                            : { background: `var(--db-${k})` }
                        }
                      />
                      <span className="font-mono text-xs text-ink-soft">--db-{k}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </Section>
    </div>
  );
}
