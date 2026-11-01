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
  }), react(), icon(), sitemap({
    // The workflow detail page is only meaningful with a ?id= query string, so
    // the bare /explore/workflow/ URL must not be advertised to crawlers (it is
    // redirected at the edge by functions/_middleware.ts).
    filter: (page) => !/\/explore\/workflow\/?$/.test(new URL(page).pathname),
  }), astroI18next()],
  security: {
    checkOrigin: true
  },
  markdown: {
    shikiConfig: {
      theme: 'dracula',
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      wrap: true
    }
  },
  output: "static"
});