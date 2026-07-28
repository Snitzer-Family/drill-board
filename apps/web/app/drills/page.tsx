import { Placeholder } from "@/components/Placeholder";
export const dynamic = "force-static";
export const metadata = { title: "Drill library" };
export default function Page() {
  return (
    <Placeholder eyebrow="Library" title="Every drill, animated">
      Filterable by zone, age group, skill and length. Each drill gets its own
      page with a rink diagram, coaching notes, what you need, and a link that
      opens it in the board.
    </Placeholder>
  );
}
