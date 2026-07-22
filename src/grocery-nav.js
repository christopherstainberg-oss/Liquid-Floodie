/**
 * Store navigation heuristics + comparable unit costs for grocery list items.
 * Aisle maps are educational approximations of common US Walmart / Winco layouts —
 * local stores vary; treat as a shopping-path guide, not an official floor plan.
 */

/** @typedef {"left"|"right"|"center"|"endcap"|"wall"} AisleSide */
/** @typedef {"front"|"halfway"|"back"} AisleDepth */

/**
 * Category → typical department / aisle family for each chain.
 * aisle: display number or department name used on store signage.
 */
const GROCERY_STORE_MAPS = {
  walmart: {
    label: "Walmart",
    note: "Typical Supercenter: produce & bakery on the perimeter; numbered center aisles for dry goods.",
    categories: {
      base: {
        aisle: "Aisle 12–14",
        department: "Beverages / Juice",
        zone: "Center aisles",
        side: "left",
        depth: "halfway",
        tip: "Shelf-stable juices & waters mid-aisle; refrigerated juices on the back dairy wall.",
      },
      fruit: {
        aisle: "Produce",
        department: "Fresh Produce",
        zone: "Perimeter (front/right)",
        side: "right",
        depth: "front",
        tip: "Fresh fruit tables near the entrance; bagged berries in the open cooler cases.",
      },
      vegetable: {
        aisle: "Produce",
        department: "Fresh Produce",
        zone: "Perimeter (front/right)",
        side: "left",
        depth: "halfway",
        tip: "Leafy greens & bagged salads in the misted cooler wall; roots on dry tables mid-produce.",
      },
      herb: {
        aisle: "Produce",
        department: "Fresh Herbs",
        zone: "Perimeter",
        side: "right",
        depth: "back",
        tip: "Clamshell herbs usually next to bagged salads or the organic cooler end.",
      },
      spice: {
        aisle: "Aisle 6–7",
        department: "Spices & Baking",
        zone: "Center aisles",
        side: "right",
        depth: "halfway",
        tip: "McCormick-style racks mid-aisle; bulk spice jars sometimes near Hispanic foods.",
      },
      "nut-seed": {
        aisle: "Aisle 15–16",
        department: "Nuts / Trail Mix / Baking",
        zone: "Center aisles",
        side: "left",
        depth: "front",
        tip: "Snack nuts front of aisle; baking nuts & seeds nearer the baking section end.",
      },
      legume: {
        aisle: "Aisle 8–9",
        department: "Canned & Dry Beans",
        zone: "Center aisles",
        side: "right",
        depth: "halfway",
        tip: "Dry beans mid-shelf; canned beans lower shelves; natural-foods beans in the organic bay.",
      },
      grain: {
        aisle: "Aisle 5–6",
        department: "Rice / Grains / Cereal",
        zone: "Center aisles",
        side: "left",
        depth: "halfway",
        tip: "Rice & gluten-free grains mid-aisle; oats near breakfast / cereal.",
      },
      protein: {
        aisle: "Meat / Deli / Freezer",
        department: "Protein",
        zone: "Perimeter + Freezer",
        side: "wall",
        depth: "back",
        tip: "Fresh meat on the back wall; plant proteins often in the freezer or natural foods aisle.",
      },
      other: {
        aisle: "Aisle 10–11",
        department: "Grocery / Condiments",
        zone: "Center aisles",
        side: "center",
        depth: "halfway",
        tip: "Check natural foods and international sections if not in the main grocery run.",
      },
    },
  },
  winco: {
    label: "WinCo Foods",
    note: "Typical WinCo: large bulk bins, produce on the perimeter, value pricing on center aisles.",
    categories: {
      base: {
        aisle: "Aisle 10–12",
        department: "Beverages",
        zone: "Center aisles",
        side: "right",
        depth: "halfway",
        tip: "Juices mid-aisle; bulk liquid bases sometimes near bulk foods.",
      },
      fruit: {
        aisle: "Produce",
        department: "Fresh Produce",
        zone: "Perimeter (front)",
        side: "left",
        depth: "front",
        tip: "WinCo produce is usually first after entry; bulk dried fruit is in Bulk Foods.",
      },
      vegetable: {
        aisle: "Produce",
        department: "Fresh Produce",
        zone: "Perimeter",
        side: "right",
        depth: "halfway",
        tip: "Value packs on dry tables; bagged greens in the wet cooler wall.",
      },
      herb: {
        aisle: "Produce",
        department: "Fresh Herbs",
        zone: "Perimeter",
        side: "left",
        depth: "back",
        tip: "Near bagged salads; dried herbs also available in bulk spice bins.",
      },
      spice: {
        aisle: "Bulk / Aisle 4–5",
        department: "Bulk Spices & Baking",
        zone: "Bulk + Center",
        side: "center",
        depth: "front",
        tip: "WinCo bulk spice wall is fastest for small amounts; jarred spices in baking aisle.",
      },
      "nut-seed": {
        aisle: "Bulk / Aisle 3–4",
        department: "Bulk Nuts & Seeds",
        zone: "Bulk foods",
        side: "left",
        depth: "halfway",
        tip: "Prefer bulk bins for cost; packaged nuts also in snack aisle.",
      },
      legume: {
        aisle: "Bulk / Aisle 6–7",
        department: "Bulk Beans & Canned",
        zone: "Bulk + Center",
        side: "right",
        depth: "halfway",
        tip: "Dry beans cheap in bulk; canned beans mid-aisle lower shelves.",
      },
      grain: {
        aisle: "Bulk / Aisle 5–6",
        department: "Bulk Grains & Rice",
        zone: "Bulk + Center",
        side: "left",
        depth: "halfway",
        tip: "Oats, rice, and GF grains often cheapest from bulk bins.",
      },
      protein: {
        aisle: "Meat / Freezer",
        department: "Meat & Freezer",
        zone: "Perimeter + Freezer",
        side: "wall",
        depth: "back",
        tip: "Fresh meat back wall; frozen plant proteins in freezer aisles near endcaps.",
      },
      other: {
        aisle: "Aisle 8–9",
        department: "Grocery",
        zone: "Center aisles",
        side: "center",
        depth: "halfway",
        tip: "Scan bulk first, then center grocery for packaged items.",
      },
    },
  },
};

/** Name-keyword overrides (checked before category defaults) */
const GROCERY_NAME_OVERRIDES = [
  { re: /\b(water|sparkling water)\b/i, cat: "base", costMul: 0.3 },
  { re: /\b(broth|stock)\b/i, cat: "base", walmartAisle: "Aisle 9", wincoAisle: "Aisle 8", costMul: 1.1 },
  { re: /\b(juice|coconut water)\b/i, cat: "base", costMul: 1.4 },
  { re: /\b(berry|berries|strawberry|blueberry|raspberry|blackberry)\b/i, zoneDepth: "front", costMul: 1.6 },
  { re: /\b(banana|apple|orange|grape|melon|mango|pineapple)\b/i, zoneDepth: "front", costMul: 0.9 },
  { re: /\b(spinach|kale|lettuce|greens|arugula|chard)\b/i, zoneDepth: "back", side: "wall", costMul: 1.2 },
  { re: /\b(carrot|celery|cucumber|beet|zucchini|squash)\b/i, zoneDepth: "halfway", costMul: 0.85 },
  { re: /\b(ginger|garlic|onion)\b/i, zoneDepth: "front", costMul: 0.7 },
  { re: /\b(frozen)\b/i, walmartAisle: "Frozen Aisle", wincoAisle: "Frozen", zone: "Freezer aisles", costMul: 1.15 },
  { re: /\b(almond|cashew|walnut|pecan|pistachio|chia|flax|hemp|seed)\b/i, costMul: 1.8 },
  { re: /\b(oat|rice|quinoa|millet|buckwheat)\b/i, costMul: 0.95 },
  { re: /\b(bean|lentil|chickpea|pea)\b/i, costMul: 0.75 },
  { re: /\b(chicken|beef|turkey|fish|salmon|shrimp|tofu|tempeh)\b/i, costMul: 2.2 },
];

/** Baseline unit USD by category (approx. produce/grocery portion for one blend use) */
const GROCERY_BASE_UNIT_COST = {
  base: { typical: 1.25, min: 0.5, max: 3.5, unit: "carton/bottle" },
  fruit: { typical: 1.8, min: 0.6, max: 4.5, unit: "lb / pack" },
  vegetable: { typical: 1.4, min: 0.5, max: 3.5, unit: "lb / bunch" },
  herb: { typical: 2.0, min: 1.0, max: 3.5, unit: "pack" },
  spice: { typical: 1.5, min: 0.4, max: 4.0, unit: "jar / bulk scoop" },
  "nut-seed": { typical: 3.5, min: 1.5, max: 8.0, unit: "lb / bag" },
  legume: { typical: 1.2, min: 0.6, max: 2.5, unit: "can / lb dry" },
  grain: { typical: 1.6, min: 0.7, max: 4.0, unit: "lb / bag" },
  protein: { typical: 4.5, min: 2.0, max: 12.0, unit: "lb / pack" },
  other: { typical: 2.0, min: 0.8, max: 5.0, unit: "each" },
};

/** Extra navigation techniques (shown once on grocery header) */
export const NAV_TECHNIQUES = [
  {
    id: "perimeter-first",
    title: "Perimeter first",
    text: "Walk the outer walls (produce → bakery → meat → dairy) before center aisles — most whole foods live on the perimeter.",
  },
  {
    id: "one-way-path",
    title: "One-way aisle path",
    text: "Sort the list by aisle number and shop low → high so you never backtrack the same aisle.",
  },
  {
    id: "left-right-shelf",
    title: "Left / right + halfway",
    text: "Use side (left/right/wall) and depth (front / halfway / back of aisle) to face the correct run before scanning shelves.",
  },
  {
    id: "eye-level",
    title: "Shelf height scan",
    text: "Start eye-level, then one shelf up/down. Value brands are often on lower shelves; premium at eye level.",
  },
  {
    id: "endcaps",
    title: "Endcaps & coolers",
    text: "Check endcaps for sale items, then open coolers last so cold goods stay cold.",
  },
  {
    id: "bulk-winco",
    title: "WinCo bulk shortcut",
    text: "At WinCo, grab a bulk bag first for nuts, grains, beans, and spices — often half the unit cost of packaged.",
  },
  {
    id: "app-locator",
    title: "Store app / staff",
    text: "Walmart app aisle locators and WinCo staff maps beat memory when a remodel moved an aisle overnight.",
  },
  {
    id: "cold-last",
    title: "Cold chain last",
    text: "Shop dry goods → produce → refrigerated → frozen so nothing thaws in the cart.",
  },
];

export const STORE_OPTIONS = [
  { id: "walmart", label: "Walmart" },
  { id: "winco", label: "WinCo" },
];

function stableHash(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickSide(baseSide, name, id) {
  const sides = ["left", "right", "left", "right", "center"];
  if (baseSide === "wall" || baseSide === "endcap") return baseSide;
  const h = stableHash(`${id}|${name}|side`);
  // Bias toward mapped side but allow item-level variation
  if (h % 5 === 0) return sides[h % sides.length];
  return baseSide || sides[h % 2];
}

function pickDepth(baseDepth, name, id) {
  const depths = ["front", "halfway", "back"];
  const h = stableHash(`${id}|${name}|depth`);
  if (baseDepth && h % 4 !== 0) return baseDepth;
  return depths[h % 3];
}

function sideLabel(side) {
  switch (side) {
    case "left":
      return "Left side of aisle";
    case "right":
      return "Right side of aisle";
    case "center":
      return "Center / both sides";
    case "endcap":
      return "Endcap display";
    case "wall":
      return "Outer wall / cooler wall";
    default:
      return "Either side";
  }
}

function depthLabel(depth) {
  switch (depth) {
    case "front":
      return "Front of aisle (entrance end)";
    case "halfway":
      return "Halfway down the aisle";
    case "back":
      return "Back of aisle (far end)";
    default:
      return "Mid-aisle";
  }
}

function matchOverrides(name) {
  const hits = [];
  for (const o of GROCERY_NAME_OVERRIDES) {
    if (o.re.test(name || "")) hits.push(o);
  }
  return hits;
}

function baseCostFor(category) {
  return GROCERY_BASE_UNIT_COST[category] || GROCERY_BASE_UNIT_COST.other;
}

/**
 * Comparable unit cost estimate for one shopping unit of an ingredient.
 * @returns {{ typical: number, min: number, max: number, unit: string, currency: string }}
 */
export function estimateItemCost(item) {
  const cat = item?.category || "other";
  const base = baseCostFor(cat);
  let mul = 1;
  for (const o of matchOverrides(item?.name)) {
    if (o.costMul) mul *= o.costMul;
  }
  // Stable per-item jitter so list totals feel item-specific but deterministic
  const h = stableHash(item?.id || item?.name || "x");
  const jitter = 0.88 + (h % 25) / 100; // 0.88–1.12
  const typical = Math.round(base.typical * mul * jitter * 100) / 100;
  const min = Math.round(base.min * mul * 0.95 * 100) / 100;
  const max = Math.round(base.max * mul * 1.1 * 100) / 100;
  return {
    typical: Math.max(0.25, typical),
    min: Math.max(0.15, Math.min(min, typical)),
    max: Math.max(typical, max),
    unit: base.unit,
    currency: "USD",
  };
}

/**
 * Step-by-step how to walk to a product in a given store.
 * @param {object} ctx
 * @returns {string[]}
 */
function buildDetailedInstructions(ctx) {
  const {
    storeId,
    storeLabel,
    name,
    category,
    aisle,
    department,
    zone,
    side,
    sideLabel: sLabel,
    depth,
    depthLabel: dLabel,
    tip,
  } = ctx;
  const itemName = name || "this item";
  const cat = category || "other";
  const steps = [];

  if (storeId === "winco") {
    steps.push(
      `At WinCo, enter through the main doors and grab a cart (bring reusable bags — WinCo is bag-your-own).`
    );
    if (/produce/i.test(aisle) || cat === "fruit" || cat === "vegetable" || cat === "herb") {
      steps.push(
        `Go first to Produce on the front perimeter (WinCo path ①). Look for ${itemName} on the ${sLabel.toLowerCase()} in the ${dLabel.toLowerCase()}.`
      );
      steps.push(
        `Scan wet cooler walls for bagged greens/herbs and dry tables for fruit/roots. Match department: ${department}.`
      );
    } else if (/bulk/i.test(aisle) || ["spice", "nut-seed", "legume", "grain"].includes(cat)) {
      steps.push(
        `After produce, head to Bulk Foods (WinCo path ② — best prices). Zone: ${zone}.`
      );
      steps.push(
        `Find the ${aisle} bulk / packaged run. Face the ${sLabel.toLowerCase()}, walk to the ${dLabel.toLowerCase()}, then locate ${itemName}.`
      );
      steps.push(
        `If using bulk scoops: use a clean bag, fill with ${itemName}, twist closed, and write the PLU/bin number on the tag.`
      );
    } else if (/meat|deli|seafood/i.test(aisle) || cat === "protein") {
      steps.push(
        `Continue along the perimeter to Meat / Seafood / Freezer (WinCo path late). Department: ${department}.`
      );
      steps.push(
        `On the ${sLabel.toLowerCase()}, check the ${dLabel.toLowerCase()} of the cooler cases for ${itemName}.`
      );
    } else if (/frozen/i.test(aisle)) {
      steps.push(
        `Save frozen for last at WinCo (path ⑥). Go to ${aisle} / freezer wall.`
      );
      steps.push(
        `Open freezers on the ${sLabel.toLowerCase()} near the ${dLabel.toLowerCase()} and pick ${itemName}.`
      );
    } else {
      steps.push(
        `After bulk, enter the center dry aisles (WinCo path ③). Target: ${aisle} — ${department}.`
      );
      steps.push(
        `Enter ${aisle} from the front (entrance end). Stay on the ${sLabel.toLowerCase()} and walk until you reach the ${dLabel.toLowerCase()}.`
      );
      steps.push(
        `Scan shelves eye-level first, then one shelf down for value brands. Pick up ${itemName} (${zone}).`
      );
    }
    if (tip) steps.push(`WinCo tip: ${tip}`);
    steps.push(
      `Cross-check the LiquidFloodie WinCo map: aisle · side · depth should match ${aisle} · ${sLabel} · ${dLabel}.`
    );
    return steps;
  }

  // Walmart Supercenter path
  steps.push(
    `At Walmart, enter the grocery Supercenter doors and grab a cart near the entrance / checkouts.`
  );
  if (/produce/i.test(aisle) || cat === "fruit" || cat === "vegetable" || cat === "herb") {
    steps.push(
      `Start at Produce on the front/right perimeter (Walmart path ①). Department: ${department}.`
    );
    steps.push(
      `For ${itemName}: work the ${sLabel.toLowerCase()} of produce, focusing on the ${dLabel.toLowerCase()} of that section (tables vs misted cooler wall).`
    );
  } else if (/meat|seafood|deli/i.test(aisle) || cat === "protein") {
    steps.push(
      `Walk the outer perimeter to the back wall Meat / Seafood cases (or Deli if prepped). Zone: ${zone}.`
    );
    steps.push(
      `Along the ${sLabel.toLowerCase()}, check the ${dLabel.toLowerCase()} of the protein run for ${itemName}.`
    );
  } else if (/frozen/i.test(aisle)) {
    steps.push(
      `Leave frozen for last (Walmart path ⑥). Go to ${aisle}.`
    );
    steps.push(
      `Use the ${sLabel.toLowerCase()} of the freezer aisle; open doors near the ${dLabel.toLowerCase()} and select ${itemName}.`
    );
  } else if (/dairy|milk/i.test(department) || /dairy/i.test(zone)) {
    steps.push(
      `Head to Dairy coolers on the left/back wall (Walmart path ⑤ — cold late).`
    );
    steps.push(
      `On the ${sLabel.toLowerCase()} cooler wall, scan the ${dLabel.toLowerCase()} of the dairy run for ${itemName}.`
    );
  } else {
    steps.push(
      `From produce, enter the numbered center aisles low→high (Walmart path ②). Target: ${aisle} — ${department}.`
    );
    steps.push(
      `Find aisle signage for ${aisle}. Enter from the FRONT (checkout / entrance end of the aisle).`
    );
    steps.push(
      `Keep to the ${sLabel.toLowerCase()}. Walk toward the ${dLabel.toLowerCase()} of the aisle without crossing early.`
    );
    steps.push(
      `At that depth, scan eye-level shelves first, then lower shelves for value brands. Select ${itemName} in ${zone}.`
    );
    steps.push(
      `Check endcaps at both ends of ${aisle} if the shelf is empty — sale stock often moves to endcaps.`
    );
  }
  if (tip) steps.push(`Walmart tip: ${tip}`);
  steps.push(
    `Optional: confirm location in the Walmart app aisle locator for your store number if this remodel differs.`
  );
  steps.push(
    `Match the LiquidFloodie Walmart map pills: ${aisle} · ${sLabel} · ${dLabel}.`
  );
  return steps;
}

/**
 * Store-specific navigation for one ingredient.
 * @param {object} item
 * @param {"walmart"|"winco"} storeId
 */
export function navigationForItem(item, storeId = "walmart") {
  const store = GROCERY_STORE_MAPS[storeId] || GROCERY_STORE_MAPS.walmart;
  const cat = item?.category || "other";
  const map = store.categories[cat] || store.categories.other;
  const overrides = matchOverrides(item?.name || "");

  let aisle = map.aisle;
  let department = map.department;
  let zone = map.zone;
  let side = map.side;
  let depth = map.depth;
  let tip = map.tip;

  for (const o of overrides) {
    if (storeId === "walmart" && o.walmartAisle) aisle = o.walmartAisle;
    if (storeId === "winco" && o.wincoAisle) aisle = o.wincoAisle;
    if (o.zone) zone = o.zone;
    if (o.side) side = o.side;
    if (o.zoneDepth) depth = o.zoneDepth;
  }

  side = pickSide(side, item?.name, item?.id);
  depth = pickDepth(depth, item?.name, item?.id);

  const sortKey = aisleSortKey(aisle, depth, side, item?.name);
  const sLabel = sideLabel(side);
  const dLabel = depthLabel(depth);

  const detailedSteps = buildDetailedInstructions({
    storeId,
    storeLabel: store.label,
    name: item?.name,
    category: cat,
    aisle,
    department,
    zone,
    side,
    sideLabel: sLabel,
    depth,
    depthLabel: dLabel,
    tip,
  });

  return {
    storeId,
    storeLabel: store.label,
    aisle,
    department,
    zone,
    side,
    sideLabel: sLabel,
    depth,
    depthLabel: dLabel,
    tip,
    sortKey,
    summary: `${aisle} · ${sLabel} · ${dLabel}`,
    detailedSteps,
    /** Single paragraph for export / share */
    instructions: detailedSteps.join(" "),
  };
}

/** Numeric-ish sort so produce first, then aisle numbers, freezer later */
function aisleSortKey(aisle, depth, side, name) {
  const a = String(aisle || "");
  let major = 500;
  if (/produce/i.test(a)) major = 10;
  else if (/bulk/i.test(a)) major = 40;
  else if (/meat|deli/i.test(a)) major = 80;
  else if (/frozen/i.test(a)) major = 90;
  else {
    const m = a.match(/(\d+)/);
    if (m) major = 100 + Number(m[1]);
  }
  const depthOrd = depth === "front" ? 1 : depth === "halfway" ? 2 : 3;
  const sideOrd = side === "left" ? 1 : side === "right" ? 2 : 3;
  const nameOrd = (name || "").toLowerCase();
  return `${String(major).padStart(4, "0")}-${depthOrd}-${sideOrd}-${nameOrd}`;
}

/**
 * Attach navigation (both stores) + cost to a grocery list item.
 * @param {object} item grocery line { id, name, category, qty, ... }
 * @param {number} [qty]
 */
export function enrichGroceryItem(item, qty = item?.qty || 1) {
  const cost = estimateItemCost(item);
  const lineTypical = Math.round(cost.typical * qty * 100) / 100;
  const lineMin = Math.round(cost.min * qty * 100) / 100;
  const lineMax = Math.round(cost.max * qty * 100) / 100;
  const walmart = navigationForItem(item, "walmart");
  const winco = navigationForItem(item, "winco");
  return {
    ...item,
    qty,
    cost: {
      ...cost,
      lineTypical,
      lineMin,
      lineMax,
    },
    nav: {
      walmart,
      winco,
    },
  };
}

/**
 * Totals for a list of enriched items.
 */
export function groceryCostTotals(items = []) {
  let typical = 0;
  let min = 0;
  let max = 0;
  for (const it of items) {
    typical += it.cost?.lineTypical ?? 0;
    min += it.cost?.lineMin ?? 0;
    max += it.cost?.lineMax ?? 0;
  }
  return {
    typical: Math.round(typical * 100) / 100,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    currency: "USD",
    itemCount: items.length,
  };
}

/**
 * Sort enriched items by store path.
 * @param {object[]} items
 * @param {"walmart"|"winco"} storeId
 */
export function sortGroceryByStorePath(items, storeId = "walmart") {
  return [...items].sort((a, b) => {
    const ka = a.nav?.[storeId]?.sortKey || a.name || "";
    const kb = b.nav?.[storeId]?.sortKey || b.name || "";
    return ka.localeCompare(kb);
  });
}

export function storeMeta(storeId) {
  const s = GROCERY_STORE_MAPS[storeId] || GROCERY_STORE_MAPS.walmart;
  return { id: storeId, label: s.label, note: s.note };
}

export function formatMoney(n, currency = "USD") {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}
