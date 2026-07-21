/**
 * Optional lightweight HTTP API for Docker/Portainer environments.
 * Static PWA still works fully client-side without this process.
 *
 *   node server/index.mjs
 *   PORT=3001 node server/index.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3001);

// Dynamic import of engine + ingredients
const { INGREDIENT_DB } = await import(pathToFileURL(join(root, "data", "ingredients.js")).href);
const engine = await import(pathToFileURL(join(root, "src", "engine.js")).href);

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  if (req.method === "OPTIONS") return json(res, 204, {});

  try {
    if (url.pathname === "/api/health") {
      return json(res, 200, { ok: true, app: "LiquidFloodie", ingredients: INGREDIENT_DB.count });
    }
    if (url.pathname === "/api/ingredients" && req.method === "GET") {
      const q = url.searchParams.get("q") || "";
      const category = url.searchParams.get("category") || "";
      const items = engine.filterIngredients(
        INGREDIENT_DB.ingredients,
        { milk: true, gluten: true },
        q,
        category
      );
      return json(res, 200, { count: items.length, items: items.slice(0, 100) });
    }
    if (url.pathname === "/api/meal-plan/generate" && req.method === "POST") {
      const body = await readBody(req);
      const plan = engine.generateMealPlan(INGREDIENT_DB, body);
      const grocery = engine.buildGroceryList(plan);
      return json(res, 200, { plan, grocery });
    }
    if (url.pathname === "/api/export" && req.method === "POST") {
      const body = await readBody(req);
      return json(res, 200, { app: "LiquidFloodie", version: 1, exportedAt: new Date().toISOString(), state: body.state || body });
    }
    json(res, 404, { error: "Not found" });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
}).listen(port, () => {
  console.log(`LiquidFloodie API → http://localhost:${port}`);
  if (!existsSync(join(root, "data", "ingredients.js"))) {
    console.warn("Run npm run gen:ingredients first.");
  }
});
