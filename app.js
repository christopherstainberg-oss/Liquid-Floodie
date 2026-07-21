/**
 * LiquidFloodie UI v1.2
 * Sections: Home (daily meals + library), Weekly Plan, Grocery, Nutrients, Settings
 */
import { INGREDIENT_DB } from "./data/ingredients.js";
import {
  filterIngredients,
  generateMealPlan,
  rotateMealPlan,
  buildGroceryList,
  planToShareText,
  thirdPartyLinks,
  estimateEndlessCapacity,
  buildMealSteps,
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
  DEFAULT_GOALS,
  MICRO_LABELS,
  todayKey,
} from "./src/nutrition.js";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

let state = loadState();
let db = INGREDIENT_DB;
let currentUser = getCurrentUser();
let selectedNutrientDay = 1;

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
  try {
    state = await hydrateFromDb(state);
  } catch {
    /* ignore */
  }
  goals();
  state.analytics.sessions = (state.analytics.sessions || 0) + 1;
  state.analytics.lastOpen = new Date().toISOString();
  saveState(state);
  log("session", "App opened");

  bindNav();
  bindHome();
  bindPlan();
  bindGrocery();
  bindNutrients();
  bindLibrary();
  bindGame();
  bindSettings();
  bindSearch();
  bindShare();
  bindAuth();
  maybeScheduleTick();

  const go = new URLSearchParams(location.search).get("go");
  if (go) {
    const map = { rewards: "settings", game: "settings", library: "home", nutrients: "nutrients" };
    showTab(map[go] || go);
  }

  await refreshUserChrome();
  renderAll();
  registerSW();
}

function toast(msg) {
  const t = $("#toast");
  t.hidden = false;
  t.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.hidden = true;
  }, 2800);
}

function showTab(name) {
  $$(".tab").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-current", on ? "page" : "false");
  });
  $$(".panel").forEach((p) => {
    const on = p.id === `panel-${name}`;
    p.classList.toggle("active", on);
    p.hidden = !on;
  });
  if (name === "home") {
    renderHome();
    renderLibrary();
  }
  if (name === "grocery") renderGrocery();
  if (name === "plan") renderPlan();
  if (name === "nutrients") renderNutrients();
  if (name === "settings") renderSettings();
}

function bindNav() {
  $("#tabNav").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    showTab(btn.dataset.tab);
  });
}

/* ---------- Auth ---------- */
function bindAuth() {
  const modal = $("#authModal");
  $("#accountBtn").onclick = () => {
    if (currentUser) {
      showTab("settings");
      return;
    }
    openAuth("login");
  };
  $("#authClose").onclick = () => modal.classList.add("hide");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hide");
  });
  $$(".auth-tab").forEach((tab) => {
    tab.onclick = () => openAuth(tab.dataset.auth);
  });
  const qs = listSecurityQuestions();
  $("#regQuestion").innerHTML = qs.map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`).join("");

  $("#formLogin").onsubmit = async (e) => {
    e.preventDefault();
    try {
      currentUser = await login($("#loginEmail").value, $("#loginPassword").value);
      if (currentUser.displayName) state.gamification.displayName = currentUser.displayName;
      saveState(state);
      log("auth", "login ok", currentUser.email);
      modal.classList.add("hide");
      await refreshUserChrome();
      renderAll();
      toast(`Welcome back, ${currentUser.displayName}`);
    } catch (err) {
      toast(err.message);
    }
  };

  $("#formRegister").onsubmit = async (e) => {
    e.preventDefault();
    try {
      currentUser = await registerAccount({
        email: $("#regEmail").value,
        password: $("#regPassword").value,
        displayName: $("#regName").value,
        securityQuestion: $("#regQuestion").value,
        securityAnswer: $("#regAnswer").value,
      });
      state.gamification.displayName = currentUser.displayName;
      saveState(state);
      modal.classList.add("hide");
      await refreshUserChrome();
      renderAll();
      toast("Account created");
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
      currentUser = await recoverPassword({
        email: $("#recEmail").value,
        securityAnswer: $("#recAnswer").value,
        newPassword: $("#recPassword").value,
      });
      modal.classList.add("hide");
      await refreshUserChrome();
      renderAll();
      toast("Password reset — you are signed in");
    } catch (err) {
      toast(err.message);
    }
  };
}

function openAuth(which) {
  $("#authModal").classList.remove("hide");
  $$(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.auth === which));
  $("#formLogin").classList.toggle("hide", which !== "login");
  $("#formRegister").classList.toggle("hide", which !== "register");
  $("#formRecover").classList.toggle("hide", which !== "recover");
  $("#authTitle").textContent =
    which === "login" ? "Login" : which === "register" ? "Create account" : "Password recovery";
}

async function refreshUserChrome() {
  currentUser = getCurrentUser();
  const avatar = await resolveAvatar(currentUser, 64);
  $("#headerAvatar").src = avatar;
  $("#headerAvatar").alt = currentUser ? currentUser.displayName : "Guest";
  $("#headerUserLabel").textContent = currentUser ? currentUser.displayName : "Sign in";
}

/* ---------- Home: daily meals + library ---------- */
function bindHome() {
  $("#goPlanBtn").onclick = () => showTab("plan");
  $("#goNutrientsBtn").onclick = () => showTab("nutrients");
  $("#goHowToBtn").onclick = () => $("#howtoCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const a = state.analytics;
  const endless = estimateEndlessCapacity(db, state.ingredientCount || 3);
  const day = currentPlanDay();
  const dayNut = day ? nutritionForDay(day) : null;
  $("#homeStats").innerHTML = `
    <div class="stat"><b>${db.count.toLocaleString()}</b><span>Whole Foods</span></div>
    <div class="stat"><b>${a.plansGenerated || 0}</b><span>Plans Made</span></div>
    <div class="stat"><b>${dayNut ? dayNut.calories : "—"}</b><span>Today Kcal (Est.)</span></div>
    <div class="stat"><b>${formatBig(endless)}</b><span>Variations</span></div>
  `;

  const out = $("#dailyMealsOutput");
  if (!day) {
    out.innerHTML = `<p class="hint">No Weekly Plan Yet. <button type="button" class="btn primary" id="homeGenPlan">Create Weekly Plan</button></p>`;
    $("#homeGenPlan")?.addEventListener("click", () => showTab("plan"));
    return;
  }
  out.innerHTML = `
    <p class="meta"><strong>${escapeHtml(day.label)}</strong> · ${day.meals.length} Meal(s) · ~${dayNut.calories} Kcal · ${dayNut.protein}g Protein · ${dayNut.fiber}g Fiber</p>
    ${day.meals.map((m) => renderMealCard(m)).join("")}
    <div class="btn-row">
      <button type="button" class="btn ghost" id="homeOpenPlan">Open Full Weekly Plan</button>
      <button type="button" class="btn ghost" id="homeOpenNutrients">View Nutrients</button>
    </div>
  `;
  $("#homeOpenPlan").onclick = () => showTab("plan");
  $("#homeOpenNutrients").onclick = () => showTab("nutrients");
}

function renderMealCard(m, compact = false) {
  const n = nutritionForMeal(m);
  const steps = m.steps?.length ? m.steps : buildMealSteps(m.base, m.ingredients);
  return `
    <div class="meal">
      <div class="slot">${escapeHtml(m.slot || "Meal")}</div>
      <div class="meal-title">${escapeHtml(m.title)}</div>
      <p class="hint">${escapeHtml(m.blurb)}</p>
      <p class="meta">~${n.calories} kcal · P ${n.protein}g · C ${n.carbs}g · F ${n.fat}g · Fiber ${n.fiber}g</p>
      <div class="meal-ing">
        <span class="chip">${iconFor(m.base)} ${escapeHtml(m.base.name)} <em>(base)</em></span>
        ${m.ingredients.map((i) => `<span class="chip">${iconFor(i)} ${escapeHtml(i.name)}</span>`).join("")}
      </div>
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
function bindPlan() {
  $("#generatePlanBtn").onclick = () => {
    try {
      syncPlanFormToState();
      const plan = generateMealPlan(db, {
        days: 5,
        mealsPerDay: state.mealsPerDay,
        ingredientCount: state.ingredientCount,
        restrictions: state.restrictions,
        preferredIds: state.preferredIds,
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
      log("plan", "generated", plan.id);
      renderPlan();
      renderHome();
      toast("Weekly meal plan ready");
    } catch (e) {
      toast(e.message || "Could not generate plan");
    }
  };

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

  $("#prefSearch").addEventListener("input", () => renderPrefPicker($("#prefSearch").value));
  $("#mealsPerDay").value = String(state.mealsPerDay || 2);
  $("#ingredientCount").value = String(state.ingredientCount || 3);
  $("#restrictMilk").checked = !!state.restrictions.milk;
  $("#restrictGluten").checked = !!state.restrictions.gluten;
}

function syncPlanFormToState() {
  state.mealsPerDay = Number($("#mealsPerDay").value) || 2;
  state.ingredientCount = Number($("#ingredientCount").value) || 3;
  state.restrictions = {
    milk: $("#restrictMilk").checked,
    gluten: $("#restrictGluten").checked,
  };
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
  const out = $("#planOutput");
  if (!state.mealPlan) {
    out.innerHTML = `<div class="card"><p class="hint">No weekly plan yet. Choose options and generate.</p></div>`;
    return;
  }
  const plan = state.mealPlan;
  const planNut = nutritionForPlan(plan);
  out.innerHTML =
    `<div class="card"><p class="meta">Variation pool: ${plan.variationPoolSize} · endless ~${formatBig(
      plan.endlessCapacity || 0
    )} · avg/day ~${planNut.averagePerDay.calories} kcal · ${
      plan.restrictions.milk ? "no milk" : "milk ok"
    }, ${plan.restrictions.gluten ? "no gluten" : "gluten ok"}</p></div>` +
    plan.plan
      .map(
        (day) => `
    <article class="card day-card">
      <h3>${escapeHtml(day.label)}</h3>
      <p class="meta">~${nutritionForDay(day).calories} kcal</p>
      ${day.meals.map((m) => renderMealCard(m)).join("")}
    </article>`
      )
      .join("");
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
  if ($("#libMeta")) {
    $("#libMeta").textContent = `Showing ${Math.min(all.length, 120)} of ${all.length.toLocaleString()} matches (${db.count.toLocaleString()} total)`;
  }
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
    box.innerHTML = `<p class="meta">Not signed in.</p><button type="button" class="btn primary" id="openLoginBtn">Login / Register</button>`;
    $("#openLoginBtn").onclick = () => openAuth("login");
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
    await refreshUserChrome();
    renderAccountPanel();
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
