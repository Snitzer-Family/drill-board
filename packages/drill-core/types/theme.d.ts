// Hand-written and deliberately thin: drill-core stays plain ESM with no build
// step, so these describe the surface apps/web consumes rather than mirroring
// every export. Add to them when the site starts using something new.

export type ThemeName = "light" | "dark" | "sheet" | "barn" | "slate";
export type ThemeTokens = Record<string, string>;

export const THEME_ATTR: "data-theme";
export const THEME_KEY: string;
export const THEME_COOKIE: string;
export const AUTO_MAP: { light: ThemeName; dark: ThemeName };
export const SCHEME: Record<string, string>;
export const THEMES: Record<ThemeName, ThemeTokens>;
export const THEME_ORDER: readonly string[];
export const THEME_LABEL: Record<string, string>;
export const NON_COLOR_TOKENS: readonly string[];
export const PAIRS: readonly { fg: string; bg: string; over?: string; min: number; why: string }[];
export const EXEMPT: readonly { fg: string; bg: string; floor: number }[];
export const BOOT_SCRIPT: string;

/** `appShell: false` drops overflow:hidden — correct for a document, wrong for the board. */
export function themeCss(opts?: { appShell?: boolean }): string;
export function resolveTheme(pref: string | null, prefersDark: boolean): ThemeName;
export function tokens(name: string): ThemeTokens;
export function teamInk(theme: string, stored: string): string;
