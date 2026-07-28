import { Placeholder } from "@/components/Placeholder";
export const dynamic = "force-static";

export function generateStaticParams() {
  return [{ slug: "terms" }, { slug: "privacy" }];
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Placeholder eyebrow="Legal" title={slug === "privacy" ? "Privacy policy" : "Terms of service"}>
      Legal copy lives in content and renders through the same markdown path as
      everything else.
    </Placeholder>
  );
}
