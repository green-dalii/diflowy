import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";

import icon from "astro-icon";

// https://astro.build/config
export default defineConfig({
  site: "https://diflowy.greenerai.top",
  integrations: [tailwind({
    configFile: "./tailwind.config.mjs"
  }), react(), icon()],
  security: {
    checkOrigin: true
  },
  output: "static"
});