import Link from "next/link";
import type { Route } from "next";
import { Wordmark } from "./Wordmark";
import { BOARD_URL } from "@/lib/config";
import { SITE_VERSION } from "@/lib/version";

const GROUPS: { title: string; links: { href: Route | string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/drills", label: "Drill library" },
      { href: "/planner", label: "Practice planner" },
      { href: BOARD_URL, label: "The board" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/help", label: "Help desk" },
      { href: "/help/drill-dsl/overview", label: "Drill format" },
      { href: "/help/contact", label: "Contact us" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/privacy", label: "Privacy" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t-2 border-t-ice-blue bg-sunken">
      <div className="mx-auto grid w-full max-w-[1180px] gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-[28ch] text-sm text-ink-muted">
            Drills that move, for coaches who only get the sheet for fifty minutes.
          </p>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              {g.title}
            </h2>
            <ul className="mt-4 space-y-2.5">
              {g.links.map((l) => (
                <li key={l.label}>
                  {l.href.toString().startsWith("http") ? (
                    <a href={l.href.toString()} className="text-sm text-ink-soft hover:text-ink">
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href as Route} className="text-sm text-ink-soft hover:text-ink">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-hair">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs text-ink-faint">
          <span>© {new Date().getFullYear()} Coach.Vision</span>
          {/* Same idea as the board's watermark: the deployed build says which
              build it is, so "did my change ship?" is answerable at a glance. */}
          <span className="tnum font-mono">v{SITE_VERSION}</span>
        </div>
      </div>
    </footer>
  );
}
