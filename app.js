/**
 * LiquidFloodie UI v1.2
 * Sections: Home (daily meals + library), Weekly Plan, Grocery, Nutrients, Settings
 */
import { INGREDIENT_DB } from "./data/ingredients.js";
import {
  filterIngredients,
  generateMealPlan,
  rotateMealPlan,
  rotateSingleMeal,
  buildGroceryList,
  planToShareText,
  thirdPartyLinks,
  estimateEndlessCapacity,
  buildMealSteps,
  buildCustomMeal,
  addCustomMealToPlan,
} from "./src/engine.js";
import {
  loadState,
  saveState,
  exportAll,
  importAll,
  softDelete,
  loadTrash,
  recoverFromTrash,
  award,
  BADGE_META,
  COMMUNITY_SEED,
  EVENTS,
  trackIngredientUsage,
  recordScheduleRun,
  log,
  loadLogs,
  clearLogs,
  hydrateFromDb,
} from "./src/storage.js";
import {
  getCurrentUser,
  login,
  logout,
  registerAccount,
  recoverPassword,
  getRecoveryQuestion,
  listSecurityQuestions,
  updateProfile,
  resolveAvatar,
} from "./src/auth.js";
import { iconFor, iconLegendHtml } from "./src/icons.js";
import {
  nutritionForMeal,
  nutritionForPlan,
  nutritionForDay,
  nutritionBreakdownForDay,
  nutritionBreakdownForMeal,
  DEFAULT_GOALS,
  MICRO_LABELS,
  SERVING_UNITS,
  formatServing,
  normalizeMealNutrition,
  hasUserNutrition,
  todayKey,
} from "./src/nutrition.js";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

let state = loadState();
let db = INGREDIENT_DB;
let currentUser = getCurrentUser();
let selectedNutrientDay = 1;

/** Guest access — full app without login (session-scoped) */
const GUEST_KEY = "liquidfloodie.guest.v1";

function isGuestMode() {
  try {
    return sessionStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
}

function setGuestMode(on) {
  try {
    if (on) sessionStorage.setItem(GUEST_KEY, "1");
    else sessionStorage.removeItem(GUEST_KEY);
  } catch {
    /* ignore */
  }
}

/** Logged-in user OR guest may use the app */
function canUseApp() {
  return !!getCurrentUser() || isGuestMode();
}

function enterGuestMode(message) {
  setGuestMode(true);
  unlockAppAfterAuth();
  log("auth", "guest mode");
  refreshUserChrome().then(() => {
    showTab("home");
    renderAll();
    toast(message || "Welcome — exploring without an account");
  });
}

function goals() {
  if (!state.nutrients) state.nutrients = { goals: null, daily: {} };
  if (!state.nutrients.goals) state.nutrients.goals = structuredClone(DEFAULT_GOALS);
  return state.nutrients.goals;
}

function dailyLog(date = todayKey()) {
  if (!state.nutrients) state.nutrients = { goals: null, daily: {} };
  if (!state.nutrients.daily) state.nutrients.daily = {};
  if (!state.nutrients.daily[date]) {
    state.nutrients.daily[date] = { waterMlLogged: 0, extraFiber: 0, notes: "", mealsCompleted: [] };
  }
  return state.nutrients.daily[date];
}

/* ---------- bootstrap ---------- */
async function boot() {
  // Wire nav + auth first so login gate and tabs always respond
  bindNav();
  bindAuth();

  try {
    state = await hydrateFromDb(state);
  } catch {
    /* ignore */
  }
  try {
    goals();
    state.analytics.sessions = (state.analytics.sessions || 0) + 1;
    state.analytics.lastOpen = new Date().toISOString();
    saveState(state);
    log("session", "App opened");
  } catch (e) {
    console.warn("init state", e);
  }

  bindHome();
  bindPlan();
  bindGrocery();
  bindNutrients();
  bindLibrary();
  bindGame();
  bindSettings();
  bindSearch();
  bindShare();
  maybeScheduleTick();

  currentUser = getCurrentUser();
  const params = new URLSearchParams(location.search);
  // Deep link: ?guest=1 opens app without login
  if (!currentUser && (params.get("guest") === "1" || params.get("go") === "guest")) {
    setGuestMode(true);
  }

  // Autogenerate weekly + daily meal plan if none exists
  ensureAutoMealPlan();

  const go = params.get("go");
  if (go && go !== "guest") {
    const map = { rewards: "settings", game: "settings", library: "home", nutrients: "nutrients" };
    showTab(map[go] || go);
  } else {
    showTab("home");
  }

  await refreshUserChrome();
  renderAll();

  // First visit / no session: show Login + Create Account (do not auto-skip as guest)
  if (canUseApp()) {
    unlockAppAfterAuth();
  } else {
    lockAppForAuth();
    openAuth("register", { required: true });
  }

  registerSW();
}

/** Create a default weekly plan (powers daily meals) when missing */
function ensureAutoMealPlan() {
  if (state.mealPlan?.plan?.length) return state.mealPlan;
  try {
    const plan = generateMealPlan(db, {
      days: 5,
      mealsPerDay: state.mealsPerDay || 2,
      ingredientCount: state.ingredientCount || 3,
      restrictions: state.restrictions || { milk: true, gluten: true },
      preferredIds: state.preferredIds || [],
      seed: Date.now(),
      rotateOffset: 0,
    });
    state.mealPlan = plan;
    state.groceryList = buildGroceryList(plan);
    state.analytics.plansGenerated = (state.analytics.plansGenerated || 0) + 1;
    state.analytics.groceriesBuilt = (state.analytics.groceriesBuilt || 0) + 1;
    saveState(state);
    log("plan", "autogenerated", plan.id);
  } catch (e) {
    console.warn("auto meal plan", e);
  }
  return state.mealPlan;
}

function autogenerateWeeklyPlan() {
  syncPlanFormToState();
  const plan = generateMealPlan(db, {
    days: 5,
    mealsPerDay: state.mealsPerDay || 2,
    ingredientCount: state.ingredientCount || 3,
    restrictions: state.restrictions || { milk: true, gluten: true },
    preferredIds: state.preferredIds || [],
    seed: Date.now(),
    rotateOffset: 0,
  });
  state.mealPlan = plan;
  state.groceryList = buildGroceryList(plan);
  trackIngredientUsage(state, plan);
  state.analytics.plansGenerated = (state.analytics.plansGenerated || 0) + 1;
  state.analytics.groceriesBuilt = (state.analytics.groceriesBuilt || 0) + 1;
  award(state, "plan", 25);
  award(state, "grocery", 10);
  saveState(state);
  log("plan", "weekly-autogen", plan.id);
  return plan;
}

/** Regenerate only today's day within the weekly plan */
function autogenerateDailyPlan() {
  ensureAutoMealPlan();
  const day = currentPlanDay();
  if (!day) {
    return autogenerateWeeklyPlan();
  }
  const dayNum = day.day;
  let plan = state.mealPlan;
  const mpd = plan.mealsPerDay || day.meals.length || 2;
  for (let i = 0; i < mpd; i++) {
    plan = rotateSingleMeal(plan, db, {
      day: dayNum,
      mealIndex: i,
      preferredIds: state.preferredIds || [],
    });
  }
  state.mealPlan = plan;
  state.groceryList = buildGroceryList(plan);
  trackIngredientUsage(state, plan);
  state.analytics.rotations = (state.analytics.rotations || 0) + mpd;
  saveState(state);
  log("plan", "daily-autogen", `day-${dayNum}`);
  return plan;
}

function rotateMealAt(dayNum, mealIndex) {
  if (!state.mealPlan) ensureAutoMealPlan();
  state.mealPlan = rotateSingleMeal(state.mealPlan, db, {
    day: dayNum,
    mealIndex,
    preferredIds: state.preferredIds || [],
  });
  state.groceryList = buildGroceryList(state.mealPlan);
  state.analytics.rotations = (state.analytics.rotations || 0) + 1;
  award(state, "rotate", 10);
  saveState(state);
  log("plan", "rotate-meal", `day-${dayNum}-m${mealIndex}`);
}

function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.hidden = false;
  t.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.hidden = true;
  }, 2800);
}

function showTab(name) {
  if (!name) return;
  if (!canUseApp()) {
    // Safety net: grant guest access rather than trapping on login
    setGuestMode(true);
  }
  document.querySelectorAll("#tabNav .tab").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  document.querySelectorAll("main .panel").forEach((p) => {
    const on = p.id === `panel-${name}`;
    p.classList.toggle("active", on);
    if (on) p.removeAttribute("hidden");
    else p.setAttribute("hidden", "");
  });
  try {
    if (name === "home") {
      renderHome();
      renderLibrary();
    }
    if (name === "grocery") renderGrocery();
    if (name === "plan") renderPlan();
    if (name === "nutrients") renderNutrients();
    if (name === "settings") renderSettings();
  } catch (e) {
    console.warn("render tab", name, e);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindNav() {
  const nav = document.getElementById("tabNav");
  if (!nav) return;
  nav.querySelectorAll(".tab").forEach((btn) => {
    const go = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tab = btn.dataset.tab;
      if (tab) showTab(tab);
    };
    btn.addEventListener("click", go);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") go(e);
    });
  });
}

/* ---------- Auth ---------- */
function lockAppForAuth() {
  document.body.classList.add("auth-locked");
  const modal = $("#authModal");
  modal?.classList.remove("hide");
  modal?.classList.add("auth-gate");
}

function unlockAppAfterAuth() {
  document.body.classList.remove("auth-locked");
  const modal = $("#authModal");
  modal?.classList.add("hide");
  modal?.classList.remove("auth-gate");
}

async function onAuthSuccess(user, message) {
  currentUser = user;
  setGuestMode(false);
  if (user?.displayName) state.gamification.displayName = user.displayName;
  saveState(state);
  unlockAppAfterAuth();
  await refreshUserChrome();
  showTab("home");
  renderAll();
  toast(message || `Welcome, ${user.displayName}`);
}

function bindAuth() {
  const modal = $("#authModal");
  if (!modal) return;

  $("#continueGuestBtn")?.addEventListener("click", () => {
    enterGuestMode("Continuing without an account");
  });

  $("#accountBtn").onclick = () => {
    if (getCurrentUser()) {
      showTab("settings");
      return;
    }
    openAuth("login", { required: !canUseApp() });
  };

  $("#authClose").onclick = () => {
    // Closing without an account continues as guest
    if (!getCurrentUser()) setGuestMode(true);
    unlockAppAfterAuth();
    showTab("home");
    renderAll();
    refreshUserChrome();
  };
  modal.addEventListener("click", (e) => {
    // Backdrop click only dismisses when not a required gate
    if (e.target !== modal) return;
    if (modal.classList.contains("auth-gate") && !getCurrentUser() && !isGuestMode()) return;
    if (!getCurrentUser()) setGuestMode(true);
    unlockAppAfterAuth();
    showTab("home");
    renderAll();
    refreshUserChrome();
  });

  $$(".auth-tab").forEach((tab) => {
    tab.onclick = () =>
      openAuth(tab.dataset.auth, { required: !canUseApp() });
  });

  const qs = listSecurityQuestions();
  if ($("#regQuestion")) {
    $("#regQuestion").innerHTML = qs
      .map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`)
      .join("");
  }

  $("#formLogin").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const user = await login($("#loginEmail").value, $("#loginPassword").value);
      log("auth", "login ok", user.email);
      await onAuthSuccess(user, `Welcome back, ${user.displayName}`);
    } catch (err) {
      toast(err.message);
    }
  };

  $("#formRegister").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const user = await registerAccount({
        email: $("#regEmail").value,
        password: $("#regPassword").value,
        displayName: $("#regName").value,
        securityQuestion: $("#regQuestion").value,
        securityAnswer: $("#regAnswer").value,
      });
      log("auth", "register ok", user.email);
      await onAuthSuccess(user, "Account created — welcome to LiquidFloodie");
    } catch (err) {
      toast(err.message);
    }
  };

  $("#loadQuestionBtn").onclick = () => {
    try {
      $("#recQuestion").textContent = getRecoveryQuestion($("#recEmail").value);
    } catch (err) {
      toast(err.message);
    }
  };

  $("#formRecover").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const user = await recoverPassword({
        email: $("#recEmail").value,
        securityAnswer: $("#recAnswer").value,
        newPassword: $("#recPassword").value,
      });
      log("auth", "password recovered", user.email);
      await onAuthSuccess(user, "Password reset — you are signed in");
    } catch (err) {
      toast(err.message);
    }
  };
}

function openAuth(which, opts = {}) {
  const modal = $("#authModal");
  if (!modal) return;
  const required = !!opts.required && !getCurrentUser() && !isGuestMode();

  modal.classList.remove("hide");
  if (required) {
    // Full-screen gate: Login / Create Account / Continue Without Account
    modal.classList.add("auth-gate");
    document.body.classList.add("auth-locked");
    $("#authClose")?.classList.add("hide");
    $("#guestCta")?.classList.remove("hide");
  } else {
    modal.classList.remove("auth-gate");
    document.body.classList.remove("auth-locked");
    $("#authClose")?.classList.remove("hide");
    $("#guestCta")?.classList.toggle("hide", !!getCurrentUser());
  }

  $$(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.auth === which));
  $("#formLogin")?.classList.toggle("hide", which !== "login");
  $("#formRegister")?.classList.toggle("hide", which !== "register");
  $("#formRecover")?.classList.toggle("hide", which !== "recover");
  if ($("#authTitle")) {
    $("#authTitle").textContent =
      which === "login" ? "Login" : which === "register" ? "Create Account" : "Password Recovery";
  }
  setTimeout(() => {
    const id = which === "login" ? "loginEmail" : which === "register" ? "regEmail" : "recEmail";
    document.getElementById(id)?.focus();
  }, 50);
}

async function refreshUserChrome() {
  currentUser = getCurrentUser();
  const avatar = await resolveAvatar(currentUser, 64);
  if ($("#headerAvatar")) {
    $("#headerAvatar").src = avatar;
    $("#headerAvatar").alt = currentUser ? currentUser.displayName : "Guest";
  }
  if ($("#headerUserLabel")) {
    $("#headerUserLabel").textContent = currentUser
      ? currentUser.displayName
      : isGuestMode()
        ? "Guest"
        : "Sign In";
  }
}

/* ---------- Home: daily meals + library ---------- */
function bindHome() {
  $("#goPlanBtn").onclick = () => showTab("plan");
  $("#goNutrientsBtn").onclick = () => showTab("nutrients");
  $("#goHowToBtn").onclick = () => $("#howtoCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function restrictionsSummaryText() {
  const r = state.restrictions || { milk: true, gluten: true };
  const parts = [];
  if (r.milk) parts.push("No Milk / Dairy");
  if (r.gluten) parts.push("No Gluten");
  if (!parts.length) return "No dietary restrictions active — all whole foods in the library are available.";
  return `Currently avoiding: ${parts.join(" · ")}. Meals, search, and custom blends use these rules.`;
}

/** Sync dietary restriction checkboxes (Weekly Plan + Settings) */
function syncRestrictionControls() {
  const r = state.restrictions || { milk: true, gluten: true };
  if ($("#restrictMilk")) $("#restrictMilk").checked = !!r.milk;
  if ($("#restrictGluten")) $("#restrictGluten").checked = !!r.gluten;
  if ($("#settingsRestrictMilk")) $("#settingsRestrictMilk").checked = !!r.milk;
  if ($("#settingsRestrictGluten")) $("#settingsRestrictGluten").checked = !!r.gluten;
  if ($("#restrictionsStatus")) {
    $("#restrictionsStatus").textContent = restrictionsSummaryText();
  }
}

/**
 * Save dietary restrictions from Weekly Plan or Settings checkboxes.
 * @param {"plan"|"settings"} [from]
 */
function saveDietaryRestrictions(from) {
  let milk;
  let gluten;
  if (from === "plan" && $("#restrictMilk") && $("#restrictGluten")) {
    milk = !!$("#restrictMilk").checked;
    gluten = !!$("#restrictGluten").checked;
  } else if ($("#settingsRestrictMilk") && $("#settingsRestrictGluten")) {
    milk = !!$("#settingsRestrictMilk").checked;
    gluten = !!$("#settingsRestrictGluten").checked;
  } else if ($("#restrictMilk") && $("#restrictGluten")) {
    milk = !!$("#restrictMilk").checked;
    gluten = !!$("#restrictGluten").checked;
  } else {
    milk = !!(state.restrictions || {}).milk;
    gluten = !!(state.restrictions || {}).gluten;
  }
  const prev = state.restrictions || {};
  const changed = prev.milk !== milk || prev.gluten !== gluten;
  state.restrictions = { milk, gluten };
  // Keep both UIs in sync
  if ($("#restrictMilk")) $("#restrictMilk").checked = milk;
  if ($("#restrictGluten")) $("#restrictGluten").checked = gluten;
  if ($("#settingsRestrictMilk")) $("#settingsRestrictMilk").checked = milk;
  if ($("#settingsRestrictGluten")) $("#settingsRestrictGluten").checked = gluten;
  saveState(state);
  log("restrictions", "updated", JSON.stringify(state.restrictions));
  // Backend: regenerate meal plan when dietary rules change
  if (changed) {
    try {
      autogenerateWeeklyPlan();
    } catch (e) {
      console.warn("regen plan after restrictions", e);
    }
  }
  try {
    populateCustomBaseSelect();
    renderCustomIngSearch($("#customIngSearch")?.value || "");
    renderLibrary();
    renderHome();
    renderPlan();
    renderGrocery();
    syncRestrictionControls();
  } catch {
    /* ignore partial render */
  }
  return state.restrictions;
}

/** Map calendar day to plan day index (1-based), cycling plan length */
function currentPlanDay() {
  if (!state.mealPlan?.plan?.length) return null;
  const start = state.mealPlan.createdAt ? new Date(state.mealPlan.createdAt) : new Date();
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const now = new Date();
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((nowDay - startDay) / 86400000);
  const len = state.mealPlan.plan.length;
  const idx = ((diff % len) + len) % len;
  return state.mealPlan.plan[idx];
}

function renderHome() {
  ensureAutoMealPlan();
  const a = state.analytics;
  const day = currentPlanDay();
  const dayNut = day ? nutritionForDay(day) : null;
  $("#homeStats").innerHTML = `
    <div class="stat"><b>${dayNut ? dayNut.calories : "—"}</b><span>Today Calories</span></div>
    <div class="stat"><b>${dayNut ? dayNut.protein + "g" : "—"}</b><span>Protein</span></div>
    <div class="stat"><b>${dayNut ? dayNut.carbs + "g" : "—"}</b><span>Carbs</span></div>
    <div class="stat"><b>${dayNut ? dayNut.fat + "g" : "—"}</b><span>Fat</span></div>
  `;

  const out = $("#dailyMealsOutput");
  if (!out) return;
  if (!day) {
    ensureAutoMealPlan();
    const retry = currentPlanDay();
    if (!retry) {
      out.innerHTML = `<p class="hint">Preparing your meal plan…</p>`;
      renderDailyNutrition(null);
      return;
    }
    return renderHome();
  }
  const dayNum = day.day;
  out.innerHTML = `
    <p class="meta"><strong>${escapeHtml(day.label)}</strong> · ${day.meals.length} Meal(s) · Fiber ${dayNut.fiber}g · Water ~${dayNut.waterMl} ml</p>
    ${day.meals
      .map((m, i) => renderMealCard(m, { dayNum, mealIndex: i, showRotate: true }))
      .join("")}
    <div class="btn-row">
      <button type="button" class="btn ghost" id="homeOpenPlan">Open Full Weekly Plan</button>
      <button type="button" class="btn ghost" id="homeOpenNutrients">Nutrients Section</button>
    </div>
  `;
  $("#homeOpenPlan").onclick = () => showTab("plan");
  $("#homeOpenNutrients").onclick = () => showTab("nutrients");
  bindMealRotateButtons(out);
  renderDailyNutrition(day);
}

function bindMealRotateButtons(root) {
  root?.querySelectorAll("[data-rotate-day]")?.forEach((btn) => {
    btn.onclick = () => {
      try {
        const dayNum = Number(btn.dataset.rotateDay);
        const mealIndex = Number(btn.dataset.rotateMeal);
        rotateMealAt(dayNum, mealIndex);
        renderHome();
        renderPlan();
        renderGrocery();
        toast("Meal rotated");
      } catch (e) {
        toast(e.message || "Rotate failed");
      }
    };
  });
}

function renderDailyNutrition(day) {
  const box = $("#dailyNutritionOutput");
  if (!box) return;
  if (!day) {
    box.innerHTML = `<p class="meta">Generate a plan to see nutrition totals and ingredient breakdowns.</p>`;
    return;
  }
  const breakdown = nutritionBreakdownForDay(day);
  const t = breakdown.total;
  const microRows = Object.entries(MICRO_LABELS)
    .map(([k, meta]) => {
      const val = t.micros?.[k] ?? 0;
      return `<tr><td>${escapeHtml(meta.name)}</td><td class="num">${val} ${escapeHtml(meta.unit)}</td></tr>`;
    })
    .join("");

  const ingredientRows = breakdown.byIngredient
    .map((row) => {
      const n = row.nutrition;
      const microBits = Object.entries(MICRO_LABELS)
        .map(([k, meta]) => `${meta.name}: ${n.micros?.[k] ?? 0}${meta.unit === "mg" || meta.unit.includes("g") ? "" : ""} ${meta.unit}`)
        .join(" · ");
      return `
        <details class="nutrient-ing">
          <summary>
            <span>${row.icon || "•"} <strong>${escapeHtml(row.name)}</strong></span>
            <span class="meta">${n.calories} kcal · P ${n.protein}g · C ${n.carbs}g · F ${n.fat}g</span>
          </summary>
          <div class="nutrient-ing-body">
            <p class="meta"><em>${escapeHtml(row.category || "")}</em> · Fiber ${n.fiber}g · Water ~${n.waterMl} ml</p>
            <p class="meta"><strong>Macros:</strong> Protein ${n.protein}g · Carbs ${n.carbs}g · Fat ${n.fat}g · Fiber ${n.fiber}g · Calories ${n.calories}</p>
            <p class="meta"><strong>Micros:</strong> ${escapeHtml(microBits)}</p>
          </div>
        </details>`;
    })
    .join("");

  const mealBlocks = breakdown.meals
    .map((m) => {
      const rows = m.byIngredient
        .map(
          (row) =>
            `<tr>
              <td>${row.icon || "•"} ${escapeHtml(row.name)}${row.role === "base" ? " <em>(base)</em>" : ""}</td>
              <td class="num">${row.nutrition.calories}</td>
              <td class="num">${row.nutrition.protein}</td>
              <td class="num">${row.nutrition.carbs}</td>
              <td class="num">${row.nutrition.fat}</td>
              <td class="num">${row.nutrition.fiber}</td>
            </tr>`
        )
        .join("");
      return `
        <details class="nutrient-meal">
          <summary><strong>${escapeHtml(m.slot || "Meal")}: ${escapeHtml(m.title)}</strong>
            <span class="meta">${m.total.calories} kcal · P ${m.total.protein}g · C ${m.total.carbs}g · F ${m.total.fat}g</span>
          </summary>
          <div class="table-wrap">
            <table class="nutrient-table">
              <thead><tr><th>Ingredient</th><th>Cal</th><th>P</th><th>C</th><th>F</th><th>Fiber</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </details>`;
    })
    .join("");

  box.innerHTML = `
    <div class="nutrient-total-card">
      <h4>Daily Totals</h4>
      <div class="stat-grid nutrient-stats">
        <div class="stat"><b>${t.calories}</b><span>Calories</span></div>
        <div class="stat"><b>${t.protein}g</b><span>Protein</span></div>
        <div class="stat"><b>${t.carbs}g</b><span>Carbs</span></div>
        <div class="stat"><b>${t.fat}g</b><span>Fat</span></div>
        <div class="stat"><b>${t.fiber}g</b><span>Fiber</span></div>
        <div class="stat"><b>${t.waterMl}</b><span>Water ml</span></div>
      </div>
      <h4>Micronutrient Totals</h4>
      <div class="table-wrap">
        <table class="nutrient-table">
          <thead><tr><th>Nutrient</th><th>Amount</th></tr></thead>
          <tbody>${microRows}</tbody>
        </table>
      </div>
    </div>
    <h4>By Meal · Ingredient Contributions</h4>
    ${mealBlocks}
    <h4>By Ingredient · Full Day</h4>
    <p class="hint">What each ingredient provides toward today’s totals (combined across meals).</p>
    ${ingredientRows}
  `;
}

function renderMealCard(m, opts = {}) {
  const { dayNum = null, mealIndex = 0, showRotate = false, compact = false } = typeof opts === "boolean" ? { compact: opts } : opts;
  const n = nutritionForMeal(m);
  const steps = m.steps?.length ? m.steps : buildMealSteps(m.base, m.ingredients);
  const breakdown = nutritionBreakdownForMeal(m);
  const servingLabel = formatServing(m.serving);
  const userNut = hasUserNutrition(m);
  const ingNutRows = breakdown.byIngredient
    .map(
      (row) =>
        `<tr>
          <td>${row.icon || "•"} ${escapeHtml(row.name)}${row.role === "base" ? " <em>(base)</em>" : row.role === "custom" ? " <em>(totals)</em>" : ""}</td>
          <td class="num">${row.nutrition.calories}</td>
          <td class="num">${row.nutrition.protein}g</td>
          <td class="num">${row.nutrition.carbs}g</td>
          <td class="num">${row.nutrition.fat}g</td>
          <td class="num">${row.nutrition.fiber}g</td>
        </tr>`
    )
    .join("");
  const rotateBtn =
    showRotate && dayNum != null
      ? `<button type="button" class="btn" data-rotate-day="${dayNum}" data-rotate-meal="${mealIndex}">Rotate This Meal</button>`
      : "";
  const servingMeta = servingLabel ? `Serving ${escapeHtml(servingLabel)} · ` : "";
  const sourceMeta = userNut ? " · user nutrition" : "";
  return `
    <div class="meal">
      <div class="meal-head">
        <div>
          <div class="slot">${escapeHtml(m.slot || "Meal")}</div>
          <div class="meal-title">${escapeHtml(m.title)}</div>
        </div>
        ${rotateBtn ? `<div class="meal-actions">${rotateBtn}</div>` : ""}
      </div>
      <p class="hint">${escapeHtml(m.blurb)}</p>
      <p class="meta">${servingMeta}~${n.calories} kcal · P ${n.protein}g · C ${n.carbs}g · F ${n.fat}g · Fiber ${n.fiber}g${sourceMeta}</p>
      <div class="meal-ing">
        <span class="chip">${iconFor(m.base)} ${escapeHtml(m.base.name)} <em>(base)</em></span>
        ${(m.ingredients || []).map((i) => `<span class="chip">${iconFor(i)} ${escapeHtml(i.name)}</span>`).join("")}
      </div>
      <details class="meal-nut-breakdown">
        <summary>${userNut ? "Meal Nutrition (User Entered)" : "Ingredient Nutrient Breakdown"}</summary>
        <div class="table-wrap">
          <table class="nutrient-table">
            <thead><tr><th>${userNut ? "Source" : "Ingredient"}</th><th>Cal</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Fiber</th></tr></thead>
            <tbody>${ingNutRows}</tbody>
            <tfoot><tr><th>Meal Total</th><th class="num">${n.calories}</th><th class="num">${n.protein}g</th><th class="num">${n.carbs}g</th><th class="num">${n.fat}g</th><th class="num">${n.fiber}g</th></tr></tfoot>
          </table>
        </div>
        <p class="meta"><strong>Micros (meal):</strong> ${Object.entries(MICRO_LABELS)
          .map(([k, meta]) => `${meta.name} ${n.micros?.[k] ?? 0} ${meta.unit}`)
          .join(" · ")}</p>
      </details>
      ${
        compact
          ? ""
          : `<details class="meal-steps">
        <summary>Step-By-Step Instructions (${steps.length} Steps)</summary>
        <ol class="step-ol">
          ${steps.map((s) => `<li><strong>${escapeHtml(s.title)}</strong> — ${escapeHtml(s.text)}</li>`).join("")}
        </ol>
      </details>`
      }
    </div>`;
}

function formatBig(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

/* ---------- Weekly plan ---------- */
/** In-progress custom meal builder selection */
let customDraft = { baseId: null, ingredientIds: [] };

const CUSTOM_MACRO_IDS = ["customCal", "customProtein", "customCarbs", "customFat", "customFiber"];
const CUSTOM_MICRO_KEYS = Object.keys(MICRO_LABELS);

function bindPlan() {
  $("#rotatePlanBtn").onclick = () => {
    if (!state.mealPlan) return toast("Generate a plan first");
    try {
      syncPlanFormToState();
      state.mealPlan = rotateMealPlan(state.mealPlan, db, { preferredIds: state.preferredIds });
      state.groceryList = buildGroceryList(state.mealPlan);
      trackIngredientUsage(state, state.mealPlan);
      state.analytics.rotations = (state.analytics.rotations || 0) + 1;
      award(state, "rotate", 15);
      saveState(state);
      renderPlan();
      renderHome();
      toast("Meals rotated");
    } catch (e) {
      toast(e.message || "Rotate failed");
    }
  };

  $("#sharePlanBtn").onclick = async () => {
    if (!state.mealPlan) return toast("No plan to share");
    await shareOrCopy(planToShareText(state.mealPlan), "LiquidFloodie meal plan");
  };

  $("#prefSearch")?.addEventListener("input", () => renderPrefPicker($("#prefSearch").value));
  if ($("#mealsPerDay")) $("#mealsPerDay").value = String(state.mealsPerDay || 2);
  if ($("#ingredientCount")) $("#ingredientCount").value = String(state.ingredientCount || 3);
  syncRestrictionControls();

  // Weekly Plan dietary restriction checkboxes (sync with Settings)
  $("#restrictMilk")?.addEventListener("change", () => {
    saveDietaryRestrictions("plan");
    toast("Dietary restrictions updated");
  });
  $("#restrictGluten")?.addEventListener("change", () => {
    saveDietaryRestrictions("plan");
    toast("Dietary restrictions updated");
  });

  bindCustomMealBuilder();
}

function bindCustomMealBuilder() {
  if (!$("#customMealName")) return;

  populateCustomBaseSelect();

  $("#customMealBase")?.addEventListener("change", () => {
    customDraft.baseId = $("#customMealBase").value || null;
  });

  $("#customIngSearch")?.addEventListener("input", () => {
    renderCustomIngSearch($("#customIngSearch").value);
  });

  $("#estimateCustomNutritionBtn")?.addEventListener("click", () => {
    try {
      fillCustomNutritionFromEstimate();
      toast("Nutrition estimated from ingredients");
    } catch (e) {
      toast(e.message || "Add a base and 2–5 ingredients first");
    }
  });

  $("#clearCustomNutritionBtn")?.addEventListener("click", () => {
    clearCustomNutritionFields();
    toast("Nutrition fields cleared");
  });

  $("#saveCustomMealBtn")?.addEventListener("click", () => {
    try {
      const meal = saveCustomMealFromDraft();
      toast(`Saved “${meal.title}”`);
      clearCustomDraft(false);
      renderCustomMealsList();
    } catch (e) {
      toast(e.message || "Could not save meal");
    }
  });

  $("#addCustomToPlanBtn")?.addEventListener("click", () => {
    try {
      const meal = saveCustomMealFromDraft();
      state.mealPlan = addCustomMealToPlan(state.mealPlan, meal, { day: 1, slotIndex: 0 });
      state.groceryList = buildGroceryList(state.mealPlan);
      trackIngredientUsage(state, state.mealPlan);
      saveState(state);
      award(state, "plan", 15);
      clearCustomDraft(false);
      renderCustomMealsList();
      renderPlan();
      renderHome();
      toast(`“${meal.title}” saved and added to Day 1`);
    } catch (e) {
      toast(e.message || "Could not add meal");
    }
  });

  $("#clearCustomMealBtn")?.addEventListener("click", () => {
    clearCustomDraft(true);
    toast("Builder cleared");
  });

  renderCustomIngSelected();
  renderCustomMealsList();
}

function parseOptionalNumber(el) {
  if (!el) return null;
  const raw = String(el.value ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error("Nutrition values must be zero or positive numbers.");
  return n;
}

function readCustomServingFromForm() {
  const amountEl = $("#customServingAmount");
  const unitEl = $("#customServingUnit");
  const raw = String(amountEl?.value ?? "").trim();
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Serving size amount must be a positive number.");
  }
  const unit = unitEl?.value || "mL";
  if (!SERVING_UNITS.some((u) => u.id === unit)) {
    throw new Error("Choose a serving unit: g, oz, mL, or L.");
  }
  return { amount, unit };
}

/** Collect macros/micros/calories; returns { nutrition, nutritionSource } or null if all empty */
function readCustomNutritionFromForm() {
  const cal = parseOptionalNumber($("#customCal"));
  const protein = parseOptionalNumber($("#customProtein"));
  const carbs = parseOptionalNumber($("#customCarbs"));
  const fat = parseOptionalNumber($("#customFat"));
  const fiber = parseOptionalNumber($("#customFiber"));
  const micros = {};
  let anyMicro = false;
  for (const k of CUSTOM_MICRO_KEYS) {
    const v = parseOptionalNumber($(`#customMicro_${k}`));
    if (v != null) {
      micros[k] = v;
      anyMicro = true;
    }
  }
  const any =
    cal != null || protein != null || carbs != null || fat != null || fiber != null || anyMicro;
  if (!any) return null;
  const nutrition = normalizeMealNutrition({
    calories: cal ?? 0,
    protein: protein ?? 0,
    carbs: carbs ?? 0,
    fat: fat ?? 0,
    fiber: fiber ?? 0,
    micros,
  });
  return { nutrition, nutritionSource: "user" };
}

function writeCustomNutritionToForm(n) {
  if (!n) return;
  if ($("#customCal")) $("#customCal").value = n.calories ?? "";
  if ($("#customProtein")) $("#customProtein").value = n.protein ?? "";
  if ($("#customCarbs")) $("#customCarbs").value = n.carbs ?? "";
  if ($("#customFat")) $("#customFat").value = n.fat ?? "";
  if ($("#customFiber")) $("#customFiber").value = n.fiber ?? "";
  for (const k of CUSTOM_MICRO_KEYS) {
    const el = $(`#customMicro_${k}`);
    if (el) el.value = n.micros?.[k] ?? "";
  }
}

function clearCustomNutritionFields() {
  for (const id of CUSTOM_MACRO_IDS) {
    if ($(`#${id}`)) $(`#${id}`).value = "";
  }
  for (const k of CUSTOM_MICRO_KEYS) {
    const el = $(`#customMicro_${k}`);
    if (el) el.value = "";
  }
}

function writeCustomServingToForm(serving) {
  if ($("#customServingAmount")) {
    $("#customServingAmount").value = serving?.amount != null ? serving.amount : "";
  }
  if ($("#customServingUnit")) {
    $("#customServingUnit").value = serving?.unit || "mL";
  }
}

function draftMealForEstimate() {
  const base = db.ingredients.find((i) => i.id === ($("#customMealBase")?.value || customDraft.baseId));
  const ingredients = customDraft.ingredientIds
    .map((id) => db.ingredients.find((i) => i.id === id))
    .filter(Boolean);
  if (!base || base.category !== "base") throw new Error("Pick a liquid base first.");
  if (ingredients.length < 2) throw new Error("Add at least 2 ingredients to estimate.");
  return { base, ingredients, title: "estimate" };
}

function fillCustomNutritionFromEstimate() {
  const draft = draftMealForEstimate();
  const n = nutritionForMeal({
    base: draft.base,
    ingredients: draft.ingredients,
    nutritionSource: null,
  });
  writeCustomNutritionToForm(n);
}

function populateCustomBaseSelect() {
  const sel = $("#customMealBase");
  if (!sel) return;
  const bases = (db.bases || db.ingredients.filter((i) => i.category === "base")).filter((b) =>
    passesRestrictionsSafe(b)
  );
  sel.innerHTML =
    `<option value="">Select a liquid base…</option>` +
    bases
      .map(
        (b) =>
          `<option value="${escapeHtml(b.id)}" ${customDraft.baseId === b.id ? "selected" : ""}>${iconFor(b)} ${escapeHtml(b.name)}</option>`
      )
      .join("");
  if (!customDraft.baseId && bases[0]) {
    customDraft.baseId = bases[0].id;
    sel.value = bases[0].id;
  }
}

function passesRestrictionsSafe(item) {
  const r = state.restrictions || { milk: true, gluten: true };
  // Inline check mirrors engine (avoid import cycle issues in bundle)
  if (!item?.wholeFood) return false;
  if (r.milk && item.milkFree === false) return false;
  if (r.gluten && item.glutenFree === false) return false;
  return true;
}

function renderCustomIngSearch(q) {
  const box = $("#customIngResults");
  if (!box) return;
  if (!q || q.length < 2) {
    box.innerHTML = `<span class="meta">Type at least 2 characters to search.</span>`;
    return;
  }
  const hits = filterIngredients(db.ingredients, state.restrictions || { milk: true, gluten: true }, q)
    .filter((i) => i.category !== "base")
    .filter((i) => !customDraft.ingredientIds.includes(i.id))
    .slice(0, 16);
  if (!hits.length) {
    box.innerHTML = `<span class="meta">No matching whole foods.</span>`;
    return;
  }
  box.innerHTML = hits
    .map(
      (i) =>
        `<button type="button" class="chip" data-add-ing="${i.id}">${iconFor(i)} ${escapeHtml(i.name)} <span class="meta">+</span></button>`
    )
    .join("");
  box.onclick = (e) => {
    const b = e.target.closest("[data-add-ing]");
    if (!b) return;
    if (customDraft.ingredientIds.length >= 5) {
      toast("Maximum 5 ingredients");
      return;
    }
    if (!customDraft.ingredientIds.includes(b.dataset.addIng)) {
      customDraft.ingredientIds.push(b.dataset.addIng);
      renderCustomIngSelected();
      renderCustomIngSearch($("#customIngSearch")?.value || "");
    }
  };
}

function renderCustomIngSelected() {
  const box = $("#customIngSelected");
  const count = $("#customIngCount");
  if (count) count.textContent = `(${customDraft.ingredientIds.length} / 5)`;
  if (!box) return;
  const items = customDraft.ingredientIds
    .map((id) => db.ingredients.find((i) => i.id === id))
    .filter(Boolean);
  box.innerHTML = items.length
    ? items
        .map(
          (i) =>
            `<span class="chip">${iconFor(i)} ${escapeHtml(i.name)} <button type="button" data-rm-ing="${i.id}" aria-label="Remove">×</button></span>`
        )
        .join("")
    : `<span class="meta">No ingredients yet — search and add 2–5 items.</span>`;
  box.onclick = (e) => {
    const b = e.target.closest("[data-rm-ing]");
    if (!b) return;
    customDraft.ingredientIds = customDraft.ingredientIds.filter((id) => id !== b.dataset.rmIng);
    renderCustomIngSelected();
    renderCustomIngSearch($("#customIngSearch")?.value || "");
  };
}

function saveCustomMealFromDraft() {
  syncPlanFormToState();
  const base = db.ingredients.find((i) => i.id === ($("#customMealBase")?.value || customDraft.baseId));
  const ingredients = customDraft.ingredientIds
    .map((id) => db.ingredients.find((i) => i.id === id))
    .filter(Boolean);
  const serving = readCustomServingFromForm();
  const nut = readCustomNutritionFromForm();
  const meal = buildCustomMeal({
    name: $("#customMealName")?.value,
    base,
    ingredients,
    restrictions: state.restrictions || { milk: true, gluten: true },
    serving,
    nutrition: nut?.nutrition || null,
    nutritionSource: nut?.nutritionSource || null,
  });
  state.customMeals = state.customMeals || [];
  state.customMeals.unshift(meal);
  if (state.customMeals.length > 40) state.customMeals.length = 40;
  saveState(state);
  award(state, "plan", 10);
  log("custom-meal", "saved", meal.title);
  return meal;
}

function clearCustomDraft(clearName) {
  customDraft = { baseId: customDraft.baseId, ingredientIds: [] };
  if (clearName && $("#customMealName")) $("#customMealName").value = "";
  if ($("#customIngSearch")) $("#customIngSearch").value = "";
  if ($("#customIngResults")) $("#customIngResults").innerHTML = "";
  writeCustomServingToForm(null);
  clearCustomNutritionFields();
  populateCustomBaseSelect();
  renderCustomIngSelected();
}

function renderCustomMealsList() {
  const box = $("#customMealsList");
  if (!box) return;
  const list = state.customMeals || [];
  if (!list.length) {
    box.innerHTML = `<p class="meta">No custom meals yet. Build one above and save it.</p>`;
    return;
  }
  box.innerHTML = list
    .map((m) => {
      const ings = (m.ingredients || []).map((i) => i.name).join(", ");
      const n = nutritionForMeal(m);
      const serving = formatServing(m.serving);
      const nutTag = hasUserNutrition(m) ? " · user nutrition" : "";
      const servingLine = serving ? `Serving ${escapeHtml(serving)} · ` : "";
      return `
      <div class="custom-meal-saved">
        <h4>${escapeHtml(m.title || m.name)}</h4>
        <p class="meta">${iconFor(m.base)} ${escapeHtml(m.base?.name || "Base")} · ${escapeHtml(ings)}</p>
        <p class="meta">${servingLine}~${n.calories} kcal · P ${n.protein}g · C ${n.carbs}g · F ${n.fat}g · Fiber ${n.fiber}g${nutTag}</p>
        <div class="btn-row">
          <button type="button" class="btn" data-use-custom="${m.id}">Add To Day 1</button>
          <button type="button" class="btn ghost" data-load-custom="${m.id}">Load In Builder</button>
          <button type="button" class="btn danger" data-del-custom="${m.id}">Delete</button>
        </div>
      </div>`;
    })
    .join("");

  box.onclick = (e) => {
    const use = e.target.closest("[data-use-custom]");
    const load = e.target.closest("[data-load-custom]");
    const del = e.target.closest("[data-del-custom]");
    if (use) {
      const meal = (state.customMeals || []).find((m) => m.id === use.dataset.useCustom);
      if (!meal) return;
      state.mealPlan = addCustomMealToPlan(state.mealPlan, meal, { day: 1, slotIndex: 0 });
      state.groceryList = buildGroceryList(state.mealPlan);
      saveState(state);
      renderPlan();
      renderHome();
      toast(`“${meal.title}” added to Day 1`);
    }
    if (load) {
      const meal = (state.customMeals || []).find((m) => m.id === load.dataset.loadCustom);
      if (!meal) return;
      if ($("#customMealName")) $("#customMealName").value = meal.title || meal.name || "";
      customDraft.baseId = meal.base?.id || null;
      customDraft.ingredientIds = (meal.ingredients || []).map((i) => i.id);
      populateCustomBaseSelect();
      renderCustomIngSelected();
      writeCustomServingToForm(meal.serving || null);
      if (meal.nutrition && (meal.nutritionSource === "user" || meal.customNutrition)) {
        writeCustomNutritionToForm(normalizeMealNutrition(meal.nutrition));
      } else {
        clearCustomNutritionFields();
      }
      toast("Loaded into builder");
    }
    if (del) {
      if (!confirm("Delete this custom meal?")) return;
      state.customMeals = (state.customMeals || []).filter((m) => m.id !== del.dataset.delCustom);
      saveState(state);
      renderCustomMealsList();
      toast("Custom meal deleted");
    }
  };
}

function syncPlanFormToState() {
  state.mealsPerDay = Number($("#mealsPerDay")?.value) || 2;
  state.ingredientCount = Number($("#ingredientCount")?.value) || 3;
  if ($("#restrictMilk") && $("#restrictGluten")) {
    state.restrictions = {
      milk: !!$("#restrictMilk").checked,
      gluten: !!$("#restrictGluten").checked,
    };
    if ($("#settingsRestrictMilk")) $("#settingsRestrictMilk").checked = state.restrictions.milk;
    if ($("#settingsRestrictGluten")) $("#settingsRestrictGluten").checked = state.restrictions.gluten;
  }
  saveState(state);
}

function renderPrefPicker(q) {
  const box = $("#prefResults");
  if (!q || q.length < 2) {
    box.innerHTML = "";
    return;
  }
  const hits = filterIngredients(db.ingredients, state.restrictions, q)
    .filter((i) => i.category !== "base")
    .slice(0, 12);
  box.innerHTML = hits
    .map((i) => `<button type="button" class="chip" data-id="${i.id}">${iconFor(i)} ${escapeHtml(i.name)}</button>`)
    .join("");
  box.onclick = (e) => {
    const b = e.target.closest("[data-id]");
    if (!b) return;
    if (!state.preferredIds.includes(b.dataset.id) && state.preferredIds.length < 5) {
      state.preferredIds.push(b.dataset.id);
      saveState(state);
      renderPrefSelected();
    }
  };
}

function renderPrefSelected() {
  const box = $("#prefSelected");
  const items = state.preferredIds.map((id) => db.ingredients.find((i) => i.id === id)).filter(Boolean);
  box.innerHTML =
    items
      .map(
        (i) =>
          `<span class="chip">${iconFor(i)} ${escapeHtml(i.name)} <button type="button" data-rm="${i.id}" aria-label="Remove">×</button></span>`
      )
      .join("") || `<span class="meta">No favorites pinned</span>`;
  box.onclick = (e) => {
    const b = e.target.closest("[data-rm]");
    if (!b) return;
    state.preferredIds = state.preferredIds.filter((id) => id !== b.dataset.rm);
    saveState(state);
    renderPrefSelected();
  };
}

function renderPlan() {
  renderPrefSelected();
  syncRestrictionControls();
  populateCustomBaseSelect();
  renderCustomIngSelected();
  renderCustomMealsList();
  const out = $("#planOutput");
  if (!out) return;
  if (!state.mealPlan) {
    ensureAutoMealPlan();
    if (!state.mealPlan) {
      out.innerHTML = `<div class="card"><p class="hint">Preparing your meal plan…</p></div>`;
      return;
    }
  }
  const plan = state.mealPlan;
  const planNut = nutritionForPlan(plan);
  out.innerHTML =
    `<div class="card"><p class="meta">Variation pool: ${plan.variationPoolSize} · endless ~${formatBig(
      plan.endlessCapacity || 0
    )} · avg/day ~${planNut.averagePerDay.calories} kcal · ${
      plan.restrictions.milk ? "no milk" : "milk ok"
    }, ${plan.restrictions.gluten ? "no gluten" : "gluten ok"}</p>
    <p class="hint">Use <strong>Rotate This Meal</strong> on any meal, or <strong>Rotate Meals</strong> for the whole week.</p></div>` +
    plan.plan
      .map(
        (day) => `
    <article class="card day-card">
      <h3>${escapeHtml(day.label)}</h3>
      <p class="meta">~${nutritionForDay(day).calories} kcal · P ${nutritionForDay(day).protein}g · C ${nutritionForDay(day).carbs}g · F ${nutritionForDay(day).fat}g</p>
      ${day.meals.map((m, i) => renderMealCard(m, { dayNum: day.day, mealIndex: i, showRotate: true })).join("")}
    </article>`
      )
      .join("");
  bindMealRotateButtons(out);
}

/* ---------- Grocery ---------- */
function bindGrocery() {
  $("#rebuildGroceryBtn").onclick = () => {
    if (!state.mealPlan) return toast("Generate a meal plan first");
    state.groceryList = buildGroceryList(state.mealPlan);
    state.analytics.groceriesBuilt = (state.analytics.groceriesBuilt || 0) + 1;
    award(state, "grocery", 10);
    saveState(state);
    renderGrocery();
    toast("Grocery list rebuilt");
  };
  $("#exportGroceryBtn").onclick = () => {
    if (!state.groceryList) return toast("No grocery list");
    downloadText("liquidfloodie-grocery.txt", groceryText(state.groceryList));
    toast("Exported");
  };
  $("#shareGroceryBtn").onclick = async () => {
    if (!state.groceryList) return toast("No grocery list");
    await shareOrCopy(groceryText(state.groceryList), "LiquidFloodie grocery list");
  };
}

function groceryText(list) {
  return ["LiquidFloodie Grocery List", ""]
    .concat((list.items || []).map((it) => `[${it.checked ? "x" : " "}] ${it.name} ×${it.qty}`))
    .join("\n");
}

function groceryQuery() {
  if (!state.groceryList?.items?.length) return "whole food smoothie milk free gluten free";
  return state.groceryList.items
    .slice(0, 8)
    .map((i) => i.name)
    .join(" ");
}

function renderThirdParty(targetId) {
  const el = $(targetId);
  if (!el) return;
  el.innerHTML = thirdPartyLinks(groceryQuery())
    .map((l) => `<a class="ext-link" href="${l.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.name)} ↗</a>`)
    .join("");
}

function renderGrocery() {
  renderThirdParty("#thirdPartyGrocery");
  const out = $("#groceryOutput");
  if (!state.groceryList?.items?.length) {
    out.innerHTML = `<div class="card"><p class="hint">No grocery list yet. Generate a weekly meal plan first.</p></div>`;
    return;
  }
  const byCat = new Map();
  for (const it of state.groceryList.items) {
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    byCat.get(it.category).push(it);
  }
  out.innerHTML = [...byCat.entries()]
    .map(
      ([cat, items]) => `
    <div class="card grocery-cat">
      <h3>${iconFor({ category: cat })} ${escapeHtml(cat)}</h3>
      ${items
        .map(
          (it) => `
        <label class="grocery-item ${it.checked ? "done" : ""}">
          <input type="checkbox" data-gid="${it.id}" ${it.checked ? "checked" : ""} />
          <span>${iconFor(it)} ${escapeHtml(it.name)} <strong>×${it.qty}</strong></span>
        </label>`
        )
        .join("")}
    </div>`
    )
    .join("");
  out.onchange = (e) => {
    const t = e.target;
    if (t.dataset.gid == null) return;
    const item = state.groceryList.items.find((i) => i.id === t.dataset.gid);
    if (item) {
      item.checked = t.checked;
      saveState(state);
      t.closest(".grocery-item")?.classList.toggle("done", t.checked);
    }
  };
}

/* ---------- Library (on Home) ---------- */
function bindLibrary() {
  if ($("#iconLegend")) $("#iconLegend").innerHTML = iconLegendHtml();
  $("#libSearch")?.addEventListener("input", () => {
    state.analytics.searches = (state.analytics.searches || 0) + 1;
    saveState(state);
    renderLibrary();
  });
  $("#libCategory")?.addEventListener("change", renderLibrary);
}

function renderLibrary() {
  if (!$("#libOutput")) return;
  const q = $("#libSearch")?.value || "";
  const cat = $("#libCategory")?.value || "";
  const all = filterIngredients(db.ingredients, state.restrictions || { milk: true, gluten: true }, q, cat);
  $("#libOutput").innerHTML = all
    .slice(0, 120)
    .map(
      (i) => `
    <article class="ing-card" role="listitem">
      <div class="ico">${iconFor(i)}</div>
      <div class="name">${escapeHtml(i.name)}</div>
      <div class="cat">${escapeHtml(i.category)}</div>
      <div class="tags">${(i.tags || []).slice(0, 3).map(escapeHtml).join(" · ")}</div>
    </article>`
    )
    .join("");
}

/* ---------- Nutrients ---------- */
function bindNutrients() {
  $("#nutrientDaySelect")?.addEventListener("change", () => {
    selectedNutrientDay = Number($("#nutrientDaySelect").value) || 1;
    renderNutrients();
  });
  $("#waterPlus250")?.addEventListener("click", () => addWater(250));
  $("#waterPlus500")?.addEventListener("click", () => addWater(500));
  $("#waterReset")?.addEventListener("click", () => {
    dailyLog().waterMlLogged = 0;
    saveState(state);
    renderNutrients();
    toast("Water log reset");
  });
  $("#saveWaterBtn")?.addEventListener("click", () => {
    dailyLog().waterMlLogged = Number($("#waterLogged").value) || 0;
    saveState(state);
    renderNutrients();
    toast("Water saved");
  });
  $("#saveFiberBtn")?.addEventListener("click", () => {
    dailyLog().extraFiber = Number($("#extraFiber").value) || 0;
    saveState(state);
    renderNutrients();
    toast("Fiber log saved");
  });
  $("#saveGoalsBtn")?.addEventListener("click", () => {
    const g = goals();
    g.calories = Number($("#goalCalories")?.value) || g.calories;
    g.protein = Number($("#goalProtein")?.value) || g.protein;
    g.carbs = Number($("#goalCarbs")?.value) || g.carbs;
    g.fat = Number($("#goalFat")?.value) || g.fat;
    g.fiber = Number($("#goalFiber")?.value) || g.fiber;
    g.waterMl = Number($("#goalWater")?.value) || g.waterMl;
    saveState(state);
    renderNutrients();
    toast("Goals saved");
  });
}

function addWater(ml) {
  const d = dailyLog();
  d.waterMlLogged = (d.waterMlLogged || 0) + ml;
  saveState(state);
  renderNutrients();
  toast(`+${ml} ml water`);
}

function barHtml(label, value, goal, unit = "") {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const over = goal > 0 && value > goal;
  return `
    <div class="nbar">
      <div class="nbar-label"><span>${escapeHtml(label)}</span><span>${value}${unit} / ${goal}${unit} (${pct}%)</span></div>
      <div class="nbar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(label)}">
        <div class="nbar-fill ${over ? "over" : ""}" style="width:${pct}%"></div>
      </div>
    </div>`;
}

function renderNutrients() {
  const g = goals();
  const plan = state.mealPlan;
  const sel = $("#nutrientDaySelect");
  if (sel) {
    if (plan?.plan?.length) {
      sel.innerHTML = plan.plan.map((d) => `<option value="${d.day}" ${d.day === selectedNutrientDay ? "selected" : ""}>${escapeHtml(d.label)}</option>`).join("");
      if (!plan.plan.some((d) => d.day === selectedNutrientDay)) selectedNutrientDay = plan.plan[0].day;
      sel.value = String(selectedNutrientDay);
    } else {
      sel.innerHTML = `<option value="1">No plan — day 1</option>`;
    }
  }

  const day = plan?.plan?.find((d) => d.day === selectedNutrientDay) || plan?.plan?.[0];
  const fromMeals = day ? nutritionForDay(day) : { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, waterMl: 0, micros: {} };
  const logD = dailyLog();
  const fiberTotal = Math.round((fromMeals.fiber + (logD.extraFiber || 0)) * 10) / 10;
  const waterTotal = fromMeals.waterMl + (logD.waterMlLogged || 0);

  $("#macroBars").innerHTML =
    barHtml("Calories", fromMeals.calories, g.calories, " kcal") +
    barHtml("Protein", fromMeals.protein, g.protein, " g") +
    barHtml("Carbs", fromMeals.carbs, g.carbs, " g") +
    barHtml("Fat", fromMeals.fat, g.fat, " g");

  $("#fiberBar").innerHTML = barHtml("Fiber (meals + log)", fiberTotal, g.fiber, " g");
  if ($("#extraFiber")) $("#extraFiber").value = logD.extraFiber || 0;

  $("#waterBar").innerHTML =
    barHtml("Water (meals + log)", waterTotal, g.waterMl, " ml") +
    `<p class="meta">From meals ~${fromMeals.waterMl} ml · Logged ${logD.waterMlLogged || 0} ml</p>`;
  if ($("#waterLogged")) $("#waterLogged").value = logD.waterMlLogged || 0;

  const micros = fromMeals.micros || {};
  $("#microBars").innerHTML = Object.entries(MICRO_LABELS)
    .map(([k, meta]) => {
      const goal = g.micros?.[k] || 0;
      const val = micros[k] || 0;
      return barHtml(`${meta.name} (${meta.unit})`, val, goal, "");
    })
    .join("");

  $("#goalsForm").innerHTML = `
    <label>Calories <input type="number" id="goalCalories" value="${g.calories}" min="0" /></label>
    <label>Protein (g) <input type="number" id="goalProtein" value="${g.protein}" min="0" /></label>
    <label>Carbs (g) <input type="number" id="goalCarbs" value="${g.carbs}" min="0" /></label>
    <label>Fat (g) <input type="number" id="goalFat" value="${g.fat}" min="0" /></label>
    <label>Fiber (g) <input type="number" id="goalFiber" value="${g.fiber}" min="0" /></label>
    <label>Water (ml) <input type="number" id="goalWater" value="${g.waterMl}" min="0" /></label>
  `;

  if (plan) {
    const overview = nutritionForPlan(plan);
    $("#planNutritionOverview").innerHTML = `
      Plan total ~${overview.total.calories} kcal · avg/day ~${overview.averagePerDay.calories} kcal<br/>
      Avg macros/day: P ${overview.averagePerDay.protein}g · C ${overview.averagePerDay.carbs}g · F ${overview.averagePerDay.fat}g · Fiber ${overview.averagePerDay.fiber}g<br/>
      ${overview.byDay.map((d) => `${escapeHtml(d.label)}: ${d.nutrition.calories} kcal`).join(" · ")}
    `;
  } else {
    $("#planNutritionOverview").textContent = "Generate a weekly meal plan to see multi-day nutrient overview.";
  }
}

/* ---------- Gamification (Settings) ---------- */
function bindGame() {
  if ($("#displayName")) {
    $("#displayName").value = state.gamification.displayName || "Foodie";
    $("#displayName").addEventListener("change", () => {
      state.gamification.displayName = $("#displayName").value.trim() || "Foodie";
      if (currentUser) {
        try {
          currentUser = updateProfile({ displayName: state.gamification.displayName });
          refreshUserChrome();
        } catch {
          /* ignore */
        }
      }
      saveState(state);
      renderGame();
    });
  }
  $("#shareProgressBtn")?.addEventListener("click", async () => {
    const g = state.gamification;
    await shareOrCopy(
      `LiquidFloodie: ${g.points || 0} pts · ${(g.badges || []).length} badges · ${state.analytics.plansGenerated || 0} plans.`,
      "LiquidFloodie achievements"
    );
    award(state, "share", 5);
  });
}

function renderGame() {
  const g = state.gamification;
  if (!$("#gameOutput")) return;
  const week = Object.keys(g.challenges || {}).sort().pop();
  const ch = (week && g.challenges[week]) || { plans: 0, groceries: 0, rotations: 0 };
  const badges = Object.entries(BADGE_META)
    .map(([id, meta]) => {
      const unlocked = (g.badges || []).includes(id);
      return `<div class="badge ${unlocked ? "" : "locked"}"><div class="bi">${meta.icon}</div><strong>${escapeHtml(meta.name)}</strong><div class="meta">${escapeHtml(meta.desc)}</div></div>`;
    })
    .join("");
  const board = [
    { name: g.displayName || "You", points: g.points || 0 },
    { name: "BlendBot", points: 80 },
    { name: "SipSage", points: 120 },
    { name: "WholePour", points: 45 },
  ].sort((a, b) => b.points - a.points);
  const joined = new Set(g.eventsJoined || []);
  const eventsHtml = EVENTS.map(
    (ev) => `
    <div class="event-row">
      <div><strong>${escapeHtml(ev.name)}</strong><div class="meta">${escapeHtml(ev.desc)} · +${ev.reward} pts</div></div>
      <button type="button" class="btn ${joined.has(ev.id) ? "ghost" : "primary"}" data-event="${ev.id}" ${joined.has(ev.id) ? "disabled" : ""}>${joined.has(ev.id) ? "Joined" : "Join"}</button>
    </div>`
  ).join("");
  const posts = [...(g.communityPosts || []), ...COMMUNITY_SEED].slice(0, 12);
  $("#gameOutput").innerHTML = `
    <div class="subcard">
      <strong>${escapeHtml(g.displayName || "Foodie")} · ${g.points || 0} pts</strong>
      <ul>
        <li>Plans: ${ch.plans}/3</li>
        <li>Grocery: ${ch.groceries}/2</li>
        <li>Rotations: ${ch.rotations}/2</li>
      </ul>
    </div>
    <div class="badge-grid">${badges}</div>
    <h4>Events</h4>${eventsHtml}
    <h4>Community</h4>
    <label>Tip<textarea id="communityText" rows="2"></textarea></label>
    <button type="button" class="btn" id="postCommunityBtn">Post tip</button>
    ${posts.map((p) => `<div class="community-post"><strong>${escapeHtml(p.author)}</strong><p>${escapeHtml(p.text)}</p></div>`).join("")}
    <h4>Leaderboard</h4>
    <ol class="leaderboard">${board.map((r, i) => `<li><span>#${i + 1} ${escapeHtml(r.name)}</span><strong>${r.points}</strong></li>`).join("")}</ol>
  `;
  $("#gameOutput").onclick = (e) => {
    const evBtn = e.target.closest("[data-event]");
    if (evBtn) {
      const ev = EVENTS.find((x) => x.id === evBtn.dataset.event);
      if (!ev) return;
      g.eventsJoined = g.eventsJoined || [];
      if (!g.eventsJoined.includes(ev.id)) {
        g.eventsJoined.push(ev.id);
        award(state, "event", ev.reward);
        toast(`Joined ${ev.name}`);
        renderGame();
      }
    }
  };
  $("#postCommunityBtn")?.addEventListener("click", () => {
    const text = $("#communityText")?.value?.trim();
    if (!text) return toast("Write a tip first");
    g.communityPosts = g.communityPosts || [];
    g.communityPosts.unshift({ id: `p-${Date.now()}`, author: g.displayName || "You", text, at: new Date().toISOString() });
    award(state, "community", 10);
    toast("Tip posted");
    renderGame();
  });
}

/* ---------- Settings ---------- */
function bindSettings() {
  syncRestrictionControls();

  $("#saveRestrictionsBtn")?.addEventListener("click", () => {
    saveDietaryRestrictions("settings");
    toast("Dietary restrictions saved");
  });
  $("#resetRestrictionsBtn")?.addEventListener("click", () => {
    state.restrictions = { milk: true, gluten: true };
    saveState(state);
    syncRestrictionControls();
    try {
      populateCustomBaseSelect();
      renderLibrary();
      renderHome();
    } catch {
      /* ignore */
    }
    toast("Restrictions reset to No Milk + No Gluten");
  });

  // Live toggle from Settings (synced to Weekly Plan checkboxes)
  $("#settingsRestrictMilk")?.addEventListener("change", () => {
    saveDietaryRestrictions("settings");
  });
  $("#settingsRestrictGluten")?.addEventListener("change", () => {
    saveDietaryRestrictions("settings");
  });

  $("#schedEnabled").checked = !!state.schedule?.enabled;
  $("#schedHour").value = state.schedule?.hour ?? 8;
  $("#schedMinute").value = state.schedule?.minute ?? 0;
  $("#schedAutoRotate").checked = !!state.schedule?.autoRotate;
  $("#notifEnabled").checked = !!state.settings?.notifications;

  $("#saveScheduleBtn").onclick = async () => {
    state.schedule = {
      ...state.schedule,
      enabled: $("#schedEnabled").checked,
      hour: Number($("#schedHour").value) || 0,
      minute: Number($("#schedMinute").value) || 0,
      autoRotate: $("#schedAutoRotate").checked,
      history: state.schedule?.history || [],
    };
    state.settings.notifications = $("#notifEnabled").checked;
    if (state.settings.notifications && "Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") toast("Notifications not granted");
    }
    saveState(state);
    renderSettings();
    toast("Schedule saved");
  };

  $("#exportAllBtn").onclick = () => {
    downloadText("liquidfloodie-backup.json", exportAll(state));
    toast("Backup exported");
  };
  $("#importFile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      state = importAll(await file.text());
      toast("Imported");
      renderAll();
    } catch (err) {
      toast(err.message || "Import failed");
    }
  };
  $("#deletePlanBtn").onclick = () => {
    if (!state.mealPlan) return toast("No plan");
    if (!confirm("Move meal plan to trash?")) return;
    state = softDelete(state, "mealPlan");
    renderAll();
  };
  $("#deleteGroceryBtn").onclick = () => {
    if (!state.groceryList) return toast("No list");
    if (!confirm("Move grocery list to trash?")) return;
    state = softDelete(state, "groceryList");
    renderAll();
  };
  $("#deleteAllBtn").onclick = () => {
    if (!confirm("Delete all user data?")) return;
    state = softDelete(state, "all");
    state = loadState();
    renderAll();
  };
  $("#sendFeedbackBtn").onclick = () => {
    const text = $("#feedbackText").value.trim();
    if (!text) return toast("Write feedback first");
    state.feedback = state.feedback || [];
    state.feedback.unshift({ at: new Date().toISOString(), text });
    $("#feedbackText").value = "";
    award(state, "feedback", 5);
    saveState(state);
    toast("Feedback saved");
  };
  $("#refreshLogsBtn").onclick = () => renderLogs();
  $("#clearLogsBtn").onclick = () => {
    clearLogs();
    renderLogs();
  };
  $("#exportHandoffBtn").onclick = () => {
    downloadText(
      "liquidfloodie-handoff.md",
      `# LiquidFloodie Handoff\n\nGenerated: ${new Date().toISOString()}\n\n- npm test && npm run build\n- docker compose up -d --build\n- Sections: Home, Weekly Plan, Grocery, Nutrients, Settings\n`
    );
    toast("Handoff exported");
  };
}

async function renderAccountPanel() {
  const box = $("#accountPanel");
  if (!box) return;
  currentUser = getCurrentUser();
  if (!currentUser) {
    box.innerHTML = `<p class="meta">${isGuestMode() ? "Guest mode — full app access without an account." : "Not signed in."} Create an account anytime for a named profile and gravatar.</p>
      <div class="btn-row">
        <button type="button" class="btn primary" id="openLoginBtn">Login / Register</button>
      </div>`;
    $("#openLoginBtn").onclick = () => openAuth("register", { required: false });
    return;
  }
  const avatar = await resolveAvatar(currentUser, 96);
  box.innerHTML = `
    <div class="account-row">
      <img class="avatar lg" src="${avatar}" alt="" width="64" height="64" />
      <div><strong>${escapeHtml(currentUser.displayName)}</strong><br/><span class="meta">${escapeHtml(currentUser.email)}</span></div>
    </div>
    <label class="check"><input type="radio" name="avatarMode" value="gravatar" ${currentUser.avatarMode !== "local" ? "checked" : ""}/> Gravatar</label>
    <label class="check"><input type="radio" name="avatarMode" value="local" ${currentUser.avatarMode === "local" ? "checked" : ""}/> Local avatar</label>
    <div class="btn-row">
      <button type="button" class="btn" id="saveAvatarBtn">Save avatar</button>
      <button type="button" class="btn danger" id="logoutBtn">Log out</button>
      <button type="button" class="btn ghost" id="openRecoverBtn">Password recovery</button>
    </div>`;
  $("#saveAvatarBtn").onclick = async () => {
    const mode = $$('input[name="avatarMode"]').find((r) => r.checked)?.value || "gravatar";
    currentUser = updateProfile({ avatarMode: mode });
    await refreshUserChrome();
    renderAccountPanel();
  };
  $("#logoutBtn").onclick = async () => {
    logout();
    currentUser = null;
    setGuestMode(true);
    await refreshUserChrome();
    unlockAppAfterAuth();
    renderAccountPanel();
    toast("Signed out — continuing as guest");
  };
  $("#openRecoverBtn").onclick = () => openAuth("recover");
}

function renderLogs() {
  const logs = loadLogs().slice(0, 40);
  $("#logsBox").textContent = logs.length
    ? logs.map((l) => `${l.at} [${l.level}] ${l.message}`).join("\n")
    : "No log entries yet.";
}

function renderSettings() {
  syncRestrictionControls();
  renderAccountPanel();
  renderGame();
  renderThirdParty("#thirdPartySettings");
  renderLogs();
  const a = state.analytics;
  $("#analyticsBox").innerHTML = `Sessions: ${a.sessions || 0}<br/>Plans: ${a.plansGenerated || 0}<br/>Grocery builds: ${a.groceriesBuilt || 0}<br/>Rotations: ${a.rotations || 0}<br/>Searches: ${a.searches || 0}<br/>Last open: ${a.lastOpen || "—"}`;
  const hist = state.schedule?.history || [];
  $("#scheduleReport").innerHTML = hist.length
    ? hist.slice(0, 8).map((h) => `${escapeHtml(h.at)} — ${escapeHtml(h.note)}`).join("<br/>")
    : "No scheduled jobs yet.";
  $("#securityBox").innerHTML = `<ul class="sec-list">
    <li>PBKDF2-SHA-256 passwords (120k iterations)</li>
    <li>Security-question recovery with salted answer hash</li>
    <li>On-device data (localStorage + IndexedDB)</li>
    <li>CSP, nosniff, frame denial; see SECURITY.md</li>
  </ul>`;
  $("#aboutMeta").textContent = `LiquidFloodie v1.2 · ${db.count} ingredients · Home / Weekly Plan / Grocery / Nutrients / Settings`;
  const trash = loadTrash();
  $("#trashList").innerHTML = trash.length
    ? trash
        .slice(0, 8)
        .map((t) => `<div class="meta">${escapeHtml(t.kind)} · ${escapeHtml(t.deletedAt)} <button type="button" class="btn ghost" data-recover="${t.id}">Recover</button></div>`)
        .join("")
    : `<p class="meta">Trash empty.</p>`;
  $("#trashList").onclick = (e) => {
    const b = e.target.closest("[data-recover]");
    if (!b) return;
    try {
      state = recoverFromTrash(state, b.dataset.recover);
      renderAll();
      toast("Recovered");
    } catch (err) {
      toast(err.message);
    }
  };
}

/* ---------- Search / share ---------- */
function bindSearch() {
  $("#searchToggle").onclick = () => {
    $("#quickSearchBar").classList.toggle("hide");
    if (!$("#quickSearchBar").classList.contains("hide")) $("#globalSearch").focus();
  };
  $("#globalSearch").addEventListener("input", () => {
    const q = $("#globalSearch").value;
    const box = $("#searchResults");
    if (!q || q.length < 2) {
      box.innerHTML = "";
      return;
    }
    state.analytics.searches = (state.analytics.searches || 0) + 1;
    saveState(state);
    box.innerHTML = filterIngredients(db.ingredients, state.restrictions, q)
      .slice(0, 15)
      .map((i) => `<button type="button" class="search-item" data-id="${i.id}">${iconFor(i)} ${escapeHtml(i.name)}</button>`)
      .join("");
  });
  $("#searchResults").onclick = (e) => {
    const b = e.target.closest("[data-id]");
    if (!b) return;
    showTab("home");
    if ($("#libSearch")) {
      $("#libSearch").value = db.ingredients.find((i) => i.id === b.dataset.id)?.name || "";
      renderLibrary();
    }
    $("#quickSearchBar").classList.add("hide");
  };
}

function bindShare() {
  $("#shareAppBtn").onclick = async () => {
    await shareOrCopy(
      `LiquidFloodie — whole-food liquid meals (milk-free & gluten-free). ${state.gamification.points || 0} pts.`,
      "LiquidFloodie"
    );
  };
}

async function shareOrCopy(text, title) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return;
    }
  } catch {
    /* cancel */
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch {
    downloadText("liquidfloodie-share.txt", text);
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderAll() {
  renderHome();
  renderLibrary();
  renderPlan();
  renderGrocery();
  renderNutrients();
  renderSettings();
}

function maybeScheduleTick() {
  setInterval(async () => {
    if (!state.schedule?.enabled) return;
    const now = new Date();
    if (now.getHours() !== Number(state.schedule.hour) || now.getMinutes() !== Number(state.schedule.minute)) return;
    const dayKey = now.toISOString().slice(0, 10);
    if (state.schedule.lastRun === dayKey) return;
    state.schedule.lastRun = dayKey;
    let note = "Reminder fired";
    if (state.schedule.autoRotate && state.mealPlan) {
      try {
        state.mealPlan = rotateMealPlan(state.mealPlan, db, { preferredIds: state.preferredIds });
        state.groceryList = buildGroceryList(state.mealPlan);
        state.analytics.rotations = (state.analytics.rotations || 0) + 1;
        note = "Reminder + auto-rotate";
      } catch {
        /* ignore */
      }
    }
    recordScheduleRun(state, note);
    if (state.settings?.notifications && "Notification" in window && Notification.permission === "granted") {
      new Notification("LiquidFloodie", { body: "Time to blend — check your daily meals.", icon: "icons/icon-192.png" });
    }
    toast("Scheduled meal reminder");
  }, 30_000);
}

function registerSW() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

boot();
