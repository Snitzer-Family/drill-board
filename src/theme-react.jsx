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

// Separate from the token context on purpose: this maps a piece's STORED colour
// to what the current theme should actually paint, and it's a function, not a
// token — folding it into ThemeCtx would make useTheme()'s value stop being a
// plain token table (which the contrast test's key-parity check relies on).
// Identity by default, so a theme with no lift table changes nothing.
export const InkCtx = createContext(c => c);
export const useInk = () => useContext(InkCtx);
