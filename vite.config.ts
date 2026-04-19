import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      manifest: {
        name: "Expenses",
        short_name: "Expenses",
        description: "Track your income, expenses, and budgets. Dark theme, works offline, no account needed.",
        start_url: "/",
        scope: "/",
        id: "/",
        theme_color: "#0A0B12",
        background_color: "#0A0B12",
        display: "standalone",
        lang: "en",
        dir: "ltr",
        orientation: "portrait",
        categories: ["finance", "productivity"],
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
        screenshots: [
          {
            src: "/screenshots/screenshot-accounts.png",
            sizes: "1080x1920",
            type: "image/png",
            form_factor: "narrow",
            label: "Accounts overview with total wealth",
          },
          {
            src: "/screenshots/screenshot-transactions.png",
            sizes: "1080x1920",
            type: "image/png",
            form_factor: "narrow",
            label: "Transaction history with daily groups",
          },
          {
            src: "/screenshots/screenshot-overview.png",
            sizes: "1080x1920",
            type: "image/png",
            form_factor: "narrow",
            label: "Spending overview with charts",
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/screenshots/**'],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/recharts')) return 'recharts';
          if (id.includes('node_modules/xlsx')) return 'xlsx';
          if (id.includes('node_modules/@dnd-kit')) return 'dnd-kit';
          if (id.includes('node_modules/dexie')) return 'dexie';
          if (id.includes('node_modules/date-fns')) return 'date-fns';
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
