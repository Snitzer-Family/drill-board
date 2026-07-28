import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { Display, Eyebrow } from "@/components/ui";
import { Field, SubmitButton } from "@/components/Field";
import { allDrills } from "@/lib/content/drills";

export const metadata: Metadata = { title: "New practice plan" };

// The form is real; persistence is not — there is no store behind the stub
// provider yet, so this deliberately shows the shape rather than pretending to
// save. The drill picker reads the real library.
export default async function NewPlanPage() {
  await requireUser();
  const drills = allDrills();

  return (
    <div>
      <Eyebrow>Planner</Eyebrow>
      <Display size="md" className="mt-4">New practice plan</Display>

      <form className="mt-8 max-w-lg space-y-5">
        <Field label="Title" name="title" placeholder="Tuesday — entries and support" />
        <Field label="Team" name="team" placeholder="U12 A" />
        <Field label="Date" name="date" type="date" />

        <fieldset>
          <legend className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Start from a drill
          </legend>
          <ul className="mt-3 space-y-2">
            {drills.map((d) => (
              <li key={d.slug}>
                <label className="flex items-center gap-3 rounded-card border border-line bg-panel px-3.5 py-2.5">
                  <input type="checkbox" name="drills" value={d.slug} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{d.title}</span>
                  <span className="tnum shrink-0 font-mono text-xs text-ink-muted">
                    {d.duration} min
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <SubmitButton>Create plan</SubmitButton>
        <p className="text-xs text-ink-muted">
          Saving needs a database — this form is the shape, not the storage.
        </p>
      </form>
    </div>
  );
}
