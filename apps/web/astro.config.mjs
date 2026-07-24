import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";
import react from "@astrojs/react";

process.env.LEDGER_ROOT ??= fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  integrations: [react()],
  output: "static",
  site: process.env.SITE_URL,
  base: process.env.BASE_PATH ?? "/",
});
