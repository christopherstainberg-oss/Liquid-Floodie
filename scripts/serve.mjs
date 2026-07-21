import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT || 5173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer((req, res) => {
  let path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (path === "/") path = "/index.html";
  const file = join(root, path.replace(/^\//, ""));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const type = mime[extname(file)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": path.endsWith("sw.js") ? "no-cache" : "no-store" });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`LiquidFloodie → http://localhost:${port}`));
