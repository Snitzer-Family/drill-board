import { Button, Display, Eyebrow, Section } from "@/components/ui";
import { BOARD_URL } from "@/lib/config";

export const dynamic = "force-static";

// Placeholder home. The real one lands last, once the pages it links to exist —
// see the plan's route order.
export default function HomePage() {
  return (
    <Section className="py-20">
      <Eyebrow>Coming together</Eyebrow>
      <Display className="mt-5 max-w-[16ch]">Hockey drills that actually move</Display>
      <p className="mt-6 max-w-[58ch] text-lg text-ink-soft">
        A drill library you can watch, a practice planner that prints, and a
        whiteboard that lives on your phone at the bench.
      </p>
      <div className="mt-9 flex flex-wrap gap-3">
        <Button href="/drills">Browse the library</Button>
        <Button href={BOARD_URL} variant="secondary">Open the board</Button>
        <Button href="/styleguide" variant="secondary">Design system</Button>
      </div>

      <div className="blueprint rink-ratio mt-16 flex items-center justify-center rounded-rink border border-line bg-ice">
        <span className="text-sm text-ink-muted">Drill diagram goes here</span>
      </div>
    </Section>
  );
}
