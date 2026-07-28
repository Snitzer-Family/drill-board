import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { Display, Eyebrow } from "@/components/ui";
import { ThemePicker } from "@/components/ThemePicker";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <div>
      <Eyebrow>Account</Eyebrow>
      <Display size="md" className="mt-4">Settings</Display>

      <section className="mt-10 max-w-lg">
        <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Theme
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Applies to the website and the board. They sit on different subdomains,
          so the preference travels in a cookie on <code className="font-mono">.coach.vision</code>{" "}
          as well as local storage.
        </p>
        <div className="mt-4">
          <ThemePicker />
        </div>
      </section>

      <section className="mt-12 max-w-lg">
        <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Units
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Currently <span className="font-mono">{user.prefs.units}</span>. Rink
          coordinates are always real feet internally; this only affects display.
        </p>
      </section>
    </div>
  );
}
