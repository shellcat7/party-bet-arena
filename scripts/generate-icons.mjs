/**
 * Renders every PNG icon from public/favicon.svg so the favicon, home-screen icons and the
 * in-app logo are always the same artwork.
 *
 *   node scripts/generate-icons.mjs
 */
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const source = await readFile("public/favicon.svg", "utf8");

/** Full-bleed square (iOS and maskable icons are cropped by the system). */
const square = (svg) => svg.replace(/<rect([^>]*?) rx="\d+"/, "<rect$1");
/** Shrink the mark into the maskable safe zone (the central circle, 80% of the width). */
const safeZone = (svg) =>
  square(svg).replace(/<path /, '<path transform="translate(1024 1024) scale(0.8) translate(-1024 -1024)" ');

const outputs = [
  { file: "public/favicon-16-yellow.png", size: 16, svg: source },
  { file: "public/favicon-32-yellow.png", size: 32, svg: source },
  { file: "public/pwa-192-yellow.png", size: 192, svg: source },
  { file: "public/pwa-512-yellow.png", size: 512, svg: source },
  { file: "public/pwa-maskable-512.png", size: 512, svg: safeZone(source) },
  { file: "public/apple-touch-icon-yellow.png", size: 180, svg: square(source) },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { file, size, svg } of outputs) {
  await page.setViewportSize({ width: size, height: size });
  const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setContent(`<body style="margin:0;background:transparent">${sized}</body>`);
  await page.screenshot({
    path: file,
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  console.log(`saved ${file}`);
}
await browser.close();
