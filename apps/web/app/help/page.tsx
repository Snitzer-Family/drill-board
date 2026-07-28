import { Placeholder } from "@/components/Placeholder";
export const dynamic = "force-static";
export const metadata = { title: "Help desk" };
export default function Page() {
  return (
    <Placeholder eyebrow="Help desk" title="Getting unstuck">
      Guides for installing the board on a phone, drawing your first drill, the
      drill format, and billing.
    </Placeholder>
  );
}
