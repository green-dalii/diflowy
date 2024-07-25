import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";
import auth from "auth-astro";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  site: "https://diflowy.greenerai.top",
  integrations: [tailwind({
    configFile: "./tailwind.config.mjs"
  }), react(), auth()],
  security: {
    checkOrigin: true
  },
  output: "server",
  adapter: cloudflare()
});