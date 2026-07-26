import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { readFileSync } from "fs";

export default defineConfig({
  plugins: [
    // Dev-only: argon2-browser is a UMD module excluded from Vite's pre-bundler
    // (rolldown would convert its require('../dist/argon2.wasm') to a static WASM
    // import that Vite's dev server cannot serve). Without pre-bundling, the raw
    // UMD file evaluated as ESM has no exports. This plugin provides a virtual
    // ESM shim that executes the UMD factory in a fake CJS scope so that
    // `module.exports = factory()` runs. Inside the factory `require` is not in
    // scope, so the Node-only require('../dist/argon2.wasm') branch is skipped and
    // argon2-browser uses its fetch()-based WASM loading path at runtime.
    {
      name: "argon2-browser-dev-esm",
      apply: "serve",
      enforce: "pre",
      resolveId(id: string) {
        if (id === "argon2-browser") return "\0argon2-browser-esm";
        return undefined;
      },
      load(id: string) {
        if (id !== "\0argon2-browser-esm") return undefined;
        let src = readFileSync(
          path.resolve(__dirname, "node_modules/argon2-browser/lib/argon2.js"),
          "utf8",
        );
        // Rewrite relative paths in argon2-browser to absolute URLs so Vite's
        // import-analysis can resolve them from the virtual module context.
        // The Emscripten runtime (`argon2.js`) is needed at runtime; the WASM
        // binary (`argon2.wasm`) is fetched separately by `loadWasmBinary`.
        const argon2DistJs = path.resolve(__dirname, "node_modules/argon2-browser/dist/argon2.js");
        // argon2-browser's loadWasmBinary() uses `global.argon2WasmPath` if set;
        // otherwise it falls back to `'node_modules/argon2-browser/dist/argon2.wasm'`
        // which is a page-relative URL. Since the crypto-demo page is at /dev/...,
        // that resolves to /dev/node_modules/... — a 404. Set an absolute path
        // (leading slash) so Vite's dev server can serve it from the project root.
        //
        // Also set loadArgon2WasmModule on global so argon2-browser's loadWasmModule()
        // uses our absolute import instead of the relative '../dist/argon2.js' path.
        src = src.replace(
          `function loadModule(mem) {`,
          [
            `// Inject absolute paths for dev-server compatibility before any loading.`,
            `(typeof self !== 'undefined' ? self : globalThis).argon2WasmPath =`,
            `  '/node_modules/argon2-browser/dist/argon2.wasm';`,
            `(typeof self !== 'undefined' ? self : globalThis).loadArgon2WasmModule = function() {`,
            `  return import(${JSON.stringify(argon2DistJs)});`,
            `};`,
            `function loadModule(mem) {`,
          ].join("\n"),
        );
        // Replace the original import path so Vite's import-analysis can resolve it
        // from the virtual module context (no real directory → relative path fails).
        src = src.replace(
          `return import('../dist/argon2.js');`,
          `return import(${JSON.stringify(argon2DistJs)});`,
        );
        // `typeof require === 'function'` is false in our wrapped scope (no require
        // in scope), so the require('../dist/argon2.wasm') branch is never taken.
        // But replace the path anyway so Vite's import-analysis doesn't trip on it.
        src = src.replace(`require('../dist/argon2.wasm')`, `Promise.resolve(null)`);
        return [
          `const __m = { exports: {} };`,
          `(function(module, exports) {`,
          src,
          `})(__m, __m.exports);`,
          `const __a = __m.exports;`,
          `export const hash = __a.hash;`,
          `export const verify = __a.verify;`,
          `export const ArgonType = __a.ArgonType;`,
          `export const unloadRuntime = __a.unloadRuntime;`,
          `export default __a;`,
        ].join("\n");
      },
    },
    // Dev-only: inject 'wasm-unsafe-eval' into the <meta http-equiv="CSP"> tag so
    // that argon2-browser (and libsodium) can compile WASM in the dev playground.
    // Browsers intersect HTTP CSP headers with meta-tag CSP, so both must allow
    // 'wasm-unsafe-eval' for WASM compilation to succeed. The production meta tag
    // (index.html) stays tight — this plugin only runs during `vite dev` (apply:
    // "serve") and is a no-op in `vite build`. The server.headers block above
    // provides the matching HTTP header on the dev server side.
    {
      name: "dev-relax-csp-for-wasm",
      apply: "serve",
      transformIndexHtml(html: string) {
        return html.replace(
          /(script-src [^;]*?)'unsafe-inline'/,
          "$1'unsafe-inline' 'wasm-unsafe-eval'",
        );
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // Emit crossorigin="use-credentials" on the manifest <link> so the browser
      // sends cookies when fetching /manifest.webmanifest. Without this the fetch
      // is credential-less; behind Cloudflare Access that gets redirected to the
      // Access login page and blocked by CSP. With credentials, the Access
      // session cookie rides along and the real manifest loads.
      useCredentials: true,
      manifest: {
        name: "Expenses",
        short_name: "Expenses",
        description:
          "Track your income, expenses, and budgets. Dark theme, works offline, no account needed.",
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
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        globIgnores: ["**/screenshots/**"],
      },
    }),
  ],
  optimizeDeps: {
    // argon2-browser's CJS bundle contains `require('../dist/argon2.wasm')` for
    // Node environments. When pre-bundled by rolldown, this becomes a static WASM
    // module import that Vite cannot serve in dev. Excluding it prevents pre-bundling.
    // Vite's dev server serves the raw UMD file, but in ESM context (no module/require)
    // it would have no exports — fixed by the argon2-browser-dev-esm plugin below.
    exclude: ["argon2-browser"],
  },
  server: {
    // Allow WebAssembly compilation in the dev server (needed for libsodium and
    // argon2-browser). 'wasm-unsafe-eval' is required by Chromium to compile WASM
    // via WebAssembly.instantiate / WebAssembly.instantiateStreaming in dev mode.
    headers: {
      "Content-Security-Policy": "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/recharts")) return "recharts";
          if (id.includes("node_modules/xlsx")) return "xlsx";
          if (id.includes("node_modules/@dnd-kit")) return "dnd-kit";
          if (id.includes("node_modules/dexie")) return "dexie";
          if (id.includes("node_modules/date-fns")) return "date-fns";
        },
      },
    },
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
