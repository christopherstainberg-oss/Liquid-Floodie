/**
 * Nutrition estimates for whole-food liquid meals.
 * Values are approximate per typical blend portion (educational, not lab-analyzed).
 */

const CAT_DEFAULTS = {
  base: { calories: 15, protein: 0.5, carbs: 3, fat: 0, fiber: 0, waterMl: 280, vitaminA: 20, vitaminC: 5, vitaminK: 2, potassium: 80, calcium: 10, iron: 0.1, magnesium: 8, folate: 5 },
  fruit: { calories: 60, protein: 0.8, carbs: 14, fat: 0.2, fiber: 2.5, waterMl: 40, vitaminA: 40, vitaminC: 25, vitaminK: 5, potassium: 180, calcium: 12, iron: 0.3, magnesium: 12, folate: 15 },
  vegetable: { calories: 30, protein: 1.5, carbs: 5, fat: 0.2, fiber: 2, waterMl: 50, vitaminA: 120, vitaminC: 20, vitaminK: 40, potassium: 200, calcium: 30, iron: 0.8, magnesium: 20, folate: 30 },
  herb: { calories: 5, protein: 0.3, carbs: 0.8, fat: 0.1, fiber: 0.4, waterMl: 5, vitaminA: 50, vitaminC: 8, vitaminK: 30, potassium: 40, calcium: 15, iron: 0.4, magnesium: 5, folate: 10 },
  spice: { calories: 8, protein: 0.2, carbs: 1.5, fat: 0.2, fiber: 0.5, waterMl: 0, vitaminA: 10, vitaminC: 1, vitaminK: 2, potassium: 20, calcium: 10, iron: 0.5, magnesium: 4, folate: 2 },
  "nut-seed": { calories: 120, protein: 4, carbs: 4, fat: 10, fiber: 2.5, waterMl: 5, vitaminA: 2, vitaminC: 0.5, vitaminK: 2, potassium: 100, calcium: 30, iron: 1.2, magnesium: 50, folate: 10 },
  legume: { calories: 90, protein: 6, carbs: 14, fat: 0.5, fiber: 5, waterMl: 30, vitaminA: 5, vitaminC: 2, vitaminK: 5, potassium: 250, calcium: 25, iron: 1.5, magnesium: 30, folate: 80 },
  grain: { calories: 100, protein: 3, carbs: 20, fat: 1, fiber: 2, waterMl: 20, vitaminA: 0, vitaminC: 0, vitaminK: 1, potassium: 80, calcium: 10, iron: 0.8, magnesium: 40, folate: 15 },
  protein: { calories: 110, protein: 16, carbs: 1, fat: 4, fiber: 0, waterMl: 40, vitaminA: 15, vitaminC: 0, vitaminK: 1, potassium: 200, calcium: 15, iron: 1, magnesium: 20, folate: 10 },
  other: { calories: 40, protein: 0.5, carbs: 8, fat: 1, fiber: 0.5, waterMl: 5, vitaminA: 5, vitaminC: 2, vitaminK: 1, potassium: 40, calcium: 10, iron: 0.3, magnesium: 8, folate: 5 },
};

// Named overrides for common bases/items
const NAME_OVERRIDES = {
  water: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, waterMl: 300, vitaminA: 0, vitaminC: 0, vitaminK: 0, potassium: 0, calcium: 0, iron: 0, magnesium: 0, folate: 0 },
  "bone broth": { calories: 40, protein: 8, carbs: 1, fat: 1, fiber: 0, waterMl: 280, potassium: 200, calcium: 10, iron: 0.3, magnesium: 5 },
  "vegetable broth": { calories: 15, protein: 0.5, carbs: 3, fat: 0, fiber: 0, waterMl: 280, potassium: 150, vitaminA: 30 },
  "chicken broth": { calories: 20, protein: 3, carbs: 1, fat: 0.5, fiber: 0, waterMl: 280, potassium: 180 },
  banana: { calories: 90, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6, waterMl: 50, potassium: 360, vitaminC: 9, vitaminB6: 0.4 },
  spinach: { calories: 20, protein: 2.5, carbs: 3, fat: 0.3, fiber: 2, waterMl: 55, vitaminA: 450, vitaminK: 140, iron: 2.5, folate: 100, magnesium: 40 },
  avocado: { calories: 120, protein: 1.5, carbs: 6, fat: 11, fiber: 5, waterMl: 30, potassium: 350, vitaminK: 15, vitaminE: 1.5 },
  "chia seed": { calories: 60, protein: 2, carbs: 5, fat: 4, fiber: 5, waterMl: 5, calcium: 80, magnesium: 40 },
};

function hashName(name) {
  let h = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}

function jitter(base, h, i, pct = 0.12) {
  const f = 1 + (((h >> (i * 3)) & 15) / 15 - 0.5) * 2 * pct;
  return Math.round(base * f * 10) / 10;
}

/** Build nutrition profile for an ingredient */
export function nutritionForItem(item) {
  if (item?.nutrition) return item.nutrition;
  const cat = item?.category || "other";
  const base = { ...(CAT_DEFAULTS[cat] || CAT_DEFAULTS.other) };
  const key = String(item?.name || "")
    .toLowerCase()
    .replace(/^fresh |^organic |^ripe |^cooked /g, "")
    .trim();
  for (const [k, v] of Object.entries(NAME_OVERRIDES)) {
    if (key.includes(k)) Object.assign(base, v);
  }
  const h = hashName(item?.name || item?.id);
  return {
    calories: jitter(base.calories, h, 0),
    protein: jitter(base.protein, h, 1),
    carbs: jitter(base.carbs, h, 2),
    fat: jitter(base.fat, h, 3),
    fiber: jitter(base.fiber, h, 4),
    waterMl: Math.round(jitter(base.waterMl || 0, h, 5, 0.08)),
    micros: {
      vitaminA: jitter(base.vitaminA || 0, h, 6),
      vitaminC: jitter(base.vitaminC || 0, h, 7),
      vitaminK: jitter(base.vitaminK || 0, h, 8),
      potassium: jitter(base.potassium || 0, h, 9),
      calcium: jitter(base.calcium || 0, h, 10),
      iron: jitter(base.iron || 0, h, 11),
      magnesium: jitter(base.magnesium || 0, h, 12),
      folate: jitter(base.folate || 0, h, 13),
    },
  };
}

export function emptyTotals() {
  return {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    waterMl: 0,
    micros: {
      vitaminA: 0,
      vitaminC: 0,
      vitaminK: 0,
      potassium: 0,
      calcium: 0,
      iron: 0,
      magnesium: 0,
      folate: 0,
    },
  };
}

function addNutrition(acc, n) {
  acc.calories += n.calories || 0;
  acc.protein += n.protein || 0;
  acc.carbs += n.carbs || 0;
  acc.fat += n.fat || 0;
  acc.fiber += n.fiber || 0;
  acc.waterMl += n.waterMl || 0;
  const m = n.micros || {};
  for (const k of Object.keys(acc.micros)) {
    acc.micros[k] += m[k] || 0;
  }
  return acc;
}

export function nutritionForMeal(meal) {
  const total = emptyTotals();
  const parts = [meal?.base, ...(meal?.ingredients || [])].filter(Boolean);
  for (const p of parts) addNutrition(total, nutritionForItem(p));
  // Round for display
  return roundTotals(total);
}

export function nutritionForDay(day) {
  const total = emptyTotals();
  for (const meal of day?.meals || []) {
    const n = nutritionForMeal(meal);
    addNutrition(total, { ...n, micros: n.micros });
  }
  return roundTotals(total);
}

export function nutritionForPlan(mealPlan) {
  const byDay = (mealPlan?.plan || []).map((day) => ({
    day: day.day,
    label: day.label,
    nutrition: nutritionForDay(day),
  }));
  const total = emptyTotals();
  for (const d of byDay) addNutrition(total, { ...d.nutrition, micros: d.nutrition.micros });
  return {
    byDay,
    total: roundTotals(total),
    averagePerDay: roundTotals(scaleTotals(total, 1 / Math.max(1, byDay.length))),
  };
}

function scaleTotals(t, factor) {
  const out = emptyTotals();
  out.calories = t.calories * factor;
  out.protein = t.protein * factor;
  out.carbs = t.carbs * factor;
  out.fat = t.fat * factor;
  out.fiber = t.fiber * factor;
  out.waterMl = t.waterMl * factor;
  for (const k of Object.keys(out.micros)) out.micros[k] = t.micros[k] * factor;
  return out;
}

function roundTotals(t) {
  const r = (n) => Math.round(n * 10) / 10;
  return {
    calories: Math.round(t.calories),
    protein: r(t.protein),
    carbs: r(t.carbs),
    fat: r(t.fat),
    fiber: r(t.fiber),
    waterMl: Math.round(t.waterMl),
    micros: {
      vitaminA: r(t.micros.vitaminA),
      vitaminC: r(t.micros.vitaminC),
      vitaminK: r(t.micros.vitaminK),
      potassium: r(t.micros.potassium),
      calcium: r(t.micros.calcium),
      iron: r(t.micros.iron),
      magnesium: r(t.micros.magnesium),
      folate: r(t.micros.folate),
    },
  };
}

/** Default daily goals (customizable in Settings / Nutrients) */
export const DEFAULT_GOALS = {
  calories: 1600,
  protein: 70,
  carbs: 180,
  fat: 50,
  fiber: 28,
  waterMl: 2000,
  micros: {
    vitaminA: 900,
    vitaminC: 90,
    vitaminK: 120,
    potassium: 3400,
    calcium: 1000,
    iron: 18,
    magnesium: 400,
    folate: 400,
  },
};

export const MICRO_LABELS = {
  vitaminA: { name: "Vitamin A", unit: "µg RAE" },
  vitaminC: { name: "Vitamin C", unit: "mg" },
  vitaminK: { name: "Vitamin K", unit: "µg" },
  potassium: { name: "Potassium", unit: "mg" },
  calcium: { name: "Calcium", unit: "mg" },
  iron: { name: "Iron", unit: "mg" },
  magnesium: { name: "Magnesium", unit: "mg" },
  folate: { name: "Folate", unit: "µg" },
};

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
