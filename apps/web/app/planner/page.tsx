import { Placeholder } from "@/components/Placeholder";
export const dynamic = "force-static";
export const metadata = { title: "Practice planner" };
export default function Page() {
  return (
    <Placeholder eyebrow="Planner" title="Build a practice in ten minutes">
      Drag drills into a timeline, set the clock for each block, and print a
      sheet you can actually read on the bench.
    </Placeholder>
  );
}
