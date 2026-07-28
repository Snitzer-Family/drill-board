import { Placeholder } from "@/components/Placeholder";
export const dynamic = "force-static";
export const metadata = { title: "Contact us" };
export default function Page() {
  return (
    <Placeholder eyebrow="Help desk" title="Talk to a human">
      A contact form that posts to a server action.
    </Placeholder>
  );
}
