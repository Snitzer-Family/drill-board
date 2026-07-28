import type { Metadata, Viewport } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
// Subpaths, not the barrel — see packages/drill-core/src/index.js.
import { themeCss, BOOT_SCRIPT } from "@coachvision/drill-core/theme.js";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

// Archivo carries the display weight. It is a variable grotesk with a real
// width axis, so headlines can be set expanded — athletic and scoreboard-like
// without the Bebas/Anton condensed-sports cliché every hockey site reaches for.
const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-archivo",
});
const body = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
// The DSL is a first-class artifact of this product, so it gets a real code
// face — which doubles as the tabular-numerals face for counts and durations.
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-jetbrains" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://coach.vision"),
  title: {
    default: "Coach.Vision — hockey drills that move",
    template: "%s — Coach.Vision",
  },
  description:
    "An animated drill library, practice planner and whiteboard for hockey coaches. Draw it once, watch it run, hand it to the bench.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e7edf3" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1014" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // BOOT_SCRIPT sets data-theme before React hydrates, so the server markup
      // and the first client render legitimately disagree on that attribute.
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <head>
        {/* The same two strings the board's vite injectTheme() plugin injects,
            from the same source of truth. appShell:false drops overflow:hidden —
            correct for a fixed-inset app, fatal for a document. */}
        <style dangerouslySetInnerHTML={{ __html: themeCss({ appShell: false }) }} />
        {/* Must be a CLASSIC inline script: a module script is deferred past
            first paint and reintroduces the theme flash. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="bg-app font-sans text-ink">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-chip focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
