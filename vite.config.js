import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match the repo name for GitHub Pages project sites:
// https://snitzer-family.github.io/drill-board/
export default defineConfig({
  plugins: [react()],
  base: "/drill-board/",
});
