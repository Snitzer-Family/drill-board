import { Placeholder } from "@/components/Placeholder";
export const dynamic = "force-static";

// generateStaticParams is what makes this build; it reads content/help once the
// content pipeline lands. Until then it emits the routes the nav links to, so a
// dead link is a build failure rather than a 404 someone finds later.
export function generateStaticParams() {
  return [{ category: "drill-dsl", article: "overview" }];
}

export default function Page() {
  return (
    <Placeholder eyebrow="Help desk" title="Article">
      Help articles are markdown files under content/help, rendered with the
      same md.js the board uses for coaching notes.
    </Placeholder>
  );
}
