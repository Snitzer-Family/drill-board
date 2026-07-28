import { Placeholder } from "@/components/Placeholder";
export const dynamic = "force-static";
export const metadata = { title: "Sign in" };
export default function Page() {
  return (
    <Placeholder eyebrow="Account" title="Sign in">
      Hand-designed form over a vendor-generic auth interface.
    </Placeholder>
  );
}
