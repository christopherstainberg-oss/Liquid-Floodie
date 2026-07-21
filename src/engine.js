/**
 * LiquidFloodie meal engine
 * - Whole foods only, liquid base required
 * - Default restrictions: milk, gluten
 * - 2–5 add-in ingredients, ≤2 meals/day, 5-day plan
 * - Endless meal variations + step-by-step blend instructions
 */

const BANNED_RE =
  /\b(milk|cream|butter|cheese|yogurt|whey|casein|wheat|barley|rye|malt|semolina|durum|spelt|farro|couscous|bread|pasta)\b/i;

export function passesRestrictions(item, restrictions = { milk: true, gluten: true }) {
  if (!item || !item.wholeFood) return false;
  if (BANNED_RE.test(item.name || "")) return false;
  if (restrictions.milk && (item.allergens || []).some((a) => /milk|dairy/i.test(a))) return false;
  if (restrictions.gluten && (item.allergens || []).some((a) => /gluten|wheat/i.test(a))) return false;
  if (restrictions.milk && item.milkFree === false) return false;
  if (restrictions.gluten && item.glutenFree === false) return false;
  return true;
}

export function filterIngredients(all, restrictions, query = "", category = "") {
  const q = (query || "").trim().toLowerCase();
  return all.filter((item) => {
    if (!passesRestrictions(item, restrictions)) return false;
    if (category && item.category !== category) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      (item.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Step-by-step instructions for creating a liquid meal in a blender */
export function buildMealSteps(base, ingredients) {
  const soft = ingredients.filter((i) =>
    /fruit|vegetable|herb|base/i.test(i.category || "")
  );
  const dense = ingredients.filter((i) => !soft.includes(i));
  const softNames = soft.map((i) => i.name).join(", ") || "soft produce";
  const denseNames = dense.map((i) => i.name).join(", ") || "remaining ingredients";
  const allNames = ingredients.map((i) => i.name).join(", ");

  return [
    {
      n: 1,
      title: "Gather & inspect",
      text: `Collect ${base.name} (liquid base) and whole-food add-ins: ${allNames}. Confirm nothing is processed and everything matches your milk-free / gluten-free rules.`,
    },
    {
      n: 2,
      title: "Wash & prep",
      text: "Rinse produce under cool water. Peel, pit, or core as needed. Cut firm items into 1-inch pieces so the blender can process them smoothly.",
    },
    {
      n: 3,
      title: "Measure the liquid base",
      text: `Pour 8–12 fl oz (about 240–350 ml) of ${base.name} into the blender jar first. Liquid first protects the blades and helps create a vortex.`,
    },
    {
      n: 4,
      title: "Add soft ingredients",
      text: `Add soft items next: ${softNames}. This keeps dense pieces from jamming the blades at the start.`,
    },
    {
      n: 5,
      title: "Add denser ingredients",
      text: `Add denser items last: ${denseNames}. Keep total solid volume below the max-fill line of your blender.`,
    },
    {
      n: 6,
      title: "Blend in stages",
      text: "Start on low for 10–15 seconds, then high for 30–60 seconds until fully smooth. Pause to scrape sides if needed. Add a splash more base only if too thick.",
    },
    {
      n: 7,
      title: "Taste & adjust",
      text: "Taste. Brighten with a squeeze of citrus (if allowed), thin with more base, or thicken with a little extra whole fruit or cooked soft vegetable.",
    },
    {
      n: 8,
      title: "Serve safely",
      text: "Pour into a clean cup and drink soon. Refrigerate leftovers in a sealed container up to 24 hours; re-blend briefly before drinking. Discard if smell or texture changes.",
    },
  ];
}

/**
 * Generate one liquid meal: 1 base + 2–5 ingredients
 */
export function generateMeal(db, options = {}) {
  const {
    restrictions = { milk: true, gluten: true },
    ingredientCount = 3,
    seed = Date.now(),
    preferredIds = [],
    variationIndex = 0,
  } = options;

  const count = Math.min(5, Math.max(2, ingredientCount | 0));
  const rng = mulberry32((seed + variationIndex * 9973) >>> 0);

  const bases = (db.bases || db.ingredients.filter((i) => i.category === "base")).filter((b) =>
    passesRestrictions(b, restrictions)
  );
  const pool = db.ingredients
    .filter((i) => i.category !== "base")
    .filter((i) => passesRestrictions(i, restrictions));

  if (!bases.length || pool.length < count) {
    throw new Error("Not enough safe ingredients to build a meal.");
  }

  const base = pick(rng, bases);
  const preferred = preferredIds
    .map((id) => pool.find((p) => p.id === id))
    .filter(Boolean)
    .slice(0, count);

  const rest = shuffle(
    rng,
    pool.filter((p) => !preferred.some((x) => x.id === p.id))
  );
  const ingredients = [...preferred, ...rest].slice(0, count);

  const nameParts = ingredients.map((i) => i.name).slice(0, 3);
  const title = `${base.name} ${nameParts[0] || "Blend"} Blend`;
  const steps = buildMealSteps(base, ingredients);

  return {
    id: `meal-${seed}-${variationIndex}-${base.id}`,
    title,
    base,
    ingredients,
    variationIndex,
    steps,
    blurb: `Blend ${base.name.toLowerCase()} with ${ingredients
      .map((i) => i.name.toLowerCase())
      .join(", ")} until smooth. Whole foods only — milk-free & gluten-free.`,
  };
}

/**
 * Endless meal variations — generates as many unique combos as requested
 * (practically limited by ingredient pool size, not a fixed 100 cap).
 */
export function generateVariations(db, options = {}, max = 500) {
  const n = Math.max(1, max | 0);
  const seed = options.seed ?? Date.now();
  const seen = new Set();
  const out = [];
  // Try generously; stop when we cannot find more unique combos
  const attempts = Math.min(n * 8, 50000);
  for (let i = 0; i < attempts && out.length < n; i++) {
    const meal = generateMeal(db, { ...options, seed, variationIndex: i });
    const key = [meal.base.id, ...meal.ingredients.map((x) => x.id).sort()].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(meal);
  }
  return out;
}

/** Theoretical combo space size (for UI copy) */
export function estimateEndlessCapacity(db, ingredientCount = 3) {
  const bases = (db.bases || []).length || 1;
  const pool = Math.max(1, (db.ingredients || []).filter((i) => i.category !== "base").length);
  const k = Math.min(5, Math.max(2, ingredientCount | 0));
  // P(pool, k) * bases — rough upper bound
  let p = 1;
  for (let i = 0; i < k; i++) p *= Math.max(1, pool - i);
  return bases * p;
}

/**
 * 5-day plan, ≤2 meals/day
 */
export function generateMealPlan(db, options = {}) {
  const {
    days = 5,
    mealsPerDay = 2,
    restrictions = { milk: true, gluten: true },
    ingredientCount = 3,
    preferredIds = [],
    seed = Date.now(),
    rotateOffset = 0,
  } = options;

  const mpd = Math.min(2, Math.max(1, mealsPerDay | 0));
  const dayCount = Math.min(14, Math.max(1, days | 0));
  const need = dayCount * mpd;
  // Large pool supports endless rotation without repeating soon
  const variations = generateVariations(
    db,
    { restrictions, ingredientCount, preferredIds, seed },
    Math.max(need + 100, 250)
  );

  if (!variations.length) throw new Error("Could not generate meal variations.");

  const plan = [];
  for (let d = 0; d < dayCount; d++) {
    const dayMeals = [];
    for (let m = 0; m < mpd; m++) {
      const idx = (d * mpd + m + rotateOffset) % variations.length;
      dayMeals.push({ ...variations[idx], slot: m === 0 ? "Meal 1" : "Meal 2" });
    }
    plan.push({
      day: d + 1,
      label: `Day ${d + 1}`,
      meals: dayMeals,
    });
  }

  return {
    id: `plan-${seed}-${rotateOffset}`,
    createdAt: new Date().toISOString(),
    days: dayCount,
    mealsPerDay: mpd,
    restrictions: { ...restrictions },
    ingredientCount,
    seed,
    rotateOffset,
    plan,
    variationPoolSize: variations.length,
    endlessCapacity: estimateEndlessCapacity(db, ingredientCount),
  };
}

export function rotateMealPlan(existingPlan, db, options = {}) {
  // Advance through endless pool; when exhausted, reseed for a fresh infinite set
  const pool = existingPlan.variationPoolSize || 250;
  let rotateOffset = (existingPlan.rotateOffset || 0) + (existingPlan.mealsPerDay || 2);
  let seed = existingPlan.seed;
  if (rotateOffset >= pool) {
    rotateOffset = 0;
    seed = (seed + 7919) >>> 0 || Date.now();
  }
  return generateMealPlan(db, {
    days: existingPlan.days,
    mealsPerDay: existingPlan.mealsPerDay,
    restrictions: existingPlan.restrictions,
    ingredientCount: existingPlan.ingredientCount,
    preferredIds: options.preferredIds || [],
    seed,
    rotateOffset,
  });
}

/** Aggregate grocery list for plan */
export function buildGroceryList(mealPlan) {
  const map = new Map();
  for (const day of mealPlan.plan || []) {
    for (const meal of day.meals || []) {
      const parts = [meal.base, ...(meal.ingredients || [])];
      for (const item of parts) {
        if (!item) continue;
        const prev = map.get(item.id) || {
          id: item.id,
          name: item.name,
          category: item.category,
          icon: item.icon,
          qty: 0,
          checked: false,
        };
        prev.qty += 1;
        map.set(item.id, prev);
      }
    }
  }
  const items = [...map.values()].sort((a, b) => {
    if (a.category === b.category) return a.name.localeCompare(b.name);
    return String(a.category).localeCompare(String(b.category));
  });
  return {
    id: `grocery-${mealPlan.id}`,
    planId: mealPlan.id,
    createdAt: new Date().toISOString(),
    items,
  };
}

export function mealToShareText(meal) {
  const steps = (meal.steps || [])
    .map((s) => `${s.n}. ${s.title}: ${s.text}`)
    .join("\n");
  return `${meal.title}\nBase: ${meal.base.name}\nAdd-ins: ${meal.ingredients
    .map((i) => i.name)
    .join(", ")}\n${meal.blurb}\n\nStep-by-step:\n${steps}`;
}

export function planToShareText(mealPlan) {
  const lines = [
    "LiquidFloodie — 5-Day Liquid Meal Plan",
    "Whole-Food Liquid Meals While Maintaining Dietary Restrictions",
    "",
  ];
  for (const day of mealPlan.plan || []) {
    lines.push(day.label);
    for (const m of day.meals) {
      lines.push(`  • ${m.slot}: ${m.title}`);
      lines.push(`    ${m.base.name} + ${m.ingredients.map((i) => i.name).join(", ")}`);
      if (m.steps?.length) {
        lines.push("    Steps:");
        for (const s of m.steps) lines.push(`      ${s.n}. ${s.title} — ${s.text}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Third-party grocery / recipe deep links (open in new tab) */
export function thirdPartyLinks(query) {
  const q = encodeURIComponent(query || "whole food smoothie ingredients");
  return [
    { name: "Instacart search", url: `https://www.instacart.com/store/search/${q}`, kind: "grocery" },
    { name: "Amazon Fresh search", url: `https://www.amazon.com/s?k=${q}`, kind: "grocery" },
    { name: "Allrecipes search", url: `https://www.allrecipes.com/search?q=${q}`, kind: "recipe" },
    { name: "Simply Recipes search", url: `https://www.simplyrecipes.com/search?q=${q}`, kind: "recipe" },
  ];
}
