import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [],
    exclude: ["**/node_modules/**", "**/e2e/**", "**/.claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // libsodium-wrappers-sumo's ESM build references libsodium-sumo.mjs which
      // is not shipped in the npm package. Force the CJS build in test environments
      // where the WASM binary is bundled into libsodium-wrappers.js.
      "libsodium-wrappers-sumo": path.resolve(
        __dirname,
        "node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js",
      ),
    },
  },
});
