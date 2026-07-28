import Link from "next/link";
import type { Route } from "next";
import { Wordmark } from "./Wordmark";
import { BOARD_URL } from "@/lib/config";

const NAV: { href: Route; label: string }[] = [
  { href: "/drills", label: "Drill library" },
  { href: "/planner", label: "Practice planner" },
  { href: "/pricing", label: "Pricing" },
  { href: "/help", label: "Help" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-hair bg-bar/[0.86] backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center gap-8 px-6">
        <Link href="/" className="shrink-0">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <a
            href={BOARD_URL}
            className="hidden text-sm font-medium text-ink-soft transition-colors hover:text-ink sm:inline"
          >
            Open the board
          </a>
          <Link
            href="/login"
            className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-chip bg-accent px-3.5 py-2 text-sm font-semibold text-on-accent"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
