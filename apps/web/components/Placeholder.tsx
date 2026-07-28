import { Display, Eyebrow, Section } from "./ui";

// An honest stub. The skeleton's job is to make the whole product navigable, so
// every route in the nav resolves — but a page that pretends to be finished is
// worse than one that says what it will be. Delete this import when the real
// page lands; nothing else should depend on it.
export function Placeholder({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Section className="py-20">
      <Eyebrow>{eyebrow}</Eyebrow>
      <Display className="mt-5 max-w-[18ch]">{title}</Display>
      <div className="mt-6 max-w-[58ch] text-lg text-ink-soft">{children}</div>
      <div className="blueprint mt-12 flex h-56 items-center justify-center rounded-card border border-dashed border-line-strong">
        <span className="font-mono text-xs uppercase tracking-[0.16em] text-ink-faint">
          Not built yet
        </span>
      </div>
    </Section>
  );
}
