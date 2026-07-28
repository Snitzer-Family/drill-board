import Link from "next/link";
import type { Route } from "next";

/* The Rink Chalk primitives. Every one of these is here rather than inline in a
   page so the /styleguide route can render the real component, not a copy of it
   that drifts. */

// Lifted verbatim from the drill preview page's section label: a short brand-red
// rule, then 12px uppercase at wide tracking. It was already right.
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-3 text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-muted">
      <span aria-hidden className="h-[2px] w-[26px] bg-brand" />
      {children}
    </span>
  );
}

export function Display({
  as: As = "h1",
  size = "lg",
  className = "",
  children,
}: {
  as?: "h1" | "h2" | "h3";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: React.ReactNode;
}) {
  const scale = {
    sm: "text-[clamp(1.35rem,2.4vw,1.75rem)]",
    md: "text-[clamp(1.75rem,4vw,2.6rem)]",
    lg: "text-[clamp(2.1rem,6vw,3.9rem)]",
  }[size];
  return (
    <As
      className={`font-display font-bold uppercase leading-[0.95] tracking-[-0.015em] text-balance ${scale} ${className}`}
      style={{ fontVariationSettings: '"wdth" 112' }}
    >
      {children}
    </As>
  );
}

// Solid accent + a hard brand-red offset. No gradient, no blur, no pill.
export function Button({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: Route | string;
  variant?: "primary" | "secondary";
  className?: string;
  children: React.ReactNode;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-card px-5 py-3 text-sm font-semibold transition-transform active:translate-y-px";
  const kind =
    variant === "primary"
      ? "bg-accent text-on-accent puck-shadow"
      : "border border-line-strong bg-panel text-ink hover:bg-raised";
  const cls = `${base} ${kind} ${className}`;
  // External (the board lives on another origin) vs internal routing.
  return href.toString().startsWith("http") ? (
    <a href={href.toString()} className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href as Route} className={cls}>
      {children}
    </Link>
  );
}

// The blue line as structure: a 2px full-bleed rule, not a hairline grey border.
export function Card({
  accent = "blue",
  className = "",
  children,
}: {
  accent?: "blue" | "red" | "none";
  className?: string;
  children: React.ReactNode;
}) {
  const top =
    accent === "blue" ? "border-t-2 border-t-ice-blue"
    : accent === "red" ? "border-t-2 border-t-brand"
    : "border-t border-t-hair";
  return (
    <div
      className={`rounded-card border border-line bg-panel ${top} ${className}`}
    >
      {children}
    </div>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-chip border border-line bg-raised px-2.5 py-1 text-xs font-medium text-ink-soft">
      {children}
    </span>
  );
}

// Jersey-number step chip: circular, tabular numerals, brand-red ring.
export function StepNumber({ n }: { n: number }) {
  return (
    <span className="tnum inline-flex size-7 shrink-0 items-center justify-center rounded-full ring-2 ring-brand text-[0.8rem] font-bold text-ink">
      {n}
    </span>
  );
}

export function Section({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`mx-auto w-full max-w-[1180px] px-6 ${className}`}>
      {children}
    </section>
  );
}
