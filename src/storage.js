/**
 * Local persistence + soft-delete recovery + import/export + logging.
 * Privacy-first: all user data stays on-device unless exported.
 * Dual-write: localStorage (sync) + IndexedDB (durable database layer).
 */

const KEY = "liquidfloodie.v1";
const TRASH_KEY = "liquidfloodie.trash.v1";
const LOG_KEY = "liquidfloodie.logs.v1";
const IDB_NAME = "liquidfloodie-db";
const IDB_STORE = "kv";

const DEFAULTS = {
  /** Preset checkboxes + custom avoid keywords — see engine.defaultRestrictions() */
  restrictions: {
    milk: true,
    gluten: true,
    egg: false,
    nuts: false,
    peanuts: false,
    shellfish: false,
    fish: false,
    soy: false,
    sesame: false,
    meat: false,
    animal: false,
    custom: [],
  },
  mealsPerDay: 2,
  ingredientCount: 3,
  preferredIds: [],
  mealPlan: null,
  groceryList: null,
  /** User-built named meals (base + 2–5 ingredients) */
  customMeals: [],
  /** User-created ingredients with macros/micros (merged into catalog at runtime) */
  customIngredients: [],
  schedule: {
    enabled: false,
    hour: 8,
    minute: 0,
    autoRotate: false,
    lastRun: null,
    history: [], // job scheduling reporting
  },
  gamification: {
    points: 0,
    badges: [],
    challenges: {},
    history: [],
    displayName: "Foodie",
    eventsJoined: [],
    communityPosts: [],
  },
  analytics: {
    plansGenerated: 0,
    groceriesBuilt: 0,
    rotations: 0,
    searches: 0,
    sessions: 0,
    lastOpen: null,
    ingredientUsage: {}, // id -> count
  },
  feedback: [],
  settings: {
    notifications: false,
    theme: "system",
    reducedMotion: false,
    /** Preferred store path for grocery navigation */
    groceryStore: "walmart",
    /** aisle | category | name | cost */
    grocerySort: "aisle",
    /** illustrated | diagram — store layout map view */
    groceryMapView: "illustrated",
  },
  /** Nutrients tracking (calories, macros, micros, water, fiber) */
  nutrients: {
    goals: null, // filled from DEFAULT_GOALS on first use
    /** date -> { waterMlLogged, extraFiber, notes, mealsCompleted: [] } */
    daily: {},
  },
  deleted: [],
};

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return deepMerge(structuredClone(DEFAULTS), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  // Fire-and-forget durable DB write
  idbSet(KEY, state).catch(() => {});
}

function deepMerge(base, over) {
  if (!over || typeof over !== "object") return base;
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k])) {
      base[k] = deepMerge(base[k] || {}, over[k]);
    } else {
      base[k] = over[k];
    }
  }
  return base;
}

/* ---------- IndexedDB database layer ---------- */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function hydrateFromDb(state) {
  try {
    const saved = await idbGet(KEY);
    if (saved && typeof saved === "object") {
      return deepMerge(state, saved);
    }
  } catch {
    /* ignore */
  }
  return state;
}

export function exportAll(state) {
  return JSON.stringify(
    {
      app: "LiquidFloodie",
      version: 2,
      exportedAt: new Date().toISOString(),
      state,
      logs: loadLogs().slice(0, 200),
    },
    null,
    2
  );
}

export function importAll(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (!data || !data.state) throw new Error("Invalid LiquidFloodie backup file.");
  const state = deepMerge(structuredClone(DEFAULTS), data.state);
  saveState(state);
  log("import", "Backup imported");
  return state;
}

/** Soft-delete current plan/grocery into trash (30-day recovery metaphor) */
export function softDelete(state, kind) {
  const trash = loadTrash();
  const entry = {
    id: `del-${Date.now()}`,
    kind,
    deletedAt: new Date().toISOString(),
    payload: kind === "mealPlan" ? state.mealPlan : kind === "groceryList" ? state.groceryList : state,
  };
  trash.unshift(entry);
  if (trash.length > 50) trash.length = 50;
  localStorage.setItem(TRASH_KEY, JSON.stringify(trash));
  if (kind === "mealPlan") state.mealPlan = null;
  if (kind === "groceryList") state.groceryList = null;
  if (kind === "all") {
    // Full wipe of on-device app data (account/session keys are separate)
    const wiped = structuredClone(DEFAULTS);
    saveState(wiped);
    log("delete", "Soft-deleted all");
    return wiped;
  }
  saveState(state);
  log("delete", `Soft-deleted ${kind}`);
  return state;
}

export function loadTrash() {
  try {
    return JSON.parse(localStorage.getItem(TRASH_KEY) || "[]");
  } catch {
    return [];
  }
}

export function recoverFromTrash(state, trashId) {
  const trash = loadTrash();
  const idx = trash.findIndex((t) => t.id === trashId);
  if (idx < 0) throw new Error("Trash item not found.");
  const [entry] = trash.splice(idx, 1);
  localStorage.setItem(TRASH_KEY, JSON.stringify(trash));
  if (entry.kind === "mealPlan") state.mealPlan = entry.payload;
  else if (entry.kind === "groceryList") state.groceryList = entry.payload;
  else if (entry.kind === "all" && entry.payload) {
    state = deepMerge(structuredClone(DEFAULTS), entry.payload);
  }
  saveState(state);
  log("recover", `Recovered ${entry.kind}`);
  return state;
}

export function trackIngredientUsage(state, mealPlan) {
  state.analytics.ingredientUsage = state.analytics.ingredientUsage || {};
  for (const day of mealPlan?.plan || []) {
    for (const meal of day.meals || []) {
      for (const item of [meal.base, ...(meal.ingredients || [])]) {
        if (!item?.id) continue;
        state.analytics.ingredientUsage[item.id] =
          (state.analytics.ingredientUsage[item.id] || 0) + 1;
      }
    }
  }
}

export function award(state, event, pts = 10) {
  const g = state.gamification;
  g.points = (g.points || 0) + pts;
  g.history = g.history || [];
  g.history.unshift({ event, pts, at: new Date().toISOString() });
  if (g.history.length > 100) g.history.length = 100;

  const badges = new Set(g.badges || []);
  if (state.analytics.plansGenerated >= 1) badges.add("first-plan");
  if (state.analytics.plansGenerated >= 5) badges.add("planner-pro");
  if (state.analytics.groceriesBuilt >= 1) badges.add("shop-ready");
  if (state.analytics.rotations >= 3) badges.add("rotation-master");
  if (g.points >= 100) badges.add("century");
  if (g.points >= 500) badges.add("liquid-legend");
  if ((g.communityPosts || []).length >= 1) badges.add("community-voice");
  if ((g.eventsJoined || []).length >= 1) badges.add("event-goer");
  g.badges = [...badges];

  g.challenges = g.challenges || {};
  const week = isoWeek();
  g.challenges[week] = g.challenges[week] || { plans: 0, groceries: 0, rotations: 0 };
  if (event === "plan") g.challenges[week].plans++;
  if (event === "grocery") g.challenges[week].groceries++;
  if (event === "rotate") g.challenges[week].rotations++;

  saveState(state);
  log("award", `${event} +${pts}pts`);
  return state;
}

export function recordScheduleRun(state, note) {
  state.schedule.history = state.schedule.history || [];
  state.schedule.history.unshift({
    at: new Date().toISOString(),
    note: note || "Scheduled job ran",
    autoRotate: !!state.schedule.autoRotate,
  });
  if (state.schedule.history.length > 50) state.schedule.history.length = 50;
  saveState(state);
  log("schedule", note || "job");
}

export function log(level, message, detail = null) {
  try {
    const logs = loadLogs();
    logs.unshift({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      level,
      message,
      detail,
    });
    if (logs.length > 300) logs.length = 300;
    localStorage.setItem(LOG_KEY, JSON.stringify(logs));
  } catch {
    /* ignore */
  }
}

export function loadLogs() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

export function clearLogs() {
  localStorage.setItem(LOG_KEY, "[]");
}

function isoWeek() {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

export const BADGE_META = {
  "first-plan": { name: "First Pour", desc: "Generated your first meal plan", icon: "🥤" },
  "planner-pro": { name: "Planner Pro", desc: "Generated 5 meal plans", icon: "📅" },
  "shop-ready": { name: "Shop Ready", desc: "Built a grocery list", icon: "🛒" },
  "rotation-master": { name: "Rotation Master", desc: "Rotated meals 3 times", icon: "🔄" },
  century: { name: "Century Club", desc: "Earned 100 points", icon: "💯" },
  "liquid-legend": { name: "Liquid Legend", desc: "Earned 500 points", icon: "🏆" },
  "community-voice": { name: "Community Voice", desc: "Posted a community tip", icon: "💬" },
  "event-goer": { name: "Event Goer", desc: "Joined a liquid-meal event", icon: "🎉" },
};

/** Seeded community tips (local demo + user posts) */
export const COMMUNITY_SEED = [
  {
    id: "c1",
    author: "SipSage",
    text: "Bone broth + cooked carrot + ginger is gentle and savory for low-energy days.",
    at: "2026-07-01T12:00:00Z",
  },
  {
    id: "c2",
    author: "WholePour",
    text: "Always liquid base first, then soft fruit, then seeds — fewer blender jams.",
    at: "2026-07-10T09:00:00Z",
  },
  {
    id: "c3",
    author: "BlendBot",
    text: "Rotate every 5 days so you don't get taste fatigue. Your grocery list stays manageable.",
    at: "2026-07-15T18:00:00Z",
  },
];

export const EVENTS = [
  {
    id: "ev-smoothie-week",
    name: "Whole-Food Smoothie Week",
    desc: "Generate at least 3 plans this week. Milk-free & gluten-free only.",
    ends: "2026-12-31",
    reward: 50,
  },
  {
    id: "ev-broth-challenge",
    name: "Broth Base Challenge",
    desc: "Build a plan that uses broth bases and savory veggies.",
    ends: "2026-12-31",
    reward: 30,
  },
  {
    id: "ev-grocery-streak",
    name: "Shop-Ready Streak",
    desc: "Rebuild or export your grocery list twice.",
    ends: "2026-12-31",
    reward: 20,
  },
];

export { DEFAULTS };
