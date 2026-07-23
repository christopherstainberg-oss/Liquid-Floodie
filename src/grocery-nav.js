/**
 * Store navigation heuristics + comparable unit costs for grocery list items.
 *
 * Tuned for Medford, OR:
 *   • Walmart Supercenter #2069 — 1360 Center Dr (South Medford)
 *   • Walmart Supercenter #5839 — Crater Lake Hwy (north Medford)
 *   • WinCo Foods #44 — 251 E Barnett Rd
 *
 * Aisle numbers are educational approximations of Pacific NW Supercenter / WinCo
 * grocery layouts. Confirm with the Walmart app aisle locator or WinCo staff
 * after remodels — treat as a shopping-path guide, not an official floor plan.
 */

/** @typedef {"left"|"right"|"center"|"endcap"|"wall"} AisleSide */
/** @typedef {"front"|"halfway"|"back"} AisleDepth */

/**
 * Bump when aisle maps / overrides change so saved grocery lists re-enrich.
 * Checked by app ensureGroceryEnriched().
 */
export const NAV_DATA_VERSION = 2;

/**
 * Category → typical department / aisle family for each Medford chain.
 * aisle: display number or department name used on store signage / our maps.
 */
const GROCERY_STORE_MAPS = {
  walmart: {
    label: "Walmart (Medford)",
    shortLabel: "Walmart",
    note:
      "Medford Supercenters: #2069 South (1360 Center Dr) & #5839 Crater Lake Hwy. Grocery is perimeter + numbered center aisles; use the Walmart app map in-store for exact bay numbers.",
    city: "Medford, OR",
    locations: [
      {
        id: "2069",
        name: "South Medford Supercenter #2069",
        address: "1360 Center Dr, Medford, OR 97501",
        phone: "541-772-2060",
        url: "https://www.walmart.com/store/2069-medford-or",
      },
      {
        id: "5839",
        name: "Crater Lake Hwy Supercenter #5839",
        address: "Medford, OR (Crater Lake Hwy)",
        url: "https://www.walmart.com/store/5839-medford-or",
      },
    ],
    categories: {
      base: {
        aisle: "Aisle 12–14",
        department: "Beverages / Juice",
        zone: "Center aisles (grocery)",
        side: "left",
        depth: "halfway",
        tip: "Medford Supercenters: shelf-stable juices & waters mid A12–14; refrigerated juices & coconut water on the dairy cooler wall (shop cold late).",
      },
      fruit: {
        aisle: "Produce",
        department: "Fresh Produce",
        zone: "Perimeter (front grocery entrance)",
        side: "right",
        depth: "front",
        tip: "Fruit tables near the grocery entrance; bagged berries in open coolers; tropical/citrus mid-produce. Frozen fruit is in Freezer (last).",
      },
      vegetable: {
        aisle: "Produce",
        department: "Fresh Produce",
        zone: "Perimeter (front grocery)",
        side: "left",
        depth: "halfway",
        tip: "Leafy greens & bagged salads on the misted cooler wall; roots & aromatics on dry tables mid-produce.",
      },
      herb: {
        aisle: "Produce",
        department: "Fresh Herbs",
        zone: "Perimeter produce coolers",
        side: "right",
        depth: "back",
        tip: "Clamshell herbs next to bagged salads / organic cooler end. Dried herbs also in Spices A6–7.",
      },
      spice: {
        aisle: "Aisle 6–7",
        department: "Spices & Baking",
        zone: "Center aisles",
        side: "right",
        depth: "halfway",
        tip: "McCormick-style racks mid-aisle; Hispanic/international spices often one bay over in A17–18 natural/international.",
      },
      "nut-seed": {
        aisle: "Aisle 15–16",
        department: "Nuts / Seeds / Trail Mix",
        zone: "Center aisles",
        side: "left",
        depth: "front",
        tip: "Snack nuts & seeds front of A15–16; baking nuts nearer A3–4 baking. Natural-foods bulk-style jars sometimes in A17–18.",
      },
      legume: {
        aisle: "Aisle 8–9",
        department: "Canned & Dry Beans",
        zone: "Center aisles",
        side: "right",
        depth: "halfway",
        tip: "Dry beans mid-shelf; canned beans lower shelves; organic beans often in A17–18 natural bay.",
      },
      grain: {
        aisle: "Aisle 5–6",
        department: "Rice / Grains / Pasta",
        zone: "Center aisles",
        side: "left",
        depth: "halfway",
        tip: "Rice, quinoa, millet mid A5–6; certified GF oats often with cereal in A1–2 breakfast.",
      },
      protein: {
        aisle: "Meat / Deli / Freezer",
        department: "Protein",
        zone: "Back perimeter + Freezer",
        side: "wall",
        depth: "back",
        tip: "Fresh meat/seafood on the back wall; tofu & plant proteins in the natural cooler or freezer near the meat wall.",
      },
      other: {
        aisle: "Aisle 10–11",
        department: "Condiments / Oils / Sauces",
        zone: "Center aisles",
        side: "center",
        depth: "halfway",
        tip: "Oils, vinegars, sauces mid A10–11; check natural foods A17–18 if not on the main run.",
      },
    },
  },
  winco: {
    label: "WinCo (Medford)",
    shortLabel: "WinCo",
    note:
      "WinCo Foods #44 — 251 E Barnett Rd, Medford, OR 97501 (24 hrs; bulk foods desk hours may differ). Bring bags (bag-your-own). Hit Bulk early for nuts, grains, beans, and spices.",
    city: "Medford, OR",
    locations: [
      {
        id: "44",
        name: "WinCo Foods Medford #44",
        address: "251 E Barnett Rd, Medford, OR 97501",
        phone: "541-245-3555",
        url: "https://www.wincofoods.com/stores/winco-foods-medford-44/4734",
      },
    ],
    categories: {
      base: {
        aisle: "Aisle 10–12",
        department: "Beverages",
        zone: "Center aisles",
        side: "right",
        depth: "halfway",
        tip: "Barnett Rd WinCo: shelf-stable juices & waters A10–12; chilled juices near dairy. Some liquid bases also near bulk.",
      },
      fruit: {
        aisle: "Produce",
        department: "Fresh Produce",
        zone: "Perimeter (front after entry)",
        side: "left",
        depth: "front",
        tip: "Produce is usually first after entry. Bulk dried fruit is in Bulk Foods (path ②) — often cheaper than packaged.",
      },
      vegetable: {
        aisle: "Produce",
        department: "Fresh Produce",
        zone: "Perimeter",
        side: "right",
        depth: "halfway",
        tip: "Value packs on dry tables; bagged greens on the wet cooler wall. Aromatics (garlic/onion/ginger) near the front of produce.",
      },
      herb: {
        aisle: "Produce",
        department: "Fresh Herbs",
        zone: "Perimeter produce",
        side: "left",
        depth: "back",
        tip: "Fresh clamshells near bagged salads; dried herbs cheapest on the bulk spice wall.",
      },
      spice: {
        aisle: "Bulk / Aisle 4–5",
        department: "Bulk Spices & Baking",
        zone: "Bulk + Center",
        side: "center",
        depth: "front",
        tip: "Medford WinCo bulk spice wall is fastest for small amounts; jarred spices in baking A4–5 if you need a full bottle.",
      },
      "nut-seed": {
        aisle: "Bulk / Aisle 3–4",
        department: "Bulk Nuts & Seeds",
        zone: "Bulk foods",
        side: "left",
        depth: "halfway",
        tip: "Prefer bulk bins for almonds, chia, flax, hemp — often half packaged price. Packaged nuts also in snack A3–4.",
      },
      legume: {
        aisle: "Bulk / Aisle 6–7",
        department: "Bulk Beans & Canned",
        zone: "Bulk + Center",
        side: "right",
        depth: "halfway",
        tip: "Dry beans & lentils cheapest in bulk; canned beans mid A6–7 lower shelves.",
      },
      grain: {
        aisle: "Bulk / Aisle 5–6",
        department: "Bulk Grains & Rice",
        zone: "Bulk + Center",
        side: "left",
        depth: "halfway",
        tip: "Oats, rice, quinoa, and GF grains often cheapest from bulk bins; packaged cereal/rice in A5–6.",
      },
      protein: {
        aisle: "Meat / Freezer",
        department: "Meat & Freezer",
        zone: "Perimeter + Freezer",
        side: "wall",
        depth: "back",
        tip: "Fresh meat back wall; frozen plant proteins in freezer aisles near endcaps. Shop protein late with cold chain.",
      },
      other: {
        aisle: "Aisle 8–9",
        department: "Grocery / Condiments",
        zone: "Center aisles",
        side: "center",
        depth: "halfway",
        tip: "Scan bulk first, then A8–9 for oils, sauces, and packaged pantry items.",
      },
    },
  },
};

/**
 * Name-keyword overrides (checked before category defaults).
 * Order matters: more specific patterns first.
 * Optional fields: walmartAisle, wincoAisle, department, zone, side, zoneDepth,
 *   walmartSide, wincoSide, walmartDepth, wincoDepth, walmartTip, wincoTip, tip, costMul
 */
const GROCERY_NAME_OVERRIDES = [
  // —— Liquids / bases (specific names before generic “water”) ——
  {
    re: /\b(coconut water)\b/i,
    cat: "base",
    walmartAisle: "Aisle 12–14 / Dairy wall",
    wincoAisle: "Aisle 10–12 / Dairy",
    department: "Beverages · chilled coconut water",
    zone: "Beverages + dairy coolers",
    side: "left",
    zoneDepth: "back",
    walmartTip: "Shelf-stable coconut water mid beverages; chilled cartons on dairy/juice cooler wall.",
    wincoTip: "Shelf-stable mid A10–12; chilled near juice/dairy for better price on multi-packs.",
    costMul: 1.5,
  },
  {
    re: /\b(broth|stock)\b/i,
    cat: "base",
    walmartAisle: "Aisle 8–9",
    wincoAisle: "Aisle 8",
    department: "Soup / Broth / Stock",
    zone: "Center aisles (soup)",
    side: "right",
    zoneDepth: "halfway",
    walmartTip: "Bone & veggie broth cartons mid A8–9 with canned soups; low-sodium on lower shelves.",
    wincoTip: "Broth cartons A8 near soup; check bulk if powdered bases are stocked.",
    costMul: 1.1,
  },
  {
    re: /\b(sparkling water|cucumber water)\b|(?<!coconut )water\b/i,
    cat: "base",
    walmartAisle: "Aisle 12–14",
    wincoAisle: "Aisle 10–12",
    department: "Beverages / Water",
    side: "left",
    zoneDepth: "front",
    walmartTip: "Medford Walmart: bottled water front of A12–14 near endcaps; gallon jugs lower shelves.",
    wincoTip: "WinCo Barnett: water multi-packs A10–12; often cheapest by the case near beverage endcaps.",
    costMul: 0.3,
  },
  {
    re: /\b(juice|carrot juice|celery juice|beet juice|watermelon juice|pomegranate juice|apple juice|orange juice|grape juice)\b/i,
    cat: "base",
    walmartAisle: "Aisle 12–14 / Dairy wall",
    wincoAisle: "Aisle 10–12 / Dairy",
    department: "Juice · shelf-stable & chilled",
    zone: "Beverages + dairy coolers",
    side: "right",
    zoneDepth: "halfway",
    walmartTip: "Shelf-stable juice A12–14; refrigerated not-from-concentrate on the dairy cooler wall (cold last).",
    wincoTip: "Shelf-stable A10–12; chilled juice near dairy. Fresh-pressed style often in produce cooler end.",
    costMul: 1.4,
  },

  // —— Frozen (must stay before fresh produce keywords so “Frozen Blueberry” stays in freezer) ——
  {
    re: /\b(frozen berry|frozen berries|frozen fruit|frozen spinach|frozen kale|frozen mango|frozen peach|frozen)\b/i,
    walmartAisle: "Frozen Aisle",
    wincoAisle: "Frozen",
    department: "Frozen fruit & vegetables",
    zone: "Freezer aisles (shop last)",
    side: "left",
    zoneDepth: "halfway",
    walmartTip: "Medford Supercenter freezers: fruit/veg mid frozen run; leave until last so nothing thaws.",
    wincoTip: "Frozen fruit/veg near freezer wall endcaps — last stop before checkout.",
    costMul: 1.15,
  },

  // —— Produce: fruit subtypes ——
  {
    re: /\b(berry|berries|strawberry|blueberry|raspberry|blackberry|cranberry|goji|acai|elderberry|boysenberry|mulberry|gooseberry)\b/i,
    zoneDepth: "front",
    side: "wall",
    department: "Produce · berries",
    walmartTip: "Open berry coolers near front of produce; check dates and avoid crushed packs.",
    wincoTip: "Berry coolers front of produce; bulk dried berries in Bulk if fresh is pricey.",
    costMul: 1.6,
  },
  {
    re: /\b(banana|plantain)\b/i,
    zoneDepth: "front",
    side: "center",
    department: "Produce · bananas",
    walmartTip: "Banana tables usually first thing in produce near the entrance path.",
    wincoTip: "Banana tables near produce entrance — often the best per-pound deal.",
    costMul: 0.7,
  },
  {
    re: /\b(apple|pear|peach|nectarine|plum|apricot|cherry)\b/i,
    zoneDepth: "front",
    side: "left",
    department: "Produce · tree fruit",
    costMul: 0.95,
  },
  {
    re: /\b(orange|tangerine|clementine|grapefruit|lemon|lime|kumquat|blood orange)\b/i,
    zoneDepth: "halfway",
    side: "right",
    department: "Produce · citrus",
    walmartTip: "Citrus bins mid-produce; bagged lemons/limes lower shelves of the citrus bay.",
    wincoTip: "Citrus bins mid-produce; bulk bags often cheaper than singles.",
    costMul: 0.9,
  },
  {
    re: /\b(mango|pineapple|papaya|kiwi|dragon fruit|passion fruit|guava|lychee|starfruit|jackfruit|rambutan|longan|persimmon|fig|date|pomegranate|coconut meat|avocado)\b/i,
    zoneDepth: "halfway",
    side: "right",
    department: "Produce · tropical / specialty",
    costMul: 1.3,
  },
  {
    re: /\b(watermelon|cantaloupe|honeydew|melon)\b/i,
    zoneDepth: "front",
    side: "center",
    department: "Produce · melons",
    costMul: 0.85,
  },
  {
    re: /\b(grape)\b/i,
    zoneDepth: "front",
    side: "left",
    department: "Produce · grapes",
    costMul: 1.1,
  },

  // —— Produce: vegetables ——
  {
    re: /\b(spinach|kale|lettuce|greens|arugula|chard|romaine|collard|bok choy|cabbage|watercress|mustard greens|dandelion|endive|radicchio)\b/i,
    zoneDepth: "back",
    side: "wall",
    department: "Produce · leafy greens",
    walmartTip: "Misted cooler wall for bagged salads & bunched greens — back of produce section.",
    wincoTip: "Wet cooler wall for greens; loose heads often cheaper than clamshells.",
    costMul: 1.2,
  },
  {
    re: /\b(carrot|celery|cucumber|beet|zucchini|squash|butternut|pumpkin|radish|turnip|parsnip|rutabaga|jicama|asparagus|broccoli|cauliflower|brussels|kohlrabi|fennel|eggplant|okra|artichoke|chayote)\b/i,
    zoneDepth: "halfway",
    side: "left",
    department: "Produce · vegetables",
    costMul: 0.85,
  },
  {
    re: /\b(sweet potato|potato|yam)\b/i,
    zoneDepth: "halfway",
    side: "center",
    department: "Produce · potatoes / roots",
    costMul: 0.7,
  },
  {
    re: /\b(bell pepper|jalape|pepper|tomato|cherry tomato)\b/i,
    zoneDepth: "halfway",
    side: "right",
    department: "Produce · peppers & tomatoes",
    costMul: 1.05,
  },
  {
    re: /\b(ginger|garlic|onion|shallot|leek|green onion|scallion|turmeric root)\b/i,
    zoneDepth: "front",
    side: "left",
    department: "Produce · aromatics",
    walmartTip: "Garlic/onion/ginger bins near front of produce or next to bagged veg.",
    wincoTip: "Aromatics front of produce; fresh turmeric root when in season near ginger.",
    costMul: 0.7,
  },
  {
    re: /\b(green bean|snap pea|pea pod|edamame)\b/i,
    zoneDepth: "halfway",
    side: "right",
    department: "Produce · pods",
    costMul: 1.1,
  },

  // —— Herbs ——
  {
    re: /\b(basil|mint|cilantro|parsley|dill|thyme|rosemary|oregano|sage|chive|tarragon|marjoram|lemongrass|bay leaf|lavender|chamomile|holy basil|sorrel|lemon balm|peppermint|spearmint|coriander leaf|thai basil|shiso|epazote)\b/i,
    zoneDepth: "back",
    side: "right",
    department: "Produce · fresh herbs",
    walmartTip: "Clamshell herbs by bagged salads; dried versions in Spices A6–7 if fresh is out.",
    wincoTip: "Fresh near salads; dried herbs on bulk spice wall for tiny amounts.",
    costMul: 1.0,
  },

  // —— Spices (powdered / seed spices) ——
  {
    re: /\b(cinnamon|nutmeg|cardamom|ginger powder|turmeric powder|cumin|coriander seed|clove|allspice|star anise|vanilla|black pepper|cayenne|paprika|saffron|fennel seed|fenugreek|mustard seed|caraway|anise seed|mace|sumac|zaatar|za'atar)\b/i,
    cat: "spice",
    walmartAisle: "Aisle 6–7",
    wincoAisle: "Bulk / Aisle 4–5",
    department: "Spices & seasonings",
    side: "right",
    zoneDepth: "halfway",
    walmartTip: "Spice racks mid A6–7; value brands lower shelf. International spices in A17–18.",
    wincoTip: "Bulk spice wall first for cost; jarred only if you need a large sealed bottle.",
    costMul: 1.0,
  },

  // —— Nuts & seeds ——
  {
    re: /\b(chia|flax|hemp seed|hemp hearts)\b/i,
    cat: "nut-seed",
    walmartAisle: "Aisle 15–16 / Natural A17–18",
    wincoAisle: "Bulk / Aisle 3–4",
    department: "Seeds · baking & natural",
    side: "left",
    zoneDepth: "halfway",
    walmartTip: "Chia/flax often in natural foods A17–18 or baking nuts A3–4 / snack seeds A15–16.",
    wincoTip: "Bulk bins for chia/flax/hemp — best unit cost at Barnett Rd WinCo.",
    costMul: 1.6,
  },
  {
    re: /\b(almond|cashew|walnut|pecan|pistachio|macadamia|hazelnut|brazil|pine nut)\b/i,
    cat: "nut-seed",
    walmartAisle: "Aisle 15–16",
    wincoAisle: "Bulk / Aisle 3–4",
    department: "Nuts",
    side: "left",
    zoneDepth: "front",
    walmartTip: "Snack nuts front A15–16; raw baking nuts toward A3–4 baking end.",
    wincoTip: "Bulk nuts first; packaged only for convenience. Write PLU on the bag tag.",
    costMul: 1.9,
  },
  {
    re: /\b(pumpkin seed|sunflower seed|sesame seed|poppy seed|watermelon seed|cacao|coconut flake)\b/i,
    cat: "nut-seed",
    walmartAisle: "Aisle 15–16",
    wincoAisle: "Bulk / Aisle 3–4",
    department: "Seeds & trail mix",
    side: "right",
    zoneDepth: "halfway",
    costMul: 1.5,
  },
  {
    re: /\b(nut butter|almond butter|cashew butter|sunflower butter|tahini)\b/i,
    cat: "nut-seed",
    walmartAisle: "Aisle 10–11 / Natural A17–18",
    wincoAisle: "Aisle 8–9",
    department: "Nut butters",
    side: "left",
    zoneDepth: "halfway",
    costMul: 2.0,
  },

  // —— Legumes ——
  {
    re: /\b(lentil|chickpea|garbanzo|black bean|pinto|white bean|kidney|mung|split pea|adzuki|navy bean|lima|black-eyed|fava|cranberry bean|bean)\b/i,
    cat: "legume",
    walmartAisle: "Aisle 8–9",
    wincoAisle: "Bulk / Aisle 6–7",
    department: "Beans · dry & canned",
    side: "right",
    zoneDepth: "halfway",
    walmartTip: "Dry beans mid A8–9; canned lower shelves. No-salt-added on lower value shelves.",
    wincoTip: "Dry beans & lentils bulk first; canned A6–7 if you want ready-to-blend.",
    costMul: 0.75,
  },
  {
    re: /\b(edamame|tofu|tempeh)\b/i,
    cat: "protein",
    walmartAisle: "Produce cooler / Freezer / Natural",
    wincoAisle: "Produce cooler / Freezer",
    department: "Plant protein",
    zone: "Produce coolers or freezer",
    side: "wall",
    zoneDepth: "back",
    walmartTip: "Refrigerated tofu often near produce or natural cooler; frozen edamame in Freezer last.",
    wincoTip: "Tofu in produce/dairy coolers; frozen edamame in freezer — cold last.",
    costMul: 1.4,
  },

  // —— Grains ——
  {
    re: /\b(oat|oatmeal|rolled oat)\b/i,
    cat: "grain",
    walmartAisle: "Aisle 1–2",
    wincoAisle: "Bulk / Aisle 5–6",
    department: "Breakfast · oats / cereal",
    side: "left",
    zoneDepth: "halfway",
    walmartTip: "Certified GF oats with cereal/breakfast A1–2; gluten-free bay if labeled separately.",
    wincoTip: "Bulk rolled oats usually cheapest; packaged GF oats A5–6 if preferred.",
    costMul: 0.85,
  },
  {
    re: /\b(rice|quinoa|millet|buckwheat|amaranth|teff|sorghum|polenta|grits|puffed rice|rice flour)\b/i,
    cat: "grain",
    walmartAisle: "Aisle 5–6",
    wincoAisle: "Bulk / Aisle 5–6",
    department: "Rice & gluten-free grains",
    side: "left",
    zoneDepth: "halfway",
    walmartTip: "Rice & GF grains mid A5–6; specialty quinoa sometimes in natural A17–18.",
    wincoTip: "Bulk rice/quinoa first; packaged on A5–6 if labeled GF needed.",
    costMul: 0.95,
  },
  {
    re: /\b(corn|polenta)\b/i,
    cat: "grain",
    walmartAisle: "Aisle 5–6",
    wincoAisle: "Bulk / Aisle 5–6",
    costMul: 0.9,
  },

  // —— Animal protein ——
  {
    re: /\b(chicken|beef|turkey|fish|salmon|shrimp)\b/i,
    cat: "protein",
    walmartAisle: "Meat / Seafood",
    wincoAisle: "Meat / Seafood",
    department: "Meat & seafood wall",
    zone: "Back perimeter",
    side: "wall",
    zoneDepth: "back",
    walmartTip: "Back wall meat cases; seafood adjacent. Shop after dry goods, before frozen.",
    wincoTip: "Meat department back wall — after bulk/center aisles, before frozen.",
    costMul: 2.2,
  },

  // —— Oils / condiments (other) ——
  {
    re: /\b(oil|olive oil|avocado oil|coconut oil|vinegar|sauce|tamari|aminos)\b/i,
    cat: "other",
    walmartAisle: "Aisle 10–11",
    wincoAisle: "Aisle 8–9",
    department: "Oils & condiments",
    side: "center",
    zoneDepth: "halfway",
    costMul: 1.3,
  },
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
    text: "At Medford Walmart/WinCo: walk outer walls (produce → bakery → meat → dairy) before center aisles — most whole foods live on the perimeter.",
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
    title: "WinCo bulk (Barnett Rd)",
    text: "At WinCo #44, grab a bulk bag first for nuts, grains, beans, and spices — often half the unit cost of packaged.",
  },
  {
    id: "app-locator",
    title: "Walmart app / WinCo staff",
    text: "Open the Walmart app store map for Supercenter #2069 or #5839; at WinCo ask staff at the bulk desk if a bin moved after remodel.",
  },
  {
    id: "cold-last",
    title: "Cold chain last",
    text: "Shop dry goods → produce → refrigerated → frozen so nothing thaws in the cart (especially summer Medford heat).",
  },
];

export const STORE_OPTIONS = [
  { id: "walmart", label: "Walmart (Medford)" },
  { id: "winco", label: "WinCo (Medford)" },
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

/**
 * Prefer mapped side for accuracy. Only soft-vary when base is left/right
 * among many similar catalog variants so lists don't look identical.
 */
function pickSide(baseSide, name, id, forced) {
  if (forced) return forced;
  if (baseSide === "wall" || baseSide === "endcap" || baseSide === "center") return baseSide;
  if (baseSide) return baseSide;
  const sides = ["left", "right"];
  const h = stableHash(`${id}|${name}|side`);
  return sides[h % 2];
}

function pickDepth(baseDepth, name, id, forced) {
  if (forced) return forced;
  if (baseDepth) return baseDepth;
  const depths = ["front", "halfway", "back"];
  const h = stableHash(`${id}|${name}|depth`);
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
 * Step-by-step how to walk to a product in a given Medford store.
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
    locations,
  } = ctx;
  const itemName = name || "this item";
  const cat = category || "other";
  const steps = [];
  const primary = locations?.[0];
  const locLine = primary
    ? `${primary.name || storeLabel} · ${primary.address || "Medford, OR"}`
    : `${storeLabel} · Medford, OR`;

  if (storeId === "winco") {
    steps.push(
      `At WinCo Foods Medford (#44, 251 E Barnett Rd) — bag-your-own, bring reusable bags — grab a cart at the main doors.`
    );
    steps.push(`Target store: ${locLine}.`);
    if (/produce/i.test(aisle) || cat === "fruit" || cat === "vegetable" || cat === "herb") {
      steps.push(
        `Go first to Produce on the front perimeter (WinCo path ①). Look for ${itemName} on the ${sLabel.toLowerCase()} in the ${dLabel.toLowerCase()}.`
      );
      steps.push(
        `Scan wet cooler walls for bagged greens/herbs and dry tables for fruit/roots. Match department: ${department}.`
      );
    } else if (/bulk/i.test(aisle) || ["spice", "nut-seed", "legume", "grain"].includes(cat)) {
      steps.push(
        `After produce, head to Bulk Foods (WinCo path ② — best prices at Barnett Rd). Zone: ${zone}.`
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
      steps.push(`Save frozen for last at WinCo (path ⑥). Go to ${aisle} / freezer wall.`);
      steps.push(
        `Open freezers on the ${sLabel.toLowerCase()} near the ${dLabel.toLowerCase()} and pick ${itemName}.`
      );
    } else if (/dairy/i.test(aisle) || /dairy/i.test(department) || /dairy/i.test(zone)) {
      steps.push(
        `Head to Dairy / chilled juice coolers (WinCo path late — cold late). Department: ${department}.`
      );
      steps.push(
        `On the ${sLabel.toLowerCase()} cooler wall, scan the ${dLabel.toLowerCase()} for ${itemName}.`
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

  // Walmart Supercenter path (Medford)
  steps.push(
    `At Walmart Medford Supercenter, enter the grocery doors and grab a cart near the entrance / checkouts.`
  );
  steps.push(
    `Target: ${locLine}. (Also served: Supercenter #5839 Crater Lake Hwy — aisle order is similar; confirm in the Walmart app.)`
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
    steps.push(`Leave frozen for last (Walmart path ⑥). Go to ${aisle}.`);
    steps.push(
      `Use the ${sLabel.toLowerCase()} of the freezer aisle; open doors near the ${dLabel.toLowerCase()} and select ${itemName}.`
    );
  } else if (/dairy|milk/i.test(department) || /dairy/i.test(zone) || /dairy/i.test(aisle)) {
    steps.push(`Head to Dairy coolers on the left/back wall (Walmart path ⑤ — cold late).`);
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
    `Optional: confirm location in the Walmart app aisle locator for store #2069 or #5839 if this remodel differs.`
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
  let forcedSide = null;
  let forcedDepth = null;
  // First matching override wins per field (list is ordered specific → general)
  let aisleLocked = false;
  let deptLocked = false;
  let zoneLocked = false;
  let sideLocked = false;
  let depthLocked = false;
  let tipLocked = false;

  for (const o of overrides) {
    if (!aisleLocked) {
      if (storeId === "walmart" && o.walmartAisle) {
        aisle = o.walmartAisle;
        aisleLocked = true;
      } else if (storeId === "winco" && o.wincoAisle) {
        aisle = o.wincoAisle;
        aisleLocked = true;
      }
    }
    if (!deptLocked && o.department) {
      department = o.department;
      deptLocked = true;
    }
    if (!zoneLocked && o.zone) {
      zone = o.zone;
      zoneLocked = true;
    }
    if (!sideLocked && o.side) {
      side = o.side;
      sideLocked = true;
    }
    if (!depthLocked && o.zoneDepth) {
      depth = o.zoneDepth;
      depthLocked = true;
    }
    if (!sideLocked) {
      if (storeId === "walmart" && o.walmartSide) {
        forcedSide = o.walmartSide;
        sideLocked = true;
      } else if (storeId === "winco" && o.wincoSide) {
        forcedSide = o.wincoSide;
        sideLocked = true;
      }
    }
    if (!depthLocked) {
      if (storeId === "walmart" && o.walmartDepth) {
        forcedDepth = o.walmartDepth;
        depthLocked = true;
      } else if (storeId === "winco" && o.wincoDepth) {
        forcedDepth = o.wincoDepth;
        depthLocked = true;
      }
    }
    if (!tipLocked) {
      if (storeId === "walmart" && o.walmartTip) {
        tip = o.walmartTip;
        tipLocked = true;
      } else if (storeId === "winco" && o.wincoTip) {
        tip = o.wincoTip;
        tipLocked = true;
      } else if (o.tip) {
        tip = o.tip;
        tipLocked = true;
      }
    }
  }

  side = pickSide(side, item?.name, item?.id, forcedSide);
  depth = pickDepth(depth, item?.name, item?.id, forcedDepth);

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
    locations: store.locations,
  });

  return {
    storeId,
    storeLabel: store.label,
    city: store.city || "Medford, OR",
    locations: store.locations || [],
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
    navVersion: NAV_DATA_VERSION,
  };
}

/** Numeric-ish sort so produce first, then aisle numbers, freezer later */
function aisleSortKey(aisle, depth, side, name) {
  const a = String(aisle || "");
  let major = 500;
  if (/produce/i.test(a)) major = 10;
  else if (/bulk/i.test(a)) major = 40;
  else if (/meat|deli|seafood/i.test(a)) major = 80;
  else if (/dairy/i.test(a)) major = 85;
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
    navVersion: NAV_DATA_VERSION,
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
  const primary = s.locations?.[0];
  return {
    id: storeId,
    label: s.label,
    shortLabel: s.shortLabel || s.label,
    note: s.note,
    city: s.city,
    locations: s.locations || [],
    primaryAddress: primary?.address || "",
    primaryUrl: primary?.url || "",
  };
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
