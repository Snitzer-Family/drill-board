import Link from "next/link";
import type { Metadata } from "next";
import { listPlans, money } from "@/lib/billing";
import { Card, Display, Eyebrow, Section } from "@/components/ui";

// Static on purpose. listPlans() is a synchronous read of a local table, so the
// pricing page cannot be taken down by a billing outage — the only thing a
// provider is needed for is checkout itself.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free for one team. Unlimited drills and practice plans for the price of a coffee a month.",
};

const LIMIT_ROWS = [
  ["Saved drills", "savedDrills"],
  ["Practice plans", "practicePlans"],
  ["Teams", "teams"],
  ["Drill imports from a photo", "aiImports"],
] as const;

export default function PricingPage() {
  const plans = listPlans();
  const show = (v: number | null | undefined) =>
    v === null || v === undefined ? "Unlimited" : String(v);

  return (
    <div className="py-14">
      <Section>
        <Eyebrow>Pricing</Eyebrow>
        <Display className="mt-4 max-w-[14ch]">Free for one team</Display>
        <p className="mt-5 max-w-[58ch] text-lg text-ink-soft">
          The library and the board are free forever. Pay only when you want the
          season planned out and the drills saved.
        </p>
      </Section>

      <Section className="mt-12">
        <ul className="grid gap-6 lg:grid-cols-3">
          {plans.map((p) => (
            <li key={p.id}>
              <Card
                accent={p.highlighted ? "red" : "blue"}
                className={`flex h-full flex-col p-6 ${p.highlighted ? "shadow-lift" : ""}`}
              >
                {p.highlighted && (
                  <span className="mb-3 inline-block self-start rounded-chip bg-brand px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-on-accent">
                    Most coaches
                  </span>
                )}
                <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-ink">
                  {p.name}
                </h2>
                <p className="mt-2 text-sm text-ink-muted">{p.tagline}</p>

                <p className="mt-6">
                  <span className="tnum font-display text-4xl font-bold text-ink">
                    {money(p.price.month)}
                  </span>
                  {p.price.month > 0 && (
                    <span className="ml-1.5 text-sm text-ink-muted">/ month</span>
                  )}
                </p>
                {p.price.year > 0 && (
                  <p className="tnum mt-1 text-xs text-ink-faint">
                    or {money(p.price.year)} a year
                  </p>
                )}

                <ul className="mt-6 flex-1 space-y-2.5 text-sm text-ink-soft">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <span aria-hidden className="mt-[0.35em] h-[2px] w-3 shrink-0 bg-ice-blue" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/register"
                  className={
                    "mt-7 inline-flex items-center justify-center rounded-card px-5 py-3 text-sm font-semibold " +
                    (p.highlighted
                      ? "bg-accent text-on-accent puck-shadow"
                      : "border border-line-strong bg-panel text-ink hover:bg-raised")
                  }
                >
                  {p.price.month === 0 ? "Start free" : `Choose ${p.name}`}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section className="mt-16">
        <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Limits at a glance
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b-2 border-b-ice-blue text-left">
                <th className="py-3 font-semibold text-ink">&nbsp;</th>
                {plans.map((p) => (
                  <th key={p.id} className="py-3 font-semibold text-ink">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LIMIT_ROWS.map(([label, key]) => (
                <tr key={key} className="border-b border-hair">
                  <td className="py-3 text-ink-soft">{label}</td>
                  {plans.map((p) => (
                    <td key={p.id} className="py-3 font-mono text-ink">
                      {show(p.limits[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
