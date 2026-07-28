import { Placeholder } from "@/components/Placeholder";
export const dynamic = "force-static";
export const metadata = { title: "Pricing" };
export default function Page() {
  return (
    <Placeholder eyebrow="Pricing" title="Free for one team">
      Plans, limits and a checkout. Wired to a billing provider later — the
      pricing table itself is local data, so this page stays static and survives
      a billing outage.
    </Placeholder>
  );
}
