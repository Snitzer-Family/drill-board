import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Subpath, never the barrel: theme.js has zero imports on purpose so it stays
// loadable as a leaf from a config file. See packages/drill-core/src/index.js.
import { themeCss, BOOT_SCRIPT } from "@coachvision/drill-core/theme.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Inline the theme tokens into index.html. transformIndexHtml runs in the dev
// middleware AND in build, so there is exactly one definition of the palette
// (packages/drill-core/src/theme.js) and no hand-maintained copy that can drift.
//
// Both must land in <head> before <body>: the tokens so the first paint has
// them, and the boot script so a persisted override is applied before anything
// is drawn. The boot script is deliberately a CLASSIC script — type="module"
// is deferred and would run after first paint, reintroducing the flash.
function injectTheme() {
  return {
    name: "inject-theme",
    transformIndexHtml(html) {
      for (const marker of ["<!--theme-css-->", "<!--theme-boot-->"]) {
        if (!html.includes(marker))
          throw new Error(`index.html is missing the ${marker} marker`);
      }
      return html
        .replace("<!--theme-css-->", `<style>${themeCss()}</style>`)
        .replace("<!--theme-boot-->", `<script>${BOOT_SCRIPT}</script>`);
    },
  };
}

// copy the standalone drill preview/embed page into the build so it deploys
// alongside the app (served at /drill-preview.html) instead of living only in
// the repo where fixes never reach a live URL
function copyPreviewPage() {
  return {
    name: "copy-preview-page",
    closeBundle() {
      copyFileSync(
        here("../../packages/drill-core/docs/example-drill-preview.html"),
        here("dist/drill-preview.html"),
      );
    },
  };
}

// The board is served at the ROOT of its own origin (board.coach.vision), so
// base is "/". It is no longer a GitHub Pages project site — don't reintroduce a
// path prefix without changing the Vercel project to match.
export default defineConfig({
  plugins: [react(), injectTheme(), copyPreviewPage()],
  base: "/",
  // ship sourcemaps so the error-boundary overlay shows a readable stack (helps
  // diagnose field crashes from a screenshot instead of minified frames)
  build: { sourcemap: true },
  define: {
    // build stamp shown in the app's version watermark (UTC)
    __BUILD_STAMP__: JSON.stringify(
      new Date().toISOString().replace("T", " ").slice(5, 16) + "Z"
    ),
  },
});
