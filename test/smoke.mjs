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

const base = INGREDIENT_DB.bases[0];
const adds = INGREDIENT_DB.ingredients.filter((i) => i.category !== "base").slice(0, 3);
const custom = engine.buildCustomMeal({
  name: "Test Garden Blend",
  base,
  ingredients: adds,
  restrictions: { milk: true, gluten: true },
});
assert(custom.title === "Test Garden Blend", "custom meal keeps name");
assert(custom.custom === true, "custom meal flagged");
assert(custom.steps?.length >= 6, "custom meal has steps");
let failedCustom = false;
try {
  engine.buildCustomMeal({ name: "", base, ingredients: adds });
} catch {
  failedCustom = true;
}
assert(failedCustom, "custom meal requires a name");

const customWithNut = engine.buildCustomMeal({
  name: "User Macro Meal",
  base,
  ingredients: adds,
  restrictions: { milk: true, gluten: true },
  serving: { amount: 400, unit: "mL" },
  nutrition: {
    calories: 450,
    protein: 25,
    carbs: 40,
    fat: 15,
    fiber: 10,
    micros: {
      vitaminA: 100,
      vitaminC: 50,
      vitaminK: 20,
      potassium: 600,
      calcium: 200,
      iron: 4,
      magnesium: 80,
      folate: 120,
    },
  },
  nutritionSource: "user",
});
assert(customWithNut.serving?.amount === 400 && customWithNut.serving?.unit === "mL", "custom meal stores serving mL");
assert(customWithNut.nutritionSource === "user", "custom meal marks user nutrition");
assert(customWithNut.customNutrition === true, "customNutrition flag set");
const customNut = nutrition.nutritionForMeal(customWithNut);
assert(customNut.calories === 450, `user calories used (got ${customNut.calories})`);
assert(customNut.protein === 25, "user protein used");
assert(customNut.micros.vitaminC === 50, "user micros used");
assert(customNut.waterMl === 400, "water from mL serving when not set");
assert(nutrition.formatServing(customWithNut.serving) === "400 mL", "formatServing mL");

const ozMeal = engine.buildCustomMeal({
  name: "Oz Serving",
  base,
  ingredients: adds,
  serving: { amount: 12, unit: "oz" },
  nutrition: { calories: 200, protein: 10, carbs: 20, fat: 5, fiber: 3, micros: {} },
  nutritionSource: "user",
});
assert(ozMeal.serving?.unit === "oz", "serving unit ounces");
assert(nutrition.formatServing(ozMeal.serving) === "12 oz", "formatServing oz");

let badServing = false;
try {
  engine.buildCustomMeal({
    name: "Bad Unit",
    base,
    ingredients: adds,
    serving: { amount: 1, unit: "cups" },
  });
} catch {
  badServing = true;
}
assert(badServing, "invalid serving unit rejected");

const userBreak = nutrition.nutritionBreakdownForMeal(customWithNut);
assert(userBreak.userDefined === true, "breakdown marks userDefined");
assert(userBreak.total.calories === 450, "user breakdown total calories");

const rotatedOne = engine.rotateSingleMeal(plan, INGREDIENT_DB, { day: 1, mealIndex: 0 });
assert(rotatedOne.plan[0].meals[0].id !== plan.plan[0].meals[0].id, "single meal rotate changes meal");
assert(rotatedOne.plan[0].meals.length === plan.plan[0].meals.length, "single rotate keeps meal count");

const dayBreak = nutrition.nutritionBreakdownForDay(plan.plan[0]);
assert(dayBreak.total.calories > 0, "day breakdown has calories");
assert(dayBreak.byIngredient.length > 0, "day breakdown has ingredients");
assert(dayBreak.meals.length > 0, "day breakdown has meals");
const mealBreak = nutrition.nutritionBreakdownForMeal(plan.plan[0].meals[0]);
assert(mealBreak.byIngredient.length >= 3, "meal breakdown lists base + ingredients");

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nAll smoke tests passed.");
