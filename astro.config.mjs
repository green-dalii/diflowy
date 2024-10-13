import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";
import icon from "astro-icon";
import astroI18next from "astro-i18next";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: "https://diflowy.greenerai.top",
  integrations: [tailwind({
    configFile: "./tailwind.config.mjs"
  }), react(), icon(), sitemap(), astroI18next()],
  security: {
    checkOrigin: true
  },
  output: "static"
});