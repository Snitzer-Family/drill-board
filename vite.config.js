import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match the repo name for GitHub Pages project sites:
// https://snitzer-family.github.io/drill-board/
export default defineConfig({
  plugins: [react()],
  base: "/drill-board/",
  define: {
    // build stamp shown in the app's version watermark (UTC)
    __BUILD_STAMP__: JSON.stringify(
      new Date().toISOString().replace("T", " ").slice(5, 16) + "Z"
    ),
  },
});
