"use client";

import { useEffect, useState } from "react";
import {
  THEME_ATTR,
  THEME_KEY,
  THEME_ORDER,
  THEME_LABEL,
} from "@coachvision/drill-core/theme.js";

// Writes BOTH stores, deliberately:
//   - localStorage, keyed exactly as the board keys it, so nothing about the
//     board's existing behaviour changes;
//   - a cookie on the parent domain, because coach.vision and
//     board.coach.vision are separate localStorage origins and a preference set
//     here would otherwise not survive the hop to the board.
// BOOT_SCRIPT reads localStorage first and falls back to the cookie.
function persist(pref: string) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* Safari private mode throws on write */
  }
  const host = location.hostname;
  // Only set a Domain on a real registrable domain — "localhost" and a bare
  // *.vercel.app preview would either be rejected or leak across previews.
  const domain = host.endsWith("coach.vision") ? "; Domain=.coach.vision" : "";
  document.cookie = `cv_theme=${encodeURIComponent(pref)}${domain}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function apply(pref: string) {
  const el = document.documentElement;
  if (pref === "auto") el.removeAttribute(THEME_ATTR);
  else el.setAttribute(THEME_ATTR, pref);
}

export function ThemePicker() {
  const [pref, setPref] = useState("auto");

  // Read after mount, never during render: the server has no localStorage, and
  // reading it in render would make the markup mismatch on hydration.
  useEffect(() => {
    try {
      setPref(localStorage.getItem(THEME_KEY) ?? "auto");
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(THEME_ORDER as string[]).map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={pref === t}
          onClick={() => {
            setPref(t);
            persist(t);
            apply(t);
          }}
          className={
            "rounded-chip border px-3 py-1.5 text-xs font-semibold transition-colors " +
            (pref === t
              ? "border-accent bg-accent text-on-accent"
              : "border-line bg-panel text-ink-soft hover:bg-raised")
          }
        >
          {(THEME_LABEL as Record<string, string>)[t] ?? t}
        </button>
      ))}
    </div>
  );
}
