import type { Metadata } from "next";
import { Display, Eyebrow, Section } from "@/components/ui";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "About",
  description: "Coach.Vision started as a whiteboard app for one youth hockey team.",
};

export default function AboutPage() {
  return (
    <div className="py-14">
      <Section>
        <Eyebrow>Company</Eyebrow>
        <Display className="mt-4 max-w-[14ch]">Built at the rink</Display>

        <div className="prose-rink mt-8">
          <p>
            Coach.Vision started as a whiteboard app for one youth hockey team,
            built because every other option wanted a laptop, a login, and more
            patience than anyone has at 6:40am with fourteen kids on the ice.
          </p>
          <h2>What it is for</h2>
          <p>
            You get the sheet for fifty minutes. The tool should make those
            minutes go further — not turn practice planning into a second job.
            So the board runs on the phone in your pocket, the drills animate so
            a ten-year-old can see the idea, and the practice plan prints on one
            page you can read from the bench.
          </p>
          <h2>How it is built</h2>
          <p>
            Every drill is plain text, in real rink feet. That is why a drill
            fits in a link, why the diagrams on this site are drawn by the same
            renderer the animator uses, and why nothing you make is locked in a
            format only we can read.
          </p>
        </div>
      </Section>
    </div>
  );
}
