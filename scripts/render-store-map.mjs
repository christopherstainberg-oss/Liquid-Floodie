/**
 * Render a store layout SVG in public/ to PNG (and copy into dist/).
 * Usage: node scripts/render-store-map.mjs winco
 *        node scripts/render-store-map.mjs walmart
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const store = (process.argv[2] || "winco").toLowerCase();
const base = store === "walmart" ? "walmart-grocery-layout-map" : "winco-grocery-layout-map";

const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chrome = chromeCandidates.find((p) => existsSync(p));
if (!chrome) {
  console.error("Chrome/Edge not found — SVG map is still available.");
  process.exit(0);
}

const puppeteer = require(join(root, "node_modules", "puppeteer-core"));
const svgPath = join(root, "public", `${base}.svg`);
const outPng = join(root, "public", `${base}.png`);
const distDir = join(root, "dist");

if (!existsSync(svgPath)) {
  console.error("Missing", svgPath);
  process.exit(1);
}

const svg = readFileSync(svgPath, "utf8");
const bg = store === "walmart" ? "#fff7ed" : "#f0fdf4";
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
  html,body{margin:0;padding:0;background:${bg}}
  svg{display:block;width:1200px;height:780px}
</style></head><body>${svg}</body></html>`;

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 780, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle0" });
await page.screenshot({
  path: outPng,
  type: "png",
  clip: { x: 0, y: 0, width: 1200, height: 780 },
});
await browser.close();

if (existsSync(distDir)) {
  copyFileSync(outPng, join(distDir, `${base}.png`));
  copyFileSync(svgPath, join(distDir, `${base}.svg`));
}
console.log("Wrote", outPng);
