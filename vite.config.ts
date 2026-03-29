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
      registerType: "autoUpdate",
      manifest: {
        name: "Expenses",
        short_name: "Expenses",
        description: "Personal finance tracker",
        start_url: "/",
        scope: "/",
        theme_color: "#0A0B12",
        background_color: "#0A0B12",
        display: "standalone",
        orientation: "portrait",
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
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: {
                maxAgeSeconds: 365 * 24 * 60 * 60,
                maxEntries: 30,
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-stylesheets",
            },
          },
          {
            urlPattern: /^https:\/\/open\.er-api\.com\//i,
            handler: "NetworkFirst",
            options: {
              cacheName: "exchange-rates",
              networkTimeoutSeconds: 5,
              expiration: {
                maxAgeSeconds: 24 * 60 * 60,
                maxEntries: 10,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
