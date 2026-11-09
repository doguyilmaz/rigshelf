import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "rigshelf-prod-site",
    compatibilityDate: "2026-11-09",
    domains: ["rigshelf.doguyilmaz.com"],
    assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "404-page" },
  },
});
