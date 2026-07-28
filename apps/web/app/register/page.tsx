import { Placeholder } from "@/components/Placeholder";
export const dynamic = "force-static";
export const metadata = { title: "Create an account" };
export default function Page() {
  return (
    <Placeholder eyebrow="Account" title="Create an account">
      Registration, email verification and a coach profile.
    </Placeholder>
  );
}
