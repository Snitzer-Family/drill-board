import Link from "next/link";
import type { Metadata } from "next";
import { Display, Eyebrow, Section } from "@/components/ui";
import { Field, SubmitButton } from "@/components/Field";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Contact us" };

export default function ContactPage() {
  return (
    <div className="py-14">
      <Section>
        <Eyebrow>
          <Link href="/help" className="hover:text-ink">Help desk</Link>
        </Eyebrow>
        <Display className="mt-4 max-w-[14ch]">Talk to a human</Display>
        <p className="mt-5 max-w-[58ch] text-lg text-ink-soft">
          Bugs, drill requests, or a rink layout that doesn't match yours — all
          welcome.
        </p>

        {/* Plain method="post" to a route handler rather than a server action:
            the form then works with JavaScript off, same as the auth forms. */}
        <form action="/api/contact" method="post" className="mt-10 max-w-lg space-y-5">
          <Field label="Your email" name="email" type="email" autoComplete="email" />
          <div>
            <label
              htmlFor="f-message"
              className="block text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-faint"
            >
              Message
            </label>
            <textarea
              id="f-message"
              name="message"
              rows={6}
              required
              className="mt-2 w-full rounded-card border border-line-strong bg-panel px-3.5 py-2.5 text-[0.95rem] text-ink"
            />
          </div>
          <SubmitButton>Send</SubmitButton>
          <p className="text-xs text-ink-muted">
            No mail provider is connected yet, so this is logged rather than
            delivered. It will answer with a 202 saying exactly that.
          </p>
        </form>
      </Section>
    </div>
  );
}
