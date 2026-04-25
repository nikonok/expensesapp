#!/usr/bin/env node
// Generates PWA icons from SVG source.
// Run: node scripts/generate-icons.js

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const outDir = path.join(__dirname, "..", "public", "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// App icon SVG — dark background (#0A0B12) + electric cyan "E" (approx oklch 72% 0.22 210)
// Safe-zone content (inner 60%) so it works as a maskable icon on Android adaptive icons.
const svgSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Background fills full bleed for maskable -->
  <rect width="512" height="512" fill="#0A0B12"/>
  <!-- Subtle glow ring (inner 60% safe zone = 154..358) -->
  <rect x="96" y="96" width="320" height="320" rx="64" fill="#111828"/>
  <!-- "E" letterform — three horizontal bars -->
  <!-- Top bar -->
  <rect x="160" y="172" width="192" height="36" rx="10" fill="#00C4D4"/>
  <!-- Middle bar (shorter) -->
  <rect x="160" y="238" width="152" height="36" rx="10" fill="#00C4D4"/>
  <!-- Bottom bar -->
  <rect x="160" y="304" width="192" height="36" rx="10" fill="#00C4D4"/>
  <!-- Vertical stem -->
  <rect x="160" y="172" width="36" height="168" rx="10" fill="#00C4D4"/>
  <!-- Glow overlay -->
  <rect x="96" y="96" width="320" height="320" rx="64" fill="none" stroke="#00C4D4" stroke-width="2" opacity="0.25"/>
</svg>`;

async function generate() {
  const svgBuf = Buffer.from(svgSource);

  await sharp(svgBuf).resize(192, 192).png().toFile(path.join(outDir, "icon-192.png"));
  console.log("✓ icon-192.png");

  await sharp(svgBuf).resize(512, 512).png().toFile(path.join(outDir, "icon-512.png"));
  console.log("✓ icon-512.png");

  console.log("Icons generated successfully.");
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
