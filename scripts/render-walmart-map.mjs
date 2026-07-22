/**
 * Render public/walmart-grocery-layout-map.svg → PNG via headless Chrome/Edge.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

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
const svgPath = join(root, "public", "walmart-grocery-layout-map.svg");
const outPng = join(root, "public", "walmart-grocery-layout-map.png");
const distDir = join(root, "dist");
const svg = readFileSync(svgPath, "utf8");
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
  html,body{margin:0;padding:0;background:#fff7ed}
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
  copyFileSync(outPng, join(distDir, "walmart-grocery-layout-map.png"));
  copyFileSync(svgPath, join(distDir, "walmart-grocery-layout-map.svg"));
}
console.log("Wrote", outPng);
