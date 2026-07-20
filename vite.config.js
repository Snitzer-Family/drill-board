import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

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
  plugins: [react(), copyPreviewPage()],
  base: "/drill-board/",
  define: {
    // build stamp shown in the app's version watermark (UTC)
    __BUILD_STAMP__: JSON.stringify(
      new Date().toISOString().replace("T", " ").slice(5, 16) + "Z"
    ),
  },
});
