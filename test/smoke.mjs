/**
 * Smoke tests for LiquidFloodie engine (no browser).
 */
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!existsSync(join(root, "data", "ingredients.js"))) {
  const r = spawnSync(process.execPath, [join(root, "scripts", "generate-ingredients.mjs")], {
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(1);
}

const { INGREDIENT_DB } = await import(pathToFileURL(join(root, "data", "ingredients.js")).href);
const engine = await import(pathToFileURL(join(root, "src", "engine.js")).href);

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok:", msg);
  }
}

assert(INGREDIENT_DB.count >= 1000, `ingredient count >= 1000 (got ${INGREDIENT_DB.count})`);
assert(INGREDIENT_DB.bases?.length >= 5, "has liquid bases");

const banned = INGREDIENT_DB.ingredients.filter((i) =>
  /\b(milk|cheese|wheat|barley|rye)\b/i.test(i.name)
);
assert(banned.length === 0, "no milk/gluten-named ingredients in catalog");

const meal = engine.generateMeal(INGREDIENT_DB, { seed: 1, ingredientCount: 3, variationIndex: 0 });
assert(meal.steps?.length >= 6, `meal has step-by-step instructions (got ${meal.steps?.length})`);
assert(meal.steps.every((s) => s.title && s.text), "each step has title + text");

const plan = engine.generateMealPlan(INGREDIENT_DB, {
  days: 5,
  mealsPerDay: 2,
  ingredientCount: 3,
  restrictions: { milk: true, gluten: true },
  seed: 42,
});
assert(plan.plan.length === 5, "5 day plan");
assert(plan.plan.every((d) => d.meals.length === 2), "2 meals/day");
assert(
  plan.plan.every((d) =>
    d.meals.every((m) => m.ingredients.length >= 2 && m.ingredients.length <= 5 && m.base && m.steps?.length)
  ),
  "each meal has base + 2-5 ingredients + steps"
);

// Endless variations: well beyond the old 100 cap
const vars = engine.generateVariations(INGREDIENT_DB, { seed: 7, ingredientCount: 3 }, 250);
assert(vars.length > 100, `endless variations beyond 100 (got ${vars.length})`);
assert(plan.endlessCapacity > 1000, `endless capacity estimate large (got ${plan.endlessCapacity})`);

const grocery = engine.buildGroceryList(plan);
assert(grocery.items.length > 0, "grocery list non-empty");

const rotated = engine.rotateMealPlan(plan, INGREDIENT_DB);
assert(rotated.rotateOffset !== plan.rotateOffset || rotated.seed !== plan.seed, "rotation changes plan");

const filtered = engine.filterIngredients(INGREDIENT_DB.ingredients, { milk: true, gluten: true }, "spin");
assert(filtered.length > 0, "search finds spinach-related items");

const links = engine.thirdPartyLinks("spinach banana");
assert(links.length >= 3, "third-party integration links present");

const share = engine.planToShareText(plan);
assert(/Step/i.test(share) || /step/i.test(share), "share text includes steps");

const nutrition = await import(pathToFileURL(join(root, "src", "nutrition.js")).href);
const mealNut = nutrition.nutritionForMeal(plan.plan[0].meals[0]);
assert(mealNut.calories > 0, `meal calories > 0 (got ${mealNut.calories})`);
assert(mealNut.protein >= 0 && mealNut.carbs >= 0 && mealNut.fat >= 0, "macros present");
assert(mealNut.fiber >= 0, "fiber present");
assert(mealNut.waterMl >= 0, "water present");
assert(mealNut.micros && mealNut.micros.vitaminC != null, "micronutrients present");
const planNut = nutrition.nutritionForPlan(plan);
assert(planNut.byDay.length === 5, "nutrition by day for plan");
assert(planNut.total.calories > 0, "plan total calories");

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nAll smoke tests passed.");
