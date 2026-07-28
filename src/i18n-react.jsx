// React delivery for the string lookup. Kept separate from i18n.js so that
// file stays import-free plain ESM (vite.config.js and node tests/*.mjs load
// it directly and must not pull in React) — the same split as
// theme.js / theme-react.jsx.
//
// Why a context at all, when `t` is already in scope for most of the app:
// icons.jsx (PieceIcon, Stepper, DiagPanel) renders outside the shell's
// closure, exactly like it does for the theme tokens.

import { createContext, useContext } from "react";
import { makeT } from "./i18n/index.js";

// Default to English so an out-of-tree render (the ErrorBoundary path, or any
// future subtree mounted outside the provider) can't crash on undefined —
// same rationale as ThemeCtx's dark default.
export const LangCtx = createContext(makeT("en"));
export const useT = () => useContext(LangCtx);
