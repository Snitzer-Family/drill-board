// React delivery for the theme tokens. Kept separate from theme.js so that
// file stays import-free plain ESM (vite.config.js, scripts/*.mjs and
// node tests/*.mjs all load it directly and must not pull in React).
//
// Why a context and not var() in the SVG: presentation attributes silently
// ignore var() and render black, and half the on-ice colours are COMPUTED
// (caseOf spreads a style object, INK is a ternary) rather than literal, so
// there's nothing to put a var() in without restructuring the helpers.

import { createContext, useContext } from "react";
import { THEMES, AUTO_MAP } from "./theme.js";

// Default to dark so an out-of-tree render (the ErrorBoundary path, or any
// future subtree mounted outside the provider) can't crash on undefined.
export const ThemeCtx = createContext(THEMES[AUTO_MAP.dark]);
export const useTheme = () => useContext(ThemeCtx);
