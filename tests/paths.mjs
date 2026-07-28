// The ONE file that knows where source lives. Every suite that reads a file BY
// PATH (rather than importing it) goes through here, so a future layout change
// is a one-file edit instead of a grep-and-pray.
//
// Why src() asserts a minimum size: several drift guards in theme-contrast.mjs
// are "scan this file, assert the bad pattern is absent". Those pass VACUOUSLY
// on an empty or wrong read — a guard that silently stops guarding is worse than
// no guard, because the green tick says otherwise. A missing file or a
// suspiciously small one is a layout bug, so it must throw, loudly, here.

import { existsSync, statSync } from "node:fs";

const R = (p) => new URL(p, import.meta.url);

export const CORE = R("../packages/drill-core/src/");
export const CORE_DOCS = R("../packages/drill-core/docs/");
export const BOARD = R("../apps/board/");
export const WEB = R("../apps/web/");
export const CONTENT = R("../apps/web/content/");
export const ROOT = R("../");

export function src(root, file, minBytes = 200) {
  const u = new URL(file, root);
  if (!existsSync(u))
    throw new Error(`tests/paths.mjs: missing ${u.pathname} — did the layout move?`);
  const n = statSync(u).size;
  if (n < minBytes)
    throw new Error(
      `tests/paths.mjs: ${u.pathname} is ${n}B, expected >= ${minBytes}B — ` +
      `truncated, or the path now points at the wrong file. A drift guard ` +
      `reading this would have passed vacuously.`
    );
  return u;
}
