import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
export default {
  // The workspace is symlinked into node_modules and Next skips node_modules by
  // default, so drill-core's plain-ESM source would never be compiled.
  transpilePackages: ["@coachvision/drill-core"],
  // Monorepo: trace from the repo root so the standalone output includes files
  // that live outside apps/web.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  typedRoutes: true,
};
