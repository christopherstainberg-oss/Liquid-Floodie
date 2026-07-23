/**
 * LiquidFloodie meal engine
 * - Whole foods only, liquid base required
 * - Dietary restrictions (checkboxes + custom avoid-list) drive meals & grocery
 * - 2–5 add-in ingredients, ≤2 meals/day, 5-day plan
 * - Endless meal variations + step-by-step blend instructions
 */

import { enrichGroceryItem, groceryCostTotals } from "./grocery-nav.js";

/** Preset dietary restriction checkboxes (id → UI + matching rules) */
export const RESTRICTION_PRESETS = [
  {
    id: "milk",
    label: "No Milk / Dairy",
    description: "Blocks milk, cream, cheese, yogurt, and other dairy ingredients.",
    default: true,
  },
  {
    id: "gluten",
    label: "No Gluten",
    description: "Blocks wheat, barley, rye, and other gluten-containing ingredients.",
    default: true,
  },
  {
    id: "egg",
    label: "No Eggs",
    description: "Blocks eggs and egg-based ingredients.",
    default: false,
  },
  {
    id: "nuts",
    label: "No Tree Nuts",
    description: "Blocks almonds, cashews, walnuts, and other tree nuts.",
    default: false,
  },
  {
    id: "peanuts",
    label: "No Peanuts",
    description: "Blocks peanuts and peanut products.",
    default: false,
  },
  {
    id: "shellfish",
    label: "No Shellfish",
    description: "Blocks shrimp, crab, lobster, and similar shellfish.",
    default: false,
  },
  {
    id: "fish",
    label: "No Fish",
    description: "Blocks fish and fish-based ingredients.",
    default: false,
  },
  {
    id: "soy",
    label: "No Soy",
    description: "Blocks tofu, tempeh, edamame, and other soy products.",
    default: false,
  },
  {
    id: "sesame",
    label: "No Sesame",
    description: "Blocks sesame seeds and sesame products.",
    default: false,
  },
  {
    id: "meat",
    label: "No Meat (Vegetarian)",
    description: "Blocks meat, poultry, and bone/meat broths. Eggs and honey still allowed.",
    default: false,
  },
  {
    id: "animal",
    label: "No Animal Products (Vegan)",
    description: "Blocks all animal products: meat, fish, eggs, dairy, honey, and collagen.",
    default: false,
  },
];

export function defaultRestrictions() {
  const r = { custom: [] };
  for (const p of RESTRICTION_PRESETS) r[p.id] = !!p.default;
  return r;
}

export function normalizeRestrictions(raw) {
  const base = defaultRestrictions();
  if (!raw || typeof raw !== "object") return base;
  for (const p of RESTRICTION_PRESETS) {
    if (raw[p.id] != null) base[p.id] = !!raw[p.id];
  }
  // Vegan implies vegetarian + milk + egg + fish + shellfish
  if (base.animal) {
    base.meat = true;
    base.milk = true;
    base.egg = true;
    base.fish = true;
    base.shellfish = true;
  }
  const custom = Array.isArray(raw.custom)
    ? raw.custom
        .map((c) => String(c || "").trim().toLowerCase())
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 20)
    : [];
  base.custom = custom;
  return base;
}

const BANNED_RE =
  /\b(milk|cream|butter|cheese|yogurt|whey|casein|wheat|barley|rye|malt|semolina|durum|spelt|farro|couscous|bread|pasta)\b/i;

const MEAT_RE =
  /\b(chicken|turkey|beef|bison|liver|pork|lamb|meat|bone broth|collagen|shrimp|salmon|cod|fish|seafood)\b/i;
const EGG_RE = /\begg\b/i;
const NUT_RE =
  /\b(almond|cashew|walnut|pecan|macadamia|hazelnut|brazil nut|pine nut|pistachio|tree nut)\b/i;
const PEANUT_RE = /\bpeanut\b/i;
const SHELLFISH_RE = /\b(shrimp|crab|lobster|clam|mussel|oyster|shellfish|scallop|crawfish|crayfish)\b/i;
const FISH_RE = /\b(salmon|cod|fish|tuna|halibut|tilapia|white fish|anchovy|sardine)\b/i;
const SOY_RE = /\b(soy|tofu|tempeh|edamame|soya)\b/i;
const SESAME_RE = /\bsesame\b/i;
const ANIMAL_EXTRA_RE = /\b(honey|bee pollen|collagen|bone broth|egg|milk|cream|cheese|yogurt|whey)\b/i;

/**
 * Infer allergens / diet flags from name + category (catalog may leave allergens empty).
 */
export function enrichIngredient(item) {
  if (!item) return item;
  if (item._enriched) return item;
  // User-authored custom ingredients keep their explicit diet/allergen flags
  if (item.custom) {
    return {
      ...item,
      allergens: [...(item.allergens || [])],
      _enriched: true,
    };
  }
  const name = String(item.name || "").toLowerCase();
  const cat = item.category || "";
  const allergens = new Set(item.allergens || []);
  const flags = {
    milkFree: item.milkFree !== false,
    glutenFree: item.glutenFree !== false,
    eggFree: true,
    nutFree: true,
    peanutFree: true,
    shellfishFree: true,
    fishFree: true,
    soyFree: true,
    sesameFree: true,
    vegetarian: true,
    vegan: true,
  };

  if (BANNED_RE.test(name) && /\b(milk|cream|butter|cheese|yogurt|whey|casein)\b/i.test(name)) {
    allergens.add("milk");
    flags.milkFree = false;
    flags.vegan = false;
  }
  if (BANNED_RE.test(name) && /\b(wheat|barley|rye|malt|semolina|durum|spelt|farro|couscous|bread|pasta)\b/i.test(name)) {
    allergens.add("gluten");
    flags.glutenFree = false;
  }
  if (EGG_RE.test(name)) {
    allergens.add("egg");
    flags.eggFree = false;
    flags.vegan = false;
  }
  // Tree nuts only — seeds (chia, flax, hemp, pumpkin, sunflower) stay allowed under "No Tree Nuts"
  if (NUT_RE.test(name) && !PEANUT_RE.test(name)) {
    allergens.add("tree nut");
    flags.nutFree = false;
  }
  if (PEANUT_RE.test(name)) {
    allergens.add("peanut");
    flags.peanutFree = false;
  }
  if (SHELLFISH_RE.test(name)) {
    allergens.add("shellfish");
    flags.shellfishFree = false;
    flags.fishFree = false;
    flags.vegetarian = false;
    flags.vegan = false;
  }
  if (FISH_RE.test(name) && !SHELLFISH_RE.test(name)) {
    allergens.add("fish");
    flags.fishFree = false;
    flags.vegetarian = false;
    flags.vegan = false;
  }
  if (SOY_RE.test(name)) {
    allergens.add("soy");
    flags.soyFree = false;
  }
  if (SESAME_RE.test(name)) {
    allergens.add("sesame");
    flags.sesameFree = false;
  }
  if (MEAT_RE.test(name) || (cat === "protein" && /chicken|turkey|beef|bison|liver|salmon|fish|shrimp|cod/.test(name))) {
    if (!EGG_RE.test(name) && !/tofu|tempeh/.test(name)) {
      flags.vegetarian = false;
      flags.vegan = false;
      if (FISH_RE.test(name) || SHELLFISH_RE.test(name)) {
        /* already tagged */
      } else {
        allergens.add("meat");
      }
    }
  }
  if (ANIMAL_EXTRA_RE.test(name) || cat === "protein" && !/tofu|tempeh/.test(name)) {
    if (MEAT_RE.test(name) || EGG_RE.test(name) || ANIMAL_EXTRA_RE.test(name)) {
      flags.vegan = false;
    }
  }
  if (/\b(honey|bee pollen)\b/i.test(name)) {
    flags.vegan = false;
  }
  // Bone/meat broths are not vegan/vegetarian
  if (/\b(bone broth|chicken broth|beef broth)\b/i.test(name)) {
    flags.vegetarian = false;
    flags.vegan = false;
    allergens.add("meat");
  }

  const out = {
    ...item,
    allergens: [...allergens],
    milkFree: flags.milkFree && item.milkFree !== false,
    glutenFree: flags.glutenFree && item.glutenFree !== false,
    eggFree: flags.eggFree,
    nutFree: flags.nutFree,
    peanutFree: flags.peanutFree,
    shellfishFree: flags.shellfishFree,
    fishFree: flags.fishFree,
    soyFree: flags.soyFree,
    sesameFree: flags.sesameFree,
    vegetarian: flags.vegetarian,
    vegan: flags.vegan,
    _enriched: true,
  };
  return out;
}

export function passesRestrictions(item, restrictions = defaultRestrictions()) {
  if (!item || item.wholeFood === false) return false;
  const r = normalizeRestrictions(restrictions);
  const enriched = enrichIngredient(item);
  const name = String(enriched.name || "");

  // Always block hard-banned dairy/gluten names from the catalog
  if (BANNED_RE.test(name)) return false;

  if (r.milk) {
    if (enriched.milkFree === false) return false;
    if ((enriched.allergens || []).some((a) => /milk|dairy/i.test(a))) return false;
  }
  if (r.gluten) {
    if (enriched.glutenFree === false) return false;
    if ((enriched.allergens || []).some((a) => /gluten|wheat/i.test(a))) return false;
  }
  if (r.egg) {
    if (enriched.eggFree === false) return false;
    if ((enriched.allergens || []).some((a) => /egg/i.test(a))) return false;
  }
  if (r.nuts) {
    if (enriched.nutFree === false) return false;
    if ((enriched.allergens || []).some((a) => /tree nut|nut/i.test(a) && !/peanut/i.test(a))) return false;
    if (NUT_RE.test(name) && !PEANUT_RE.test(name)) return false;
  }
  if (r.peanuts) {
    if (enriched.peanutFree === false) return false;
    if ((enriched.allergens || []).some((a) => /peanut/i.test(a))) return false;
  }
  if (r.shellfish) {
    if (enriched.shellfishFree === false) return false;
    if ((enriched.allergens || []).some((a) => /shellfish/i.test(a))) return false;
  }
  if (r.fish) {
    if (enriched.fishFree === false) return false;
    if ((enriched.allergens || []).some((a) => /^fish$/i.test(a))) return false;
  }
  if (r.soy) {
    if (enriched.soyFree === false) return false;
    if ((enriched.allergens || []).some((a) => /soy/i.test(a))) return false;
  }
  if (r.sesame) {
    if (enriched.sesameFree === false) return false;
    if ((enriched.allergens || []).some((a) => /sesame/i.test(a))) return false;
  }
  if (r.meat || r.animal) {
    if (enriched.vegetarian === false) return false;
    if ((enriched.allergens || []).some((a) => /meat/i.test(a))) return false;
  }
  if (r.animal) {
    if (enriched.vegan === false) return false;
  }

  // Custom free-text avoid keywords (user-added)
  for (const term of r.custom || []) {
    if (!term) continue;
    if (name.toLowerCase().includes(term)) return false;
    if ((enriched.tags || []).some((t) => String(t).toLowerCase().includes(term))) return false;
    if ((enriched.category || "").toLowerCase().includes(term)) return false;
  }

  return true;
}

export function filterIngredients(all, restrictions, query = "", category = "") {
  const q = (query || "").trim().toLowerCase();
  const r = normalizeRestrictions(restrictions);
  return all.filter((item) => {
    if (!passesRestrictions(item, r)) return false;
    if (category && item.category !== category) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      (item.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  });
}

/** Human-readable summary of active restrictions */
export function restrictionsSummary(restrictions) {
  const r = normalizeRestrictions(restrictions);
  const parts = [];
  for (const p of RESTRICTION_PRESETS) {
    if (r[p.id]) parts.push(p.label);
  }
  for (const c of r.custom || []) parts.push(`No “${c}”`);
  return parts;
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

const SERVING_UNIT_IDS = new Set(["g", "oz", "mL", "L"]);

export const INGREDIENT_CATEGORIES = [
  { id: "base", label: "Bases (Liquid)", icon: "💧" },
  { id: "fruit", label: "Fruit", icon: "🍓" },
  { id: "vegetable", label: "Vegetable", icon: "🥬" },
  { id: "herb", label: "Herb", icon: "🌿" },
  { id: "spice", label: "Spice", icon: "✨" },
  { id: "nut-seed", label: "Nuts & Seeds", icon: "🌰" },
  { id: "legume", label: "Legume", icon: "🫘" },
  { id: "grain", label: "Grain (GF)", icon: "🌾" },
  { id: "protein", label: "Protein", icon: "💪" },
  { id: "other", label: "Other", icon: "🥄" },
];

const CATEGORY_IDS = new Set(INGREDIENT_CATEGORIES.map((c) => c.id));

/**
 * Normalize optional serving size: amount + unit (g | oz | mL | L).
 */
export function normalizeServing(serving) {
  if (!serving || serving.amount == null || serving.amount === "") return null;
  const amount = Number(serving.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Serving size must be a positive number.");
  }
  const unit = String(serving.unit || "g");
  if (!SERVING_UNIT_IDS.has(unit)) {
    throw new Error("Serving unit must be Grams (g), Ounces (oz), Milliliters (mL), or Liters (L).");
  }
  return { amount: Math.round(amount * 1000) / 1000, unit };
}

function numOrZero(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error("Nutrition values must be zero or positive numbers.");
  return Math.round(n * 10) / 10;
}

/**
 * Normalize nutrition payload for a custom ingredient (macros + micros).
 */
export function normalizeIngredientNutrition(input = {}) {
  const microsIn = input.micros && typeof input.micros === "object" ? input.micros : input;
  return {
    calories: numOrZero(input.calories),
    protein: numOrZero(input.protein),
    carbs: numOrZero(input.carbs),
    fat: numOrZero(input.fat),
    fiber: numOrZero(input.fiber),
    waterMl: Math.round(numOrZero(input.waterMl)),
    micros: {
      vitaminA: numOrZero(microsIn.vitaminA ?? input.vitaminA),
      vitaminC: numOrZero(microsIn.vitaminC ?? input.vitaminC),
      vitaminK: numOrZero(microsIn.vitaminK ?? input.vitaminK),
      potassium: numOrZero(microsIn.potassium ?? input.potassium),
      calcium: numOrZero(microsIn.calcium ?? input.calcium),
      iron: numOrZero(microsIn.iron ?? input.iron),
      magnesium: numOrZero(microsIn.magnesium ?? input.magnesium),
      folate: numOrZero(microsIn.folate ?? input.folate),
    },
  };
}

/**
 * Build a user-created ingredient with optional macronutrients & micronutrients.
 * Used in Quick Search, custom meals, meal generation pool, and grocery lists.
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.category
 * @param {string} [opts.icon]
 * @param {object} [opts.nutrition]
 * @param {string[]} [opts.tags]
 * @param {string[]} [opts.allergens]
 * @param {boolean} [opts.milkFree]
 * @param {boolean} [opts.glutenFree]
 * @param {boolean} [opts.eggFree]
 * @param {boolean} [opts.nutFree]
 * @param {boolean} [opts.peanutFree]
 * @param {boolean} [opts.shellfishFree]
 * @param {boolean} [opts.fishFree]
 * @param {boolean} [opts.soyFree]
 * @param {boolean} [opts.sesameFree]
 * @param {boolean} [opts.vegetarian]
 * @param {boolean} [opts.vegan]
 * @param {string} [opts.notes]
 * @param {string} [opts.id] - when updating an existing custom ingredient
 */
export function buildCustomIngredient({
  name,
  category = "other",
  icon = "",
  nutrition = null,
  tags = [],
  allergens = [],
  milkFree = true,
  glutenFree = true,
  eggFree = true,
  nutFree = true,
  peanutFree = true,
  shellfishFree = true,
  fishFree = true,
  soyFree = true,
  sesameFree = true,
  vegetarian = true,
  vegan = true,
  notes = "",
  id = null,
} = {}) {
  const title = String(name || "").trim();
  if (!title) throw new Error("Give your ingredient a name.");
  if (title.length < 2) throw new Error("Ingredient name must be at least 2 characters.");
  if (title.length > 60) throw new Error("Ingredient name must be 60 characters or fewer.");
  const cat = String(category || "other");
  if (!CATEGORY_IDS.has(cat)) throw new Error("Pick a valid ingredient category.");

  const catMeta = INGREDIENT_CATEGORIES.find((c) => c.id === cat);
  const emoji = String(icon || "").trim() || catMeta?.icon || "🥄";
  const nut = normalizeIngredientNutrition(nutrition || {});
  const tagList = Array.isArray(tags)
    ? tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    : [];
  if (!tagList.includes("custom")) tagList.unshift("custom");
  const allergenList = Array.isArray(allergens)
    ? allergens.map((a) => String(a).trim().toLowerCase()).filter(Boolean)
    : [];

  // Align allergen list with free-flags
  if (!milkFree && !allergenList.some((a) => /milk|dairy/.test(a))) allergenList.push("milk");
  if (!glutenFree && !allergenList.some((a) => /gluten|wheat/.test(a))) allergenList.push("gluten");
  if (!eggFree && !allergenList.includes("egg")) allergenList.push("egg");
  if (!nutFree && !allergenList.some((a) => /tree nut|nut/.test(a))) allergenList.push("tree nut");
  if (!peanutFree && !allergenList.includes("peanut")) allergenList.push("peanut");
  if (!shellfishFree && !allergenList.includes("shellfish")) allergenList.push("shellfish");
  if (!fishFree && !allergenList.includes("fish")) allergenList.push("fish");
  if (!soyFree && !allergenList.includes("soy")) allergenList.push("soy");
  if (!sesameFree && !allergenList.includes("sesame")) allergenList.push("sesame");
  if (!vegetarian && !allergenList.includes("meat")) allergenList.push("meat");

  const noteText = String(notes || "").trim().slice(0, 200);
  const itemId =
    id && String(id).startsWith("custom-ing-")
      ? String(id)
      : `custom-ing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: itemId,
    name: title,
    category: cat,
    icon: emoji,
    allergens: [...new Set(allergenList)],
    tags: [...new Set(tagList)],
    milkFree: !!milkFree,
    glutenFree: !!glutenFree,
    eggFree: !!eggFree,
    nutFree: !!nutFree,
    peanutFree: !!peanutFree,
    shellfishFree: !!shellfishFree,
    fishFree: !!fishFree,
    soyFree: !!soyFree,
    sesameFree: !!sesameFree,
    vegetarian: !!vegetarian,
    vegan: !!vegan && !!vegetarian && !!milkFree && !!eggFree,
    wholeFood: true,
    custom: true,
    nutrition: nut,
    notes: noteText || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Merge catalog ingredients with user custom ingredients for runtime use.
 */
export function mergeIngredientDb(catalogDb, customIngredients = []) {
  const custom = (customIngredients || []).filter((i) => i && i.id && i.name);
  const customIds = new Set(custom.map((i) => i.id));
  // Drop any stale custom entries that might have been written into a prior merge
  const baseIngredients = (catalogDb.ingredients || []).filter((i) => !i.custom && !customIds.has(i.id));
  const baseBases = (catalogDb.bases || []).filter((i) => !i.custom && !customIds.has(i.id));
  const customBases = custom.filter((i) => i.category === "base");
  return {
    ...catalogDb,
    ingredients: [...baseIngredients, ...custom],
    bases: [...baseBases, ...customBases],
    count: baseIngredients.length + custom.length,
    customCount: custom.length,
  };
}

/**
 * Build a named custom liquid meal from a liquid base + 2–5 whole-food add-ins.
 * Optional: serving size (g/oz/mL/L), total calories, macros, and micronutrients.
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {object} opts.base
 * @param {object[]} opts.ingredients
 * @param {object} [opts.restrictions]
 * @param {{ amount: number, unit: 'g'|'oz'|'mL'|'L' }} [opts.serving]
 * @param {object} [opts.nutrition] - user totals: calories, protein, carbs, fat, fiber, waterMl, micros{}
 * @param {'user'|'estimated'|null} [opts.nutritionSource]
 */
export function buildCustomMeal({
  name,
  base,
  ingredients,
  restrictions = defaultRestrictions(),
  serving = null,
  nutrition = null,
  nutritionSource = null,
} = {}) {
  const r = normalizeRestrictions(restrictions);
  const title = String(name || "").trim();
  if (!title) throw new Error("Give your meal a name.");
  if (!base || base.category !== "base") throw new Error("Pick a liquid base (water, broth, or juice).");
  if (!passesRestrictions(base, r)) throw new Error("That base does not meet your dietary restrictions.");
  const adds = (ingredients || []).filter(Boolean);
  if (adds.length < 2 || adds.length > 5) {
    throw new Error("Add 2 to 5 whole-food ingredients.");
  }
  for (const item of adds) {
    if (item.category === "base") throw new Error("Add-ins must not be bases — choose produce, herbs, etc.");
    if (!passesRestrictions(item, r)) {
      throw new Error(`“${item.name}” does not meet your dietary restrictions.`);
    }
    if (item.wholeFood === false) throw new Error(`“${item.name}” is not a whole food.`);
  }
  const steps = buildMealSteps(base, adds);
  const servingNorm = serving ? normalizeServing(serving) : null;
  const meal = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    name: title,
    base,
    ingredients: adds,
    variationIndex: 0,
    custom: true,
    createdAt: new Date().toISOString(),
    steps,
    blurb: `Custom blend: ${base.name.toLowerCase()} with ${adds
      .map((i) => i.name.toLowerCase())
      .join(", ")}. Whole foods only — respects your dietary restrictions.`,
  };
  if (servingNorm) meal.serving = servingNorm;
  if (nutrition && typeof nutrition === "object") {
    meal.nutrition = nutrition;
    meal.nutritionSource = nutritionSource === "estimated" ? "estimated" : "user";
    meal.customNutrition = meal.nutritionSource === "user";
  }
  return meal;
}

/** Insert a custom meal into a plan day slot (creates a minimal plan if needed) */
export function addCustomMealToPlan(mealPlan, customMeal, { day = 1, slotIndex = 0 } = {}) {
  const mpd = mealPlan?.mealsPerDay || 2;
  const days = mealPlan?.days || 5;
  let plan = mealPlan;
  if (!plan?.plan?.length) {
    plan = {
      id: `plan-custom-${Date.now()}`,
      createdAt: new Date().toISOString(),
      days,
      mealsPerDay: mpd,
      restrictions: defaultRestrictions(),
      ingredientCount: customMeal.ingredients.length,
      seed: Date.now(),
      rotateOffset: 0,
      plan: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        label: `Day ${i + 1}`,
        meals: [],
      })),
      variationPoolSize: 0,
      endlessCapacity: 0,
    };
  }
  const dayObj = plan.plan.find((d) => d.day === day) || plan.plan[0];
  const slot = Math.min(Math.max(0, slotIndex | 0), Math.max(0, mpd - 1));
  const labeled = {
    ...customMeal,
    slot: slot === 0 ? "Meal 1" : "Meal 2",
  };
  if (!dayObj.meals) dayObj.meals = [];
  if (dayObj.meals[slot]) dayObj.meals[slot] = labeled;
  else {
    while (dayObj.meals.length < slot) {
      dayObj.meals.push(null);
    }
    dayObj.meals[slot] = labeled;
  }
  // compact nulls only if needed — keep length
  dayObj.meals = dayObj.meals.filter(Boolean).slice(0, mpd);
  if (!dayObj.meals.includes(labeled)) {
    if (dayObj.meals.length < mpd) dayObj.meals.push(labeled);
    else dayObj.meals[slot] = labeled;
  }
  return plan;
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
    restrictions = defaultRestrictions(),
    ingredientCount = 3,
    seed = Date.now(),
    preferredIds = [],
    variationIndex = 0,
  } = options;

  const r = normalizeRestrictions(restrictions);
  const count = Math.min(5, Math.max(2, ingredientCount | 0));
  const rng = mulberry32((seed + variationIndex * 9973) >>> 0);

  const bases = (db.bases || db.ingredients.filter((i) => i.category === "base")).filter((b) =>
    passesRestrictions(b, r)
  );
  const pool = db.ingredients
    .filter((i) => i.category !== "base")
    .filter((i) => passesRestrictions(i, r));

  if (!bases.length || pool.length < count) {
    throw new Error("Not enough safe ingredients to build a meal for your dietary restrictions.");
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
  const avoid = restrictionsSummary(r);
  const avoidText = avoid.length ? avoid.join(", ") : "your preferences";

  return {
    id: `meal-${seed}-${variationIndex}-${base.id}`,
    title,
    base,
    ingredients,
    variationIndex,
    steps,
    blurb: `Blend ${base.name.toLowerCase()} with ${ingredients
      .map((i) => i.name.toLowerCase())
      .join(", ")} until smooth. Whole foods only — respects: ${avoidText}.`,
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
    restrictions = defaultRestrictions(),
    ingredientCount = 3,
    preferredIds = [],
    seed = Date.now(),
    rotateOffset = 0,
  } = options;

  const r = normalizeRestrictions(restrictions);
  const mpd = Math.min(2, Math.max(1, mealsPerDay | 0));
  const dayCount = Math.min(14, Math.max(1, days | 0));
  const need = dayCount * mpd;
  // Large pool supports endless rotation without repeating soon
  const variations = generateVariations(
    db,
    { restrictions: r, ingredientCount, preferredIds, seed },
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
    restrictions: { ...r },
    ingredientCount,
    seed,
    rotateOffset,
    plan,
    variationPoolSize: variations.length,
    endlessCapacity: estimateEndlessCapacity(db, ingredientCount),
  };
}

export function rotateMealPlan(existingPlan, db, options = {}) {
  // Advance through endless pool; when exhausted, reseed for a fresh infinite set.
  // Prefer live form/state options so meals/day, ingredient count, and restrictions apply.
  const mealsPerDay = options.mealsPerDay ?? existingPlan.mealsPerDay ?? 2;
  const ingredientCount = options.ingredientCount ?? existingPlan.ingredientCount ?? 3;
  const restrictions = options.restrictions ?? existingPlan.restrictions;
  const pool = existingPlan.variationPoolSize || 250;
  let rotateOffset = (existingPlan.rotateOffset || 0) + (mealsPerDay || 2);
  let seed = existingPlan.seed;
  if (rotateOffset >= pool) {
    rotateOffset = 0;
    seed = (seed + 7919) >>> 0 || Date.now();
  }
  return generateMealPlan(db, {
    days: existingPlan.days,
    mealsPerDay,
    restrictions,
    ingredientCount,
    preferredIds: options.preferredIds || [],
    seed,
    rotateOffset,
  });
}

/**
 * Rotate a single meal in the plan (one slot on one day).
 * Returns a new plan object with that meal replaced.
 */
export function rotateSingleMeal(existingPlan, db, { day, mealIndex = 0, preferredIds = [] } = {}) {
  if (!existingPlan?.plan?.length) throw new Error("No meal plan to rotate.");
  const dayObj = existingPlan.plan.find((d) => d.day === day) || existingPlan.plan[0];
  if (!dayObj?.meals?.length) throw new Error("No meals on that day.");
  const idx = Math.min(Math.max(0, mealIndex | 0), dayObj.meals.length - 1);
  const old = dayObj.meals[idx];
  const seed = ((existingPlan.seed || Date.now()) + day * 1009 + idx * 9176 + Date.now()) >>> 0;
  const planRestrictions = normalizeRestrictions(existingPlan.restrictions || defaultRestrictions());
  const next = generateMeal(db, {
    restrictions: planRestrictions,
    ingredientCount: existingPlan.ingredientCount || old?.ingredients?.length || 3,
    preferredIds,
    seed,
    variationIndex: (old?.variationIndex || 0) + 1 + Math.floor(Math.random() * 50),
  });
  // Avoid identical combo if possible
  let candidate = next;
  for (let attempt = 0; attempt < 12; attempt++) {
    const key = [candidate.base.id, ...candidate.ingredients.map((x) => x.id).sort()].join("|");
    const oldKey = old
      ? [old.base?.id, ...(old.ingredients || []).map((x) => x.id).sort()].join("|")
      : "";
    if (key !== oldKey) break;
    candidate = generateMeal(db, {
      restrictions: planRestrictions,
      ingredientCount: existingPlan.ingredientCount || 3,
      preferredIds,
      seed: (seed + attempt * 3331) >>> 0,
      variationIndex: attempt + 20,
    });
  }
  candidate.slot = old?.slot || (idx === 0 ? "Meal 1" : "Meal 2");
  const plan = structuredClone(existingPlan);
  const target = plan.plan.find((d) => d.day === dayObj.day);
  target.meals[idx] = candidate;
  plan.rotateOffset = (plan.rotateOffset || 0) + 1;
  plan.id = `plan-${plan.seed}-${plan.rotateOffset}-${Date.now()}`;
  return plan;
}

/**
 * Aggregate grocery list for plan.
 * Only includes ingredients that pass the plan's dietary restrictions
 * (defensive filter so grocery always correlates with user restrictions).
 * Each item includes store navigation (Walmart + WinCo) and comparable cost.
 */
export function buildGroceryList(mealPlan) {
  const r = normalizeRestrictions(mealPlan?.restrictions || defaultRestrictions());
  const map = new Map();
  for (const day of mealPlan?.plan || []) {
    for (const meal of day.meals || []) {
      const parts = [meal.base, ...(meal.ingredients || [])];
      for (const item of parts) {
        if (!item) continue;
        if (!passesRestrictions(item, r)) continue;
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
  const raw = [...map.values()].sort((a, b) => {
    if (a.category === b.category) return a.name.localeCompare(b.name);
    return String(a.category).localeCompare(String(b.category));
  });

  const items = raw.map((it) => enrichGroceryItem(it, it.qty));
  const costTotals = groceryCostTotals(items);

  return {
    id: `grocery-${mealPlan?.id || "none"}`,
    planId: mealPlan?.id || null,
    createdAt: new Date().toISOString(),
    restrictions: { ...r },
    restrictionLabels: restrictionsSummary(r),
    items,
    costTotals,
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
    { name: "Walmart search", url: `https://www.walmart.com/search?q=${q}`, kind: "grocery" },
    {
      name: "Walmart South Medford #2069",
      url: "https://www.walmart.com/store/2069-medford-or",
      kind: "grocery",
    },
    {
      name: "WinCo Medford #44",
      url: "https://www.wincofoods.com/stores/winco-foods-medford-44/4734",
      kind: "grocery",
    },
    { name: "Instacart search", url: `https://www.instacart.com/store/search/${q}`, kind: "grocery" },
    { name: "Amazon Fresh search", url: `https://www.amazon.com/s?k=${q}`, kind: "grocery" },
    { name: "Allrecipes search", url: `https://www.allrecipes.com/search?q=${q}`, kind: "recipe" },
  ];
}
