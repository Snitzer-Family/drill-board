import { Placeholder } from "@/components/Placeholder";
export const dynamic = "force-static";
export const metadata = { title: "About" };
export default function Page() {
  return (
    <Placeholder eyebrow="Company" title="Built at the rink">
      Coach.Vision started as a whiteboard app for one youth team.
    </Placeholder>
  );
}
