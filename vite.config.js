import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { themeCss, BOOT_SCRIPT } from "./src/theme.js";
import { I18N_BOOT } from "./src/i18n.js";

// Inline the theme tokens and the language boot into index.html.
// transformIndexHtml runs in the dev middleware AND in build, so there is
// exactly one definition of the palette (src/theme.js) and of the language
// list (src/i18n.js), with no hand-maintained copy that can drift.
//
// All three must land in <head> before <body>: the tokens so the first paint
// has them, and the boot scripts so a persisted override is applied before
// anything is drawn. Both boot scripts are deliberately CLASSIC scripts —
// type="module" is deferred and would run after first paint, reintroducing
// the flash. This is also why src/theme.js and src/i18n.js must stay
// import-free: Node loads them here, at config time, unbundled.
function injectTheme() {
  return {
    name: "inject-theme",
    transformIndexHtml(html) {
      for (const marker of ["<!--theme-css-->", "<!--theme-boot-->", "<!--i18n-boot-->"]) {
        if (!html.includes(marker))
          throw new Error(`index.html is missing the ${marker} marker`);
      }
      return html
        .replace("<!--theme-css-->", `<style>${themeCss()}</style>`)
        .replace("<!--theme-boot-->", `<script>${BOOT_SCRIPT}</script>`)
        .replace("<!--i18n-boot-->", `<script>${I18N_BOOT}</script>`);
    },
  };
}

// copy the standalone drill preview/embed page into the build so it deploys
// alongside the app (served at /drill-board/drill-preview.html) instead of
// living only in the repo where fixes never reach a live URL
function copyPreviewPage() {
  return {
    name: "copy-preview-page",
    closeBundle() {
      copyFileSync(
        resolve(__dirname, "docs/example-drill-preview.html"),
        resolve(__dirname, "dist/drill-preview.html"),
      );
    },
  };
}

// base must match the repo name for GitHub Pages project sites:
// https://snitzer-family.github.io/drill-board/
export default defineConfig({
  plugins: [react(), injectTheme(), copyPreviewPage()],
  base: "/drill-board/",
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
