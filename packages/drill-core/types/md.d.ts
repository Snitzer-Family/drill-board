/** Dependency-free markdown for a small, fixed subset. Escapes first, then
 *  allow-lists link schemes — the output is safe to inject. */
export function mdEscape(s: string): string;
export function mdInline(escaped: string): string;
export function mdBlock(md: string): string;
