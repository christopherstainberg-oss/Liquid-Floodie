/**
 * LiquidFloodie UI v1.2
 * Sections: Home (daily meals), Weekly Plan, Grocery, Nutrients, Settings
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
  buildMealSteps,
  buildCustomMeal,
  addCustomMealToPlan,
  buildCustomIngredient,
  mergeIngredientDb,
  RESTRICTION_PRESETS,
  defaultRestrictions,
  normalizeRestrictions,
  restrictionsSummary,
  passesRestrictions,
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
  cryptoReady,
} from "./src/auth.js";
import { iconFor } from "./src/icons.js";
import {
  nutritionForMeal,
  nutritionForPlan,
  nutritionForDay,
  nutritionBreakdownForDay,
  nutritionBreakdownForMeal,
  nutritionForItem,
  DEFAULT_GOALS,
  MICRO_LABELS,
  SERVING_UNITS,
  formatServing,
  normalizeMealNutrition,
  hasUserNutrition,
  todayKey,
} from "./src/nutrition.js";
import {
  NAV_TECHNIQUES,
  storeMeta,
  sortGroceryByStorePath,
  groceryCostTotals,
  enrichGroceryItem,
  formatMoney,
} from "./src/grocery-nav.js";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

let state = loadState();
state.restrictions = normalizeRestrictions(state.restrictions || defaultRestrictions());
if (!Array.isArray(state.customIngredients)) state.customIngredients = [];
// Drop any accidental internal keys from older sessions
if (state._lastAppliedRestrictions) delete state._lastAppliedRestrictions;
let db = mergeIngredientDb(INGREDIENT_DB, state.customIngredients);
let currentUser = getCurrentUser();
let selectedNutrientDay = 1;
/** Last restrictions applied to plan regen (in-memory only) */
let lastAppliedRestrictions = structuredClone(state.restrictions);

/** Rebuild runtime catalog including user custom ingredients */
function rebuildIngredientDb() {
  if (!Array.isArray(state.customIngredients)) state.customIngredients = [];
  db = mergeIngredientDb(INGREDIENT_DB, state.customIngredients);
  return db;
}

function findIngredient(id) {
  if (!id) return null;
  return (
    db.ingredients.find((i) => i.id === id) ||
    (state.customIngredients || []).find((i) => i.id === id) ||
    null
  );
}

/** Only a signed-in account may use the app (no guest mode) */
function canUseApp() {
  return !!getCurrentUser();
}

/** Clear legacy guest session flag if present */
try {
  sessionStorage.removeItem("liquidfloodie.guest.v1");
} catch {
  /* ignore */
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
  // Wire nav + auth FIRST and show the gate immediately so Login / Create Account
  // respond even while meal-plan generation or hydrate is still running.
  try {
    bindNav();
  } catch (e) {
    console.warn("bindNav", e);
  }
  try {
    bindAuth();
  } catch (e) {
    console.error("bindAuth failed — login buttons will not work", e);
    toast("Auth UI failed to start. Try a hard refresh.", "error");
  }

  currentUser = getCurrentUser();
  if (!canUseApp()) {
    lockAppForAuth();
    openAuth("login", { required: true });
  }

  try {
    state = await hydrateFromDb(state);
    state.restrictions = normalizeRestrictions(state.restrictions || defaultRestrictions());
    if (!Array.isArray(state.customIngredients)) state.customIngredients = [];
    rebuildIngredientDb();
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

  const binders = [
    bindHome,
    bindPlan,
    bindGrocery,
    bindNutrients,
    bindCustomIngredients,
    bindSettings,
    bindSearch,
    bindShare,
  ];
  for (const fn of binders) {
    try {
      fn();
    } catch (e) {
      console.warn(fn.name || "bind", e);
    }
  }
  try {
    maybeScheduleTick();
  } catch (e) {
    console.warn("schedule", e);
  }

  currentUser = getCurrentUser();
  const params = new URLSearchParams(location.search);

  // Heavy work after auth UI is live
  try {
    ensureAutoMealPlan();
  } catch (e) {
    console.warn("auto meal plan", e);
  }

  try {
    await refreshUserChrome();
    renderAll();
  } catch (e) {
    console.warn("initial render", e);
  }

  // Account required — no guest access
  if (canUseApp()) {
    unlockAppAfterAuth();
    const go = params.get("go");
    if (go) {
      const map = { rewards: "settings", game: "settings", library: "nutrients", nutrients: "nutrients", search: "home" };
      showTab(map[go] || go);
    } else {
      showTab("home");
    }
  } else {
    lockAppForAuth();
    openAuth("login", { required: true });
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
      restrictions: getRestrictions(),
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
    restrictions: getRestrictions(),
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

function toast(msg, kind = "info") {
  const t = $("#toast");
  if (!t) return;
  t.hidden = false;
  t.textContent = msg;
  t.dataset.kind = kind === "error" ? "error" : "info";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.hidden = true;
    delete t.dataset.kind;
  }, kind === "error" ? 4200 : 2800);
}

function showAuthError(msg) {
  const el = $("#authError");
  if (el) {
    el.hidden = !msg;
    el.textContent = msg || "";
    el.classList.toggle("is-visible", !!msg);
  }
  if (msg) toast(msg, "error");
}

function clearAuthError() {
  showAuthError("");
}

function showTab(name) {
  if (!name) return;
  if (!canUseApp()) {
    lockAppForAuth();
    openAuth("login", { required: true });
    return;
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
  if (user?.displayName) state.gamification.displayName = user.displayName;
  saveState(state);
  unlockAppAfterAuth();
  await refreshUserChrome();
  showTab("home");
  renderAll();
  toast(message || `Welcome, ${user.displayName}`);
}

function setAuthBusy(form, busy, label) {
  if (!form) return;
  form.querySelectorAll("button[type='submit'], button[type='button']").forEach((btn) => {
    if (busy) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent || "";
      btn.disabled = true;
      if (btn.type === "submit" && label) btn.textContent = label;
    } else {
      btn.disabled = false;
      if (btn.dataset.label) {
        btn.textContent = btn.dataset.label;
        delete btn.dataset.label;
      }
    }
  });
}

function bindAuth() {
  const modal = $("#authModal");
  if (!modal) {
    console.error("authModal missing from DOM");
    return;
  }

  const accountBtn = $("#accountBtn");
  if (accountBtn) {
    accountBtn.onclick = () => {
      if (getCurrentUser()) {
        showTab("settings");
        return;
      }
      openAuth("login", { required: true });
    };
  }

  // Close only allowed when already signed in (gate cannot be dismissed)
  const authClose = $("#authClose");
  if (authClose) {
    authClose.onclick = () => {
      if (!getCurrentUser()) {
        showAuthError("Create an account or log in to use LiquidFloodie");
        return;
      }
      unlockAppAfterAuth();
    };
  }
  modal.addEventListener("click", (e) => {
    if (e.target !== modal) return;
    // Required gate: do not dismiss without an account
    if (!getCurrentUser()) return;
    unlockAppAfterAuth();
  });

  $$(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearAuthError();
      openAuth(tab.dataset.auth, { required: !canUseApp() });
    });
  });

  const qs = listSecurityQuestions();
  const regQ = $("#regQuestion");
  if (regQ) {
    regQ.innerHTML = qs
      .map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`)
      .join("");
  }

  let loginInFlight = false;
  let registerInFlight = false;

  function clearAuthPasswordFields() {
    for (const id of ["loginPassword", "regPassword", "recPassword"]) {
      const el = document.getElementById(id);
      if (el) el.value = "";
    }
  }

  async function handleLogin(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (loginInFlight) return;
    clearAuthError();
    const form = $("#formLogin");
    const email = ($("#loginEmail")?.value || "").trim();
    const password = $("#loginPassword")?.value || "";
    if (!email || !email.includes("@")) {
      showAuthError("Enter a valid email address.");
      $("#loginEmail")?.focus();
      return;
    }
    if (!password || password.length < 8) {
      showAuthError("Password must be at least 8 characters.");
      $("#loginPassword")?.focus();
      return;
    }
    loginInFlight = true;
    setAuthBusy(form, true, "Signing in…");
    try {
      const user = await login(email, password);
      log("auth", "login ok", user.email);
      clearAuthPasswordFields();
      await onAuthSuccess(user, `Welcome back, ${user.displayName}`);
    } catch (err) {
      console.error("login failed", err);
      showAuthError(err?.message || "Sign in failed.");
      $("#loginPassword")?.focus();
      $("#loginPassword")?.select?.();
    } finally {
      loginInFlight = false;
      setAuthBusy(form, false);
    }
  }

  async function handleRegister(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (registerInFlight) return;
    clearAuthError();
    const form = $("#formRegister");
    const email = ($("#regEmail")?.value || "").trim();
    const password = $("#regPassword")?.value || "";
    const answer = ($("#regAnswer")?.value || "").trim();
    if (!email || !email.includes("@")) {
      showAuthError("Enter a valid email address.");
      $("#regEmail")?.focus();
      return;
    }
    if (!password || password.length < 8) {
      showAuthError("Password must be at least 8 characters.");
      $("#regPassword")?.focus();
      return;
    }
    if (!answer) {
      showAuthError("Enter an answer for your security question.");
      $("#regAnswer")?.focus();
      return;
    }
    registerInFlight = true;
    setAuthBusy(form, true, "Creating…");
    try {
      const user = await registerAccount({
        email,
        password,
        displayName: $("#regName")?.value,
        securityQuestion: $("#regQuestion")?.value,
        securityAnswer: answer,
      });
      log("auth", "register ok", user.email);
      // Prefill login email for later sessions; never leave secrets in the DOM
      if ($("#loginEmail")) $("#loginEmail").value = email;
      clearAuthPasswordFields();
      if ($("#regAnswer")) $("#regAnswer").value = "";
      await onAuthSuccess(user, "Account created — welcome to LiquidFloodie");
    } catch (err) {
      console.error("register failed", err);
      showAuthError(err?.message || "Could not create account.");
    } finally {
      registerInFlight = false;
      setAuthBusy(form, false);
    }
  }

  let recoverInFlight = false;

  function loadRecoveryQuestion({ silent = false } = {}) {
    clearAuthError();
    const email = ($("#recEmail")?.value || "").trim();
    if (!email) {
      if (!silent) {
        showAuthError("Enter your account email, then load your security question.");
        $("#recEmail")?.focus();
      }
      return false;
    }
    try {
      const q = getRecoveryQuestion(email);
      const box = $("#recQuestion");
      if (box) {
        box.textContent = q;
        box.classList.add("rec-question-loaded");
      }
      if (!silent) toast("Security question loaded");
      return true;
    } catch (err) {
      if ($("#recQuestion")) {
        $("#recQuestion").textContent = "—";
        $("#recQuestion").classList.remove("rec-question-loaded");
      }
      if (!silent) showAuthError(err?.message || "Could not load security question.");
      return false;
    }
  }

  async function handleRecover(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (recoverInFlight) return;
    clearAuthError();

    const form = $("#formRecover");
    const email = ($("#recEmail")?.value || "").trim();
    const answer = ($("#recAnswer")?.value || "").trim();
    const newPassword = $("#recPassword")?.value || "";

    if (!email || !email.includes("@")) {
      showAuthError("Enter the email for your account.");
      $("#recEmail")?.focus();
      return;
    }
    if (!answer) {
      showAuthError("Enter the answer to your security question.");
      // Try to surface the question so the user knows what to answer
      loadRecoveryQuestion({ silent: true });
      $("#recAnswer")?.focus();
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      showAuthError("New password must be at least 8 characters.");
      $("#recPassword")?.focus();
      return;
    }

    recoverInFlight = true;
    setAuthBusy(form, true, "Resetting…");
    try {
      const user = await recoverPassword({
        email,
        securityAnswer: answer,
        newPassword,
      });
      log("auth", "password recovered", user.email);
      await onAuthSuccess(user, "Password reset — you are signed in");
    } catch (err) {
      console.error("recover failed", err);
      showAuthError(err?.message || "Password recovery failed.");
      $("#recoverSubmitBtn")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } finally {
      recoverInFlight = false;
      setAuthBusy(form, false);
    }
  }

  const formLogin = $("#formLogin");
  const formRegister = $("#formRegister");
  const formRecover = $("#formRecover");

  /**
   * Wire each auth form once. Prefer the submit event (Enter + button).
   * Also listen on the submit button click as a fallback for environments where
   * form submit is swallowed — inFlight guards prevent double password hashing.
   */
  function wireAuthForm(form, button, handler) {
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handler(e);
    });
    if (button) {
      button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handler(e);
      });
    }
  }

  wireAuthForm(formLogin, $("#loginSubmitBtn"), handleLogin);
  wireAuthForm(formRegister, $("#registerSubmitBtn"), handleRegister);
  wireAuthForm(formRecover, $("#recoverSubmitBtn"), handleRecover);

  $("#loadQuestionBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    loadRecoveryQuestion({ silent: false });
  });

  // Auto-load question when email is filled and user moves to answer/password
  $("#recEmail")?.addEventListener("change", () => loadRecoveryQuestion({ silent: true }));
  $("#recAnswer")?.addEventListener("focus", () => {
    const q = ($("#recQuestion")?.textContent || "").trim();
    if (!q || q === "—") loadRecoveryQuestion({ silent: true });
  });
}

function openAuth(which, opts = {}) {
  const modal = $("#authModal");
  if (!modal) return;
  const required = !!opts.required || !getCurrentUser();
  clearAuthError();

  modal.classList.remove("hide");
  if (required) {
    // Full-screen gate: must create account or log in
    modal.classList.add("auth-gate");
    document.body.classList.add("auth-locked");
    $("#authClose")?.classList.add("hide");
  } else {
    modal.classList.remove("auth-gate");
    document.body.classList.remove("auth-locked");
    $("#authClose")?.classList.remove("hide");
  }

  $$(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.auth === which));
  $("#formLogin")?.classList.toggle("hide", which !== "login");
  $("#formRegister")?.classList.toggle("hide", which !== "register");
  $("#formRecover")?.classList.toggle("hide", which !== "recover");
  if ($("#authTitle")) {
    $("#authTitle").textContent =
      which === "login" ? "Login" : which === "register" ? "Create Account" : "Password Recovery";
  }
  if ($(".auth-tagline")) {
    let base =
      which === "recover"
        ? "Enter your email, load your security question, answer it, then set a new password."
        : required
          ? "Log in or create an account to use LiquidFloodie. Accounts stay on this device."
          : "Whole-Food Liquid Meals While Maintaining Dietary Restrictions";
    if (!cryptoReady()) {
      base += " (Secure hashing fallback active — prefer HTTPS when available.)";
    }
    $(".auth-tagline").textContent = base;
  }

  // Prefill recover email from login field or current session
  if (which === "recover") {
    const rec = $("#recEmail");
    if (rec && !rec.value) {
      const fromLogin = ($("#loginEmail")?.value || "").trim();
      const fromUser = getCurrentUser()?.email || "";
      rec.value = fromLogin || fromUser || "";
    }
    if ($("#recQuestion") && (!$("#recQuestion").textContent || $("#recQuestion").textContent === "—")) {
      // leave placeholder until load
    }
  }

  setTimeout(() => {
    const id = which === "login" ? "loginEmail" : which === "register" ? "regEmail" : "recEmail";
    document.getElementById(id)?.focus();
    if (which === "recover") {
      $("#recoverSubmitBtn")?.scrollIntoView({ block: "nearest" });
    }
  }, 50);
}

async function refreshUserChrome() {
  currentUser = getCurrentUser();
  const avatar = await resolveAvatar(currentUser, 64);
  if ($("#headerAvatar")) {
    $("#headerAvatar").src = avatar;
    $("#headerAvatar").alt = currentUser ? currentUser.displayName : "Sign In";
  }
  if ($("#headerUserLabel")) {
    $("#headerUserLabel").textContent = currentUser ? currentUser.displayName : "Sign In";
  }
}

/* ---------- Home: daily meals ---------- */
function bindHome() {
  $("#goPlanBtn").onclick = () => showTab("plan");
  $("#goNutrientsBtn").onclick = () => showTab("nutrients");
  $("#homeOpenSettingsRestrictions")?.addEventListener("click", () => showTab("settings"));
}

function getRestrictions() {
  return normalizeRestrictions(state.restrictions || defaultRestrictions());
}

function restrictionsSummaryText() {
  const parts = restrictionsSummary(getRestrictions());
  if (!parts.length) {
    return "No dietary restrictions active — all whole foods are available for meals and the grocery list.";
  }
  return `Currently avoiding: ${parts.join(" · ")}. Applied to daily meals, weekly plan, Quick Search, and grocery list.`;
}

function restrictionsEqual(a, b) {
  const x = normalizeRestrictions(a);
  const y = normalizeRestrictions(b);
  for (const p of RESTRICTION_PRESETS) {
    if (!!x[p.id] !== !!y[p.id]) return false;
  }
  const xc = [...(x.custom || [])].sort().join("|");
  const yc = [...(y.custom || [])].sort().join("|");
  return xc === yc;
}

/** Build checkbox grid for plan or settings forms */
function renderRestrictionCheckboxes(containerId, prefix) {
  const el = $(containerId);
  if (!el) return;
  const r = getRestrictions();
  el.innerHTML = RESTRICTION_PRESETS.map(
    (p) => `
    <label class="check restriction-item">
      <input type="checkbox" data-restriction-id="${p.id}" id="${prefix}Restrict_${p.id}" ${r[p.id] ? "checked" : ""} />
      <span>
        <strong>${escapeHtml(p.label)}</strong>
        <span class="meta">${escapeHtml(p.description)}</span>
      </span>
    </label>`
  ).join("");
  el.querySelectorAll("input[data-restriction-id]").forEach((input) => {
    input.addEventListener("change", () => {
      saveDietaryRestrictions(prefix === "plan" ? "plan" : "settings");
    });
  });
}

function renderCustomRestrictionChips(containerId) {
  const el = $(containerId);
  if (!el) return;
  const custom = getRestrictions().custom || [];
  if (!custom.length) {
    el.innerHTML = `<span class="meta">No custom restrictions yet.</span>`;
    return;
  }
  el.innerHTML = custom
    .map(
      (c) => `
    <button type="button" class="chip rem" data-custom-restrict="${escapeHtml(c)}" title="Remove restriction">
      No ${escapeHtml(c)} ×
    </button>`
    )
    .join("");
  el.querySelectorAll("[data-custom-restrict]").forEach((btn) => {
    btn.onclick = () => {
      const term = btn.dataset.customRestrict;
      const r = getRestrictions();
      r.custom = (r.custom || []).filter((c) => c !== term);
      state.restrictions = r;
      applyRestrictionChange(true);
      toast(`Removed “${term}” restriction`);
    };
  });
}

function addCustomRestriction(inputId) {
  const input = $(inputId);
  if (!input) return;
  const term = String(input.value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!term) return toast("Enter a food or keyword to avoid");
  if (term.length < 2) return toast("Use at least 2 characters");
  const r = getRestrictions();
  if ((r.custom || []).includes(term)) return toast("Already in your list");
  r.custom = [...(r.custom || []), term].slice(0, 20);
  state.restrictions = r;
  input.value = "";
  applyRestrictionChange(true);
  toast(`Added restriction: No “${term}”`);
}

/** Sync dietary restriction checkboxes (Settings is source of truth) */
function syncRestrictionControls() {
  state.restrictions = getRestrictions();
  renderRestrictionCheckboxes("#dietaryRestrictionsForm", "settings");
  renderCustomRestrictionChips("#settingsCustomRestrictionChips");
  const text = restrictionsSummaryText();
  if ($("#restrictionsStatus")) $("#restrictionsStatus").textContent = text;
  if ($("#planRestrictionsStatus")) {
    $("#planRestrictionsStatus").textContent = text + " Manage full list in Settings.";
  }
  if ($("#homeRestrictionsStatus")) $("#homeRestrictionsStatus").textContent = text;
  if ($("#groceryRestrictionsStatus")) {
    const parts = restrictionsSummary(getRestrictions());
    $("#groceryRestrictionsStatus").textContent = parts.length
      ? `Grocery list respects: ${parts.join(" · ")}`
      : "Grocery list includes all plan ingredients (no restrictions active).";
  }
}

/**
 * Persist restriction change, regenerate weekly/daily plan + grocery when rules change.
 * @param {boolean} [forceRegen]
 */
function applyRestrictionChange(forceRegen = false) {
  const next = normalizeRestrictions(state.restrictions || defaultRestrictions());
  const changed = forceRegen || !restrictionsEqual(lastAppliedRestrictions, next);
  state.restrictions = next;
  lastAppliedRestrictions = structuredClone(next);
  saveState(state);
  log("restrictions", "updated", JSON.stringify(state.restrictions));
  // Sync both Plan + Settings grids BEFORE any regen so hidden forms cannot overwrite state
  try {
    syncRestrictionControls();
  } catch {
    /* ignore */
  }
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
    renderHome();
    renderPlan();
    renderGrocery();
    renderNutrients();
    syncRestrictionControls();
  } catch {
    /* ignore partial render */
  }
  return state.restrictions;
}

/**
 * Save dietary restrictions from Settings checkboxes (auto-save on change).
 * @param {"settings"|"plan"} [from]
 */
function saveDietaryRestrictions(from = "settings") {
  const form = $("#dietaryRestrictionsForm");
  const r = getRestrictions();
  if (form) {
    form.querySelectorAll("input[data-restriction-id]").forEach((input) => {
      const id = input.dataset.restrictionId;
      if (id) r[id] = !!input.checked;
    });
  }
  // Vegan implies related animal restrictions
  if (r.animal) {
    r.meat = true;
    r.milk = true;
    r.egg = true;
    r.fish = true;
    r.shellfish = true;
  }
  const prev = getRestrictions();
  state.restrictions = normalizeRestrictions(r);
  applyRestrictionChange(!restrictionsEqual(prev, state.restrictions));
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
  state.restrictions = getRestrictions();
  if ($("#homeRestrictionsStatus")) {
    $("#homeRestrictionsStatus").textContent = restrictionsSummaryText();
  }
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
  const avoid = restrictionsSummary(getRestrictions());
  out.innerHTML = `
    <p class="meta"><strong>${escapeHtml(day.label)}</strong> · ${day.meals.length} Meal(s) · Fiber ${dayNut.fiber}g · Water ~${dayNut.waterMl} ml</p>
    <p class="meta">${
      avoid.length
        ? `Meals matched to: ${escapeHtml(avoid.join(" · "))}`
        : "No active dietary restrictions for today’s meals."
    }</p>
    ${day.meals
      .map((m, i) => renderMealCard(m, { dayNum, mealIndex: i, showRotate: true }))
      .join("")}
    <div class="btn-row">
      <button type="button" class="btn ghost" id="homeOpenPlan">Open Full Weekly Plan</button>
      <button type="button" class="btn ghost" id="homeOpenNutrients">Nutrients</button>
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

function planStructureDiffersFromForm() {
  if (!state.mealPlan) return true;
  const mpd = Number($("#mealsPerDay")?.value) || state.mealsPerDay || 2;
  const ic = Number($("#ingredientCount")?.value) || state.ingredientCount || 3;
  if ((state.mealPlan.mealsPerDay || 2) !== mpd) return true;
  if ((state.mealPlan.ingredientCount || 3) !== ic) return true;
  if (!restrictionsEqual(state.mealPlan.restrictions, getRestrictions())) return true;
  return false;
}

/** Apply meals/day + ingredient-count from the Weekly Plan form and rebuild if needed */
function applyPlanFormSettings({ toastOnChange = true } = {}) {
  syncPlanFormToState();
  if (planStructureDiffersFromForm() || !state.mealPlan?.plan?.length) {
    try {
      autogenerateWeeklyPlan();
      renderPlan();
      renderHome();
      renderGrocery();
      renderNutrients();
      if (toastOnChange) toast("Meal plan updated for your settings");
      return true;
    } catch (e) {
      toast(e.message || "Could not update plan");
      return false;
    }
  }
  return false;
}

function bindPlan() {
  $("#rotatePlanBtn").onclick = () => {
    try {
      syncPlanFormToState();
      ensureAutoMealPlan();
      if (planStructureDiffersFromForm()) {
        autogenerateWeeklyPlan();
        renderPlan();
        renderHome();
        renderGrocery();
        toast("Plan rebuilt with meals/day & ingredient settings");
        return;
      }
      state.mealPlan = rotateMealPlan(state.mealPlan, db, {
        preferredIds: state.preferredIds,
        mealsPerDay: state.mealsPerDay,
        ingredientCount: state.ingredientCount,
        restrictions: getRestrictions(),
      });
      state.groceryList = buildGroceryList(state.mealPlan);
      trackIngredientUsage(state, state.mealPlan);
      state.analytics.rotations = (state.analytics.rotations || 0) + 1;
      award(state, "rotate", 15);
      saveState(state);
      renderPlan();
      renderHome();
      renderGrocery();
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

  // Changing structure must rebuild the plan so UI selections take effect immediately
  $("#mealsPerDay")?.addEventListener("change", () => applyPlanFormSettings());
  $("#ingredientCount")?.addEventListener("change", () => applyPlanFormSettings());

  syncRestrictionControls();
  $("#planOpenSettingsRestrictions")?.addEventListener("click", () => showTab("settings"));

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
  const base = findIngredient($("#customMealBase")?.value || customDraft.baseId);
  const ingredients = customDraft.ingredientIds.map((id) => findIngredient(id)).filter(Boolean);
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
  return passesRestrictions(item, getRestrictions());
}

function renderCustomIngSearch(q) {
  const box = $("#customIngResults");
  if (!box) return;
  if (!q || q.length < 2) {
    box.innerHTML = `<span class="meta">Type at least 2 characters to search.</span>`;
    return;
  }
  const hits = filterIngredients(db.ingredients, getRestrictions(), q)
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
        `<button type="button" class="chip" data-add-ing="${i.id}">${iconFor(i)} ${escapeHtml(i.name)}${i.custom ? " · custom" : ""} <span class="meta">+</span></button>`
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
  const items = customDraft.ingredientIds.map((id) => findIngredient(id)).filter(Boolean);
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
  const base = findIngredient($("#customMealBase")?.value || customDraft.baseId);
  const ingredients = customDraft.ingredientIds.map((id) => findIngredient(id)).filter(Boolean);
  const serving = readCustomServingFromForm();
  const nut = readCustomNutritionFromForm();
  const meal = buildCustomMeal({
    name: $("#customMealName")?.value,
    base,
    ingredients,
    restrictions: getRestrictions(),
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

/**
 * Sync meals/day + ingredient count from the Weekly Plan form.
 * Dietary restrictions are owned by saveDietaryRestrictions / applyRestrictionChange —
 * do NOT re-read restriction checkboxes here. Doing so overwrites Settings changes
 * with a stale Plan form (the other form is not yet re-rendered).
 */
function syncPlanFormToState() {
  if ($("#mealsPerDay")) {
    state.mealsPerDay = Number($("#mealsPerDay").value) || 2;
  }
  if ($("#ingredientCount")) {
    state.ingredientCount = Number($("#ingredientCount").value) || 3;
  }
  state.restrictions = getRestrictions();
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
  if ($("#mealsPerDay")) $("#mealsPerDay").value = String(state.mealsPerDay || state.mealPlan?.mealsPerDay || 2);
  if ($("#ingredientCount")) $("#ingredientCount").value = String(state.ingredientCount || state.mealPlan?.ingredientCount || 3);
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
  const avoid = restrictionsSummary(plan.restrictions || getRestrictions());
  const avoidLine = avoid.length ? avoid.join(" · ") : "no active restrictions";
  out.innerHTML =
    `<div class="card"><p class="meta">Variation pool: ${plan.variationPoolSize} · endless ~${formatBig(
      plan.endlessCapacity || 0
    )} · avg/day ~${planNut.averagePerDay.calories} kcal</p>
    <p class="meta"><strong>Dietary restrictions for this plan:</strong> ${escapeHtml(avoidLine)}</p>
    <p class="hint">Use <strong>Rotate This Meal</strong> on any meal, or <strong>Rotate Meals</strong> for the whole week. Changing restrictions regenerates daily and weekly meals.</p></div>` +
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
function groceryStoreId() {
  return state.settings?.groceryStore === "winco" ? "winco" : "walmart";
}

function grocerySortMode() {
  return state.settings?.grocerySort || "aisle";
}

function ensureGroceryEnriched(list) {
  if (!list?.items?.length) return list;
  let changed = false;
  list.items = list.items.map((it) => {
    const hasDetail =
      it.nav?.walmart?.detailedSteps?.length >= 3 &&
      it.nav?.winco?.detailedSteps?.length >= 3 &&
      it.cost?.typical != null;
    if (hasDetail) return it;
    changed = true;
    // Preserve checked flag across re-enrich
    const next = enrichGroceryItem(it, it.qty || 1);
    next.checked = !!it.checked;
    return next;
  });
  if (changed || !list.costTotals) {
    list.costTotals = groceryCostTotals(list.items);
  }
  return list;
}

function sortedGroceryItems(items, storeId, sortMode) {
  const list = [...(items || [])];
  if (sortMode === "name") {
    return list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  if (sortMode === "cost") {
    return list.sort((a, b) => (b.cost?.lineTypical || 0) - (a.cost?.lineTypical || 0));
  }
  if (sortMode === "category") {
    return list.sort((a, b) => {
      if (a.category === b.category) return String(a.name).localeCompare(String(b.name));
      return String(a.category).localeCompare(String(b.category));
    });
  }
  // default: store aisle path
  return sortGroceryByStorePath(list, storeId);
}

function bindGrocery() {
  if (!state.settings) state.settings = {};
  if ($("#groceryStoreSelect")) {
    $("#groceryStoreSelect").value = groceryStoreId();
    $("#groceryStoreSelect").onchange = () => {
      state.settings.groceryStore = $("#groceryStoreSelect").value;
      saveState(state);
      renderGrocery();
    };
  }
  if ($("#grocerySortSelect")) {
    $("#grocerySortSelect").value = grocerySortMode();
    $("#grocerySortSelect").onchange = () => {
      state.settings.grocerySort = $("#grocerySortSelect").value;
      saveState(state);
      renderGrocery();
    };
  }
  bindGroceryMapControls();

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
  const storeId = groceryStoreId();
  const store = storeMeta(storeId);
  const labels = list?.restrictionLabels || restrictionsSummary(list?.restrictions || getRestrictions());
  const enriched = ensureGroceryEnriched(list);
  const items = sortedGroceryItems(enriched.items, storeId, grocerySortMode());
  const totals = enriched.costTotals || groceryCostTotals(items);
  const header = [
    "LiquidFloodie Grocery List",
    `Store path: ${store.label}`,
    `Approx. total: ${formatMoney(totals.typical)} (range ${formatMoney(totals.min)} – ${formatMoney(totals.max)})`,
  ];
  if (labels.length) header.push(`Dietary restrictions: ${labels.join(" · ")}`);
  header.push("");
  header.push("Tips: perimeter first · one-way aisle path · cold items last · WinCo bulk for nuts/grains");
  header.push("");
  for (const it of items) {
    const nav = it.nav?.[storeId] || {};
    const otherId = storeId === "walmart" ? "winco" : "walmart";
    const other = it.nav?.[otherId] || {};
    const cost = it.cost || {};
    header.push(
      `[${it.checked ? "x" : " "}] ${it.name} ×${it.qty}  ·  ${formatMoney(cost.lineTypical)}  (${formatMoney(cost.typical)}/${cost.unit || "ea"})`
    );
    header.push(
      `    ${nav.storeLabel || storeId}: ${nav.aisle || "?"} · ${nav.sideLabel || ""} · ${nav.depthLabel || ""} · ${nav.department || ""}`
    );
    const steps = nav.detailedSteps || (nav.instructions ? [nav.instructions] : []);
    for (const s of steps) header.push(`      - ${s}`);
    if (other?.aisle) {
      header.push(
        `    ${other.storeLabel || otherId}: ${other.aisle} · ${other.sideLabel || ""} · ${other.depthLabel || ""}`
      );
      const oSteps = other.detailedSteps || [];
      for (const s of oSteps.slice(0, 4)) header.push(`      - ${s}`);
    }
  }
  return header.join("\n");
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

const GROCERY_MAPS = {
  walmart: {
    illustrated: {
      src: "walmart-grocery-layout-illustrated.jpg",
      alt: "Illustrated Walmart Supercenter grocery floor plan with one-way shopping path from produce through center aisles to dairy and frozen",
    },
    diagram: {
      src: "walmart-grocery-layout-map.png",
      svg: "walmart-grocery-layout-map.svg",
      alt: "Labeled Walmart Supercenter grocery layout diagram with aisle numbers, left/right sides, and department zones",
    },
    title: "Walmart Supercenter grocery layout map",
    caption:
      "Match each list item’s aisle · left/right · front/halfway/back to this map. Start at Produce (①), walk center aisles low→high, dairy & frozen last.",
    brand: "Walmart",
  },
  winco: {
    illustrated: {
      src: "winco-grocery-layout-illustrated.jpg",
      alt: "Illustrated WinCo Foods grocery floor plan highlighting bulk bins, produce, center aisles, dairy, and frozen with a value shopping path",
    },
    diagram: {
      src: "winco-grocery-layout-map.png",
      svg: "winco-grocery-layout-map.svg",
      alt: "Labeled WinCo Foods grocery layout diagram with bulk foods, aisle numbers, left/right sides, and department zones",
    },
    title: "WinCo Foods grocery layout map",
    caption:
      "WinCo path: Produce (①) → Bulk nuts/grains/spices (②) → center aisles → beverages → dairy → frozen last. Match each item’s aisle · side · depth tags to this map.",
    brand: "WinCo",
  },
};

function groceryMapView() {
  return state.settings?.groceryMapView === "diagram" ? "diagram" : "illustrated";
}

function renderGroceryStoreMap() {
  const panel = $("#groceryMapPanel");
  if (!panel) return;
  const storeId = groceryStoreId();
  const view = groceryMapView();
  const storeMaps = GROCERY_MAPS[storeId] || GROCERY_MAPS.walmart;
  const map = storeMaps[view] || storeMaps.illustrated;
  const diagram = storeMaps.diagram;

  panel.classList.remove("hide");
  if ($("#groceryMapTitle")) {
    $("#groceryMapTitle").textContent = storeMaps.title;
  }
  if ($("#groceryMapCaption")) {
    $("#groceryMapCaption").textContent = storeMaps.caption;
  }
  if ($("#groceryMapImg")) {
    $("#groceryMapImg").src = map.src;
    $("#groceryMapImg").alt = map.alt;
  }
  if ($("#groceryMapLink")) {
    $("#groceryMapLink").href = map.src;
  }
  if ($("#groceryMapFigCap")) {
    const brand = storeMaps.brand || "store";
    $("#groceryMapFigCap").textContent =
      view === "diagram"
        ? `Detailed ${brand} aisle diagram — tap to open full size. Educational guide, not an official floor plan.`
        : `Illustrated ${brand} shopping path — tap to open full size. Educational guide, not an official floor plan.`;
  }
  if ($("#groceryMapOpenSvg") && diagram?.svg) {
    $("#groceryMapOpenSvg").href = diagram.svg;
  }
  if ($("#groceryMapOpenPng") && diagram?.src) {
    $("#groceryMapOpenPng").href = diagram.src;
  }
  $$(".map-view-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mapView === view);
  });
}

function bindGroceryMapControls() {
  $$(".map-view-btn").forEach((btn) => {
    btn.onclick = () => {
      if (!state.settings) state.settings = {};
      state.settings.groceryMapView = btn.dataset.mapView === "diagram" ? "diagram" : "illustrated";
      saveState(state);
      renderGroceryStoreMap();
    };
  });
}

function renderGroceryNavTips() {
  const el = $("#groceryNavTips");
  if (!el) return;
  el.innerHTML = `
    <details class="grocery-tips-details">
      <summary>Faster ways to find items in-store</summary>
      <ul class="grocery-tips-list">
        ${NAV_TECHNIQUES.map((t) => `<li><strong>${escapeHtml(t.title)}:</strong> ${escapeHtml(t.text)}</li>`).join("")}
      </ul>
      <p class="meta">Aisle numbers are educational approximations — layouts vary by remodel and city. Use the store’s app or ask associates when in doubt. Map images above match the aisle · side · depth tags on each grocery item (Walmart Supercenter or WinCo bulk-first path).</p>
    </details>`;
}

function renderGroceryCostSummary(totals) {
  const el = $("#groceryCostSummary");
  if (!el) return;
  if (!totals) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="cost-total-card">
      <div class="cost-total-main">
        <span class="meta">Approximate grocery total</span>
        <strong class="cost-figure">${formatMoney(totals.typical)}</strong>
      </div>
      <p class="meta">Comparable range ${formatMoney(totals.min)} – ${formatMoney(totals.max)} · ${totals.itemCount} line item(s) · educational estimates only</p>
    </div>`;
}

function storeNavBlockHtml(nav, { primary = false } = {}) {
  if (!nav) return "";
  const label = nav.storeLabel || nav.storeId || "Store";
  const title = escapeHtml(label);
  const steps = Array.isArray(nav.detailedSteps) && nav.detailedSteps.length
    ? nav.detailedSteps
    : nav.instructions
      ? [nav.instructions]
      : nav.tip
        ? [nav.tip]
        : [];
  const stepsHtml = steps.length
    ? `<ol class="grocery-nav-steps">
        ${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
      </ol>`
    : "";
  return `
    <div class="grocery-store-nav ${primary ? "is-primary" : "is-secondary"}" data-store="${escapeHtml(nav.storeId || "")}">
      <p class="grocery-store-nav-label">${title} aisle &amp; find instructions</p>
      <p class="grocery-nav-primary">
        <span class="nav-pill">${escapeHtml(nav.aisle || "Aisle ?")}</span>
        <span class="nav-pill subtle">${escapeHtml(nav.sideLabel || "Side ?")}</span>
        <span class="nav-pill subtle">${escapeHtml(nav.depthLabel || "Depth ?")}</span>
      </p>
      <p class="meta"><strong>${escapeHtml(nav.department || "")}</strong> · ${escapeHtml(nav.zone || "")}</p>
      ${stepsHtml}
    </div>`;
}

function groceryItemHtml(it, storeId) {
  const primary = it.nav?.[storeId] || {};
  const otherId = storeId === "walmart" ? "winco" : "walmart";
  const secondary = it.nav?.[otherId] || {};
  const cost = it.cost || {};
  // Preferred store first; both Walmart and WinCo blocks listed (WinCo is not bolded)
  const blocks =
    storeId === "winco"
      ? storeNavBlockHtml(primary, { primary: true }) + storeNavBlockHtml(secondary, { primary: false })
      : storeNavBlockHtml(primary, { primary: true }) + storeNavBlockHtml(secondary, { primary: false });
  return `
    <article class="grocery-item-card ${it.checked ? "done" : ""}">
      <label class="grocery-item-check">
        <input type="checkbox" data-gid="${escapeHtml(it.id)}" ${it.checked ? "checked" : ""} />
        <span class="grocery-item-title">${iconFor(it)} <strong>${escapeHtml(it.name)}</strong> <span class="meta">×${it.qty}</span></span>
      </label>
      <div class="grocery-item-cost">
        <span class="cost-line"><strong>${formatMoney(cost.lineTypical)}</strong> line</span>
        <span class="meta">${formatMoney(cost.typical)} / ${escapeHtml(cost.unit || "each")} · range ${formatMoney(cost.min)}–${formatMoney(cost.max)}</span>
      </div>
      <div class="grocery-nav-block">
        ${blocks}
      </div>
    </article>`;
}

function renderGrocery() {
  renderThirdParty("#thirdPartyGrocery");
  renderGroceryStoreMap();
  renderGroceryNavTips();
  const out = $("#groceryOutput");
  if (!out) return;

  const storeId = groceryStoreId();
  const sortMode = grocerySortMode();
  const meta = storeMeta(storeId);
  if ($("#groceryStoreSelect")) $("#groceryStoreSelect").value = storeId;
  if ($("#grocerySortSelect")) $("#grocerySortSelect").value = sortMode;
  if ($("#groceryStoreNote")) {
    $("#groceryStoreNote").textContent =
      (meta.note || "") +
      (storeId === "walmart"
        ? " Use the Walmart layout map below with each item’s aisle · side · depth tags."
        : " Use the WinCo layout map below — hit bulk early for nuts, grains, beans, and spices.");
  }

  const r = getRestrictions();
  const parts = restrictionsSummary(state.groceryList?.restrictions || r);
  if ($("#groceryRestrictionsStatus")) {
    $("#groceryRestrictionsStatus").textContent = parts.length
      ? `Grocery list respects: ${parts.join(" · ")}`
      : "Grocery list includes all plan ingredients (no restrictions active).";
  }

  if (!state.groceryList?.items?.length) {
    renderGroceryCostSummary(null);
    out.innerHTML = `<div class="card"><p class="hint">No grocery list yet. Generate a weekly meal plan first. Lists only include ingredients allowed by your dietary restrictions.</p></div>`;
    return;
  }

  state.groceryList = ensureGroceryEnriched(state.groceryList);
  const items = sortedGroceryItems(state.groceryList.items, storeId, sortMode);
  const totals = state.groceryList.costTotals || groceryCostTotals(items);
  renderGroceryCostSummary(totals);

  if (sortMode === "category") {
    const byCat = new Map();
    for (const it of items) {
      if (!byCat.has(it.category)) byCat.set(it.category, []);
      byCat.get(it.category).push(it);
    }
    out.innerHTML = [...byCat.entries()]
      .map(
        ([cat, group]) => `
      <div class="card grocery-cat">
        <h3>${iconFor({ category: cat })} ${escapeHtml(cat)}</h3>
        ${group.map((it) => groceryItemHtml(it, storeId)).join("")}
      </div>`
      )
      .join("");
  } else {
    // Group lightly by aisle for path shopping
    const byAisle = new Map();
    for (const it of items) {
      const key = it.nav?.[storeId]?.aisle || "Other";
      if (!byAisle.has(key)) byAisle.set(key, []);
      byAisle.get(key).push(it);
    }
    out.innerHTML = [...byAisle.entries()]
      .map(
        ([aisle, group]) => `
      <div class="card grocery-cat">
        <h3>📍 ${escapeHtml(aisle)}</h3>
        <p class="meta">${escapeHtml(group[0]?.nav?.[storeId]?.department || "")} · ${group.length} item(s)</p>
        ${group.map((it) => groceryItemHtml(it, storeId)).join("")}
      </div>`
      )
      .join("");
  }

  out.onchange = (e) => {
    const t = e.target;
    if (t.dataset.gid == null) return;
    const item = state.groceryList.items.find((i) => String(i.id) === String(t.dataset.gid));
    if (item) {
      item.checked = t.checked;
      saveState(state);
      t.closest(".grocery-item-card")?.classList.toggle("done", t.checked);
    }
  };
}

/* ---------- Custom ingredients (with macros / micros) ---------- */
function bindCustomIngredients() {
  $("#saveCustomIngredientBtn")?.addEventListener("click", () => {
    try {
      saveCustomIngredientFromForm();
    } catch (e) {
      toast(e.message || "Could not save ingredient");
    }
  });
  $("#clearCustomIngredientBtn")?.addEventListener("click", () => {
    clearCustomIngredientForm();
    toast("Form cleared");
  });
  renderCustomIngredientsList();
}

function readCiOptionalNumber(id) {
  const el = $(id);
  if (!el) return 0;
  const raw = String(el.value ?? "").trim();
  if (raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error("Nutrition values must be zero or positive numbers.");
  return n;
}

function readCustomIngredientNutritionFromForm() {
  return {
    calories: readCiOptionalNumber("#ciCal"),
    protein: readCiOptionalNumber("#ciProtein"),
    carbs: readCiOptionalNumber("#ciCarbs"),
    fat: readCiOptionalNumber("#ciFat"),
    fiber: readCiOptionalNumber("#ciFiber"),
    waterMl: readCiOptionalNumber("#ciWater"),
    micros: {
      vitaminA: readCiOptionalNumber("#ciMicro_vitaminA"),
      vitaminC: readCiOptionalNumber("#ciMicro_vitaminC"),
      vitaminK: readCiOptionalNumber("#ciMicro_vitaminK"),
      potassium: readCiOptionalNumber("#ciMicro_potassium"),
      calcium: readCiOptionalNumber("#ciMicro_calcium"),
      iron: readCiOptionalNumber("#ciMicro_iron"),
      magnesium: readCiOptionalNumber("#ciMicro_magnesium"),
      folate: readCiOptionalNumber("#ciMicro_folate"),
    },
  };
}

function writeCustomIngredientNutritionToForm(n) {
  if (!n) return;
  if ($("#ciCal")) $("#ciCal").value = n.calories ?? "";
  if ($("#ciProtein")) $("#ciProtein").value = n.protein ?? "";
  if ($("#ciCarbs")) $("#ciCarbs").value = n.carbs ?? "";
  if ($("#ciFat")) $("#ciFat").value = n.fat ?? "";
  if ($("#ciFiber")) $("#ciFiber").value = n.fiber ?? "";
  if ($("#ciWater")) $("#ciWater").value = n.waterMl ?? "";
  const m = n.micros || {};
  for (const k of Object.keys(MICRO_LABELS)) {
    const el = $(`#ciMicro_${k}`);
    if (el) el.value = m[k] ?? "";
  }
}

function clearCustomIngredientForm() {
  if ($("#ciEditId")) $("#ciEditId").value = "";
  if ($("#ciName")) $("#ciName").value = "";
  if ($("#ciCategory")) $("#ciCategory").value = "other";
  if ($("#ciIcon")) $("#ciIcon").value = "";
  if ($("#ciNotes")) $("#ciNotes").value = "";
  writeCustomIngredientNutritionToForm({
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
    fiber: "",
    waterMl: "",
    micros: {},
  });
  for (const id of [
    "ciMilkFree",
    "ciGlutenFree",
    "ciEggFree",
    "ciNutFree",
    "ciPeanutFree",
    "ciShellfishFree",
    "ciFishFree",
    "ciSoyFree",
    "ciSesameFree",
    "ciVegetarian",
    "ciVegan",
  ]) {
    if ($(`#${id}`)) $(`#${id}`).checked = true;
  }
  if ($("#ciFormStatus")) $("#ciFormStatus").textContent = "";
  if ($("#saveCustomIngredientBtn")) $("#saveCustomIngredientBtn").textContent = "Save Custom Ingredient";
}

function loadCustomIngredientIntoForm(item) {
  if (!item) return;
  if ($("#ciEditId")) $("#ciEditId").value = item.id || "";
  if ($("#ciName")) $("#ciName").value = item.name || "";
  if ($("#ciCategory")) $("#ciCategory").value = item.category || "other";
  if ($("#ciIcon")) $("#ciIcon").value = item.icon || "";
  if ($("#ciNotes")) $("#ciNotes").value = item.notes || "";
  writeCustomIngredientNutritionToForm(nutritionForItem(item));
  if ($("#ciMilkFree")) $("#ciMilkFree").checked = item.milkFree !== false;
  if ($("#ciGlutenFree")) $("#ciGlutenFree").checked = item.glutenFree !== false;
  if ($("#ciEggFree")) $("#ciEggFree").checked = item.eggFree !== false;
  if ($("#ciNutFree")) $("#ciNutFree").checked = item.nutFree !== false;
  if ($("#ciPeanutFree")) $("#ciPeanutFree").checked = item.peanutFree !== false;
  if ($("#ciShellfishFree")) $("#ciShellfishFree").checked = item.shellfishFree !== false;
  if ($("#ciFishFree")) $("#ciFishFree").checked = item.fishFree !== false;
  if ($("#ciSoyFree")) $("#ciSoyFree").checked = item.soyFree !== false;
  if ($("#ciSesameFree")) $("#ciSesameFree").checked = item.sesameFree !== false;
  if ($("#ciVegetarian")) $("#ciVegetarian").checked = item.vegetarian !== false;
  if ($("#ciVegan")) $("#ciVegan").checked = item.vegan !== false;
  if ($("#saveCustomIngredientBtn")) $("#saveCustomIngredientBtn").textContent = "Update Custom Ingredient";
  if ($("#ciFormStatus")) $("#ciFormStatus").textContent = `Editing “${item.name}”`;
  $("#customIngredientCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveCustomIngredientFromForm() {
  const editId = $("#ciEditId")?.value || null;
  const item = buildCustomIngredient({
    id: editId || undefined,
    name: $("#ciName")?.value,
    category: $("#ciCategory")?.value || "other",
    icon: $("#ciIcon")?.value,
    notes: $("#ciNotes")?.value,
    nutrition: readCustomIngredientNutritionFromForm(),
    milkFree: !!$("#ciMilkFree")?.checked,
    glutenFree: !!$("#ciGlutenFree")?.checked,
    eggFree: !!$("#ciEggFree")?.checked,
    nutFree: !!$("#ciNutFree")?.checked,
    peanutFree: !!$("#ciPeanutFree")?.checked,
    shellfishFree: !!$("#ciShellfishFree")?.checked,
    fishFree: !!$("#ciFishFree")?.checked,
    soyFree: !!$("#ciSoyFree")?.checked,
    sesameFree: !!$("#ciSesameFree")?.checked,
    vegetarian: !!$("#ciVegetarian")?.checked,
    vegan: !!$("#ciVegan")?.checked,
  });

  state.customIngredients = state.customIngredients || [];
  const existingIdx = state.customIngredients.findIndex((i) => i.id === item.id);
  // Prevent duplicate names (case-insensitive) against other custom items
  const nameKey = item.name.toLowerCase();
  const dup = state.customIngredients.find(
    (i) => i.id !== item.id && String(i.name || "").toLowerCase() === nameKey
  );
  if (dup) throw new Error(`You already have a custom ingredient named “${dup.name}”.`);

  if (existingIdx >= 0) {
    item.createdAt = state.customIngredients[existingIdx].createdAt || item.createdAt;
    state.customIngredients[existingIdx] = item;
  } else {
    state.customIngredients.unshift(item);
  }
  if (state.customIngredients.length > 200) state.customIngredients.length = 200;

  rebuildIngredientDb();
  saveState(state);
  award(state, "plan", 8);
  log("custom-ingredient", existingIdx >= 0 ? "updated" : "created", item.name);
  clearCustomIngredientForm();
  renderCustomIngredientsList();
  populateCustomBaseSelect();
  toast(existingIdx >= 0 ? `Updated “${item.name}”` : `Added “${item.name}” to your ingredients`);
}

function deleteCustomIngredient(id) {
  const item = (state.customIngredients || []).find((i) => i.id === id);
  if (!item) return;
  if (!confirm(`Delete custom ingredient “${item.name}”?`)) return;
  state.customIngredients = (state.customIngredients || []).filter((i) => i.id !== id);
  // Drop from preferred pins if present
  state.preferredIds = (state.preferredIds || []).filter((pid) => pid !== id);
  rebuildIngredientDb();
  saveState(state);
  log("custom-ingredient", "deleted", item.name);
  if ($("#ciEditId")?.value === id) clearCustomIngredientForm();
  renderCustomIngredientsList();
  populateCustomBaseSelect();
  toast(`Deleted “${item.name}”`);
}

function renderCustomIngredientsList() {
  const box = $("#customIngredientsList");
  if (!box) return;
  const list = state.customIngredients || [];
  if (!list.length) {
    box.innerHTML = `<p class="meta">No custom ingredients yet. Use the form above to add one with macros and micros.</p>`;
    return;
  }
  box.innerHTML = list
    .map((i) => {
      const n = nutritionForItem(i);
      return `
      <article class="custom-ing-row">
        <div class="custom-ing-main">
          <span class="ico">${iconFor(i)}</span>
          <div>
            <strong>${escapeHtml(i.name)}</strong>
            <div class="meta">${escapeHtml(i.category)} · ${n.calories} kcal · P ${n.protein}g · C ${n.carbs}g · F ${n.fat}g · Fiber ${n.fiber}g</div>
            ${i.notes ? `<div class="meta">${escapeHtml(i.notes)}</div>` : ""}
          </div>
        </div>
        <div class="btn-row compact-row">
          <button type="button" class="btn ghost" data-edit-ci="${escapeHtml(i.id)}">Edit</button>
          <button type="button" class="btn danger" data-del-ci="${escapeHtml(i.id)}">Delete</button>
        </div>
      </article>`;
    })
    .join("");
  box.querySelectorAll("[data-edit-ci]").forEach((btn) => {
    btn.onclick = () => {
      const item = (state.customIngredients || []).find((x) => x.id === btn.dataset.editCi);
      loadCustomIngredientIntoForm(item);
    };
  });
  box.querySelectorAll("[data-del-ci]").forEach((btn) => {
    btn.onclick = () => deleteCustomIngredient(btn.dataset.delCi);
  });
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
  renderCustomIngredientsList();
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

/* ---------- Gamification (UI removed from Settings; points still track in storage) ---------- */
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
  state.restrictions = getRestrictions();
  syncRestrictionControls();

  $("#resetRestrictionsBtn")?.addEventListener("click", () => {
    state.restrictions = defaultRestrictions();
    applyRestrictionChange(true);
    toast("Restrictions reset to defaults (No Milk + No Gluten)");
  });

  $("#settingsAddCustomRestriction")?.addEventListener("click", () =>
    addCustomRestriction("#settingsCustomRestriction")
  );
  $("#settingsCustomRestriction")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomRestriction("#settingsCustomRestriction");
    }
  });

  const syncScheduleTimePreview = () => {
    const h = Math.min(23, Math.max(0, Number($("#schedHour")?.value) || 0));
    const m = Math.min(59, Math.max(0, Number($("#schedMinute")?.value) || 0));
    if ($("#scheduleTimePreview")) {
      $("#scheduleTimePreview").textContent = `Daily job time: ${formatClock(h, m)} (local device time)`;
    }
  };
  $("#schedEnabled").checked = !!state.schedule?.enabled;
  $("#schedHour").value = state.schedule?.hour ?? 8;
  $("#schedMinute").value = state.schedule?.minute ?? 0;
  $("#schedAutoRotate").checked = !!state.schedule?.autoRotate;
  $("#notifEnabled").checked = !!state.settings?.notifications;
  $("#schedHour")?.addEventListener("input", syncScheduleTimePreview);
  $("#schedMinute")?.addEventListener("input", syncScheduleTimePreview);
  syncScheduleTimePreview();

  $("#saveScheduleBtn").onclick = async () => {
    const hour = Math.min(23, Math.max(0, Number($("#schedHour").value) || 0));
    const minute = Math.min(59, Math.max(0, Number($("#schedMinute").value) || 0));
    state.schedule = {
      ...state.schedule,
      enabled: $("#schedEnabled").checked,
      hour,
      minute,
      autoRotate: $("#schedAutoRotate").checked,
      history: state.schedule?.history || [],
    };
    state.settings.notifications = $("#notifEnabled").checked;
    if (state.settings.notifications && "Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") toast("Notifications not granted — enable them in browser settings to get OS alerts.");
    }
    saveState(state);
    renderSettings();
    toast(
      state.schedule.enabled
        ? `Schedule saved — daily job at ${formatClock(hour, minute)}`
        : "Schedule saved — daily job is off"
    );
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
      state.restrictions = normalizeRestrictions(state.restrictions || defaultRestrictions());
      if (!Array.isArray(state.customIngredients)) state.customIngredients = [];
      if (!Array.isArray(state.customMeals)) state.customMeals = [];
      rebuildIngredientDb();
      ensureAutoMealPlan();
      toast("Imported");
      renderAll();
    } catch (err) {
      toast(err.message || "Import failed");
    } finally {
      e.target.value = "";
    }
  };
  $("#deletePlanBtn").onclick = () => {
    if (!state.mealPlan) return toast("No plan");
    if (!confirm("Move meal plan to trash?")) return;
    state = softDelete(state, "mealPlan");
    ensureAutoMealPlan();
    renderAll();
  };
  $("#deleteGroceryBtn").onclick = () => {
    if (!state.groceryList) return toast("No list");
    if (!confirm("Move grocery list to trash?")) return;
    state = softDelete(state, "groceryList");
    if (state.mealPlan) state.groceryList = buildGroceryList(state.mealPlan);
    renderAll();
  };
  $("#deleteAllBtn").onclick = () => {
    if (!confirm("Delete all user data on this device? (Your login account is kept.)")) return;
    state = softDelete(state, "all");
    rebuildIngredientDb();
    ensureAutoMealPlan();
    renderAll();
    toast("All app data cleared");
  };
  // Feedback, logging, and security/handoff UI intentionally removed from Settings.
}

async function renderAccountPanel() {
  const box = $("#accountPanel");
  if (!box) return;
  currentUser = getCurrentUser();
  if (!currentUser) {
    box.innerHTML = `
      <div class="account-panel">
        <div class="account-status-card">
          <p class="meta" style="margin:0"><strong>Status:</strong> Not signed in</p>
        </div>
        <p class="hint">Accounts stay on this device. Create an account or log in to use LiquidFloodie, recover passwords with your security question, and sync a profile picture.</p>
        <div class="btn-row account-actions">
          <button type="button" class="btn primary" id="openLoginBtn">Create Account / Login</button>
        </div>
      </div>`;
    $("#openLoginBtn").onclick = () => openAuth("register", { required: true });
    return;
  }
  const avatar = await resolveAvatar(currentUser, 96);
  const mode = currentUser.avatarMode === "local" ? "local" : "gravatar";
  box.innerHTML = `
    <div class="account-panel">
      <div class="account-status-card">
        <p class="meta" style="margin:0"><strong>Status:</strong> Signed in on this device</p>
      </div>

      <div class="account-profile-card">
        <img class="avatar lg" src="${avatar}" alt="" width="72" height="72" />
        <div class="account-profile-text">
          <p class="account-name">${escapeHtml(currentUser.displayName || "User")}</p>
          <p class="meta account-email">${escapeHtml(currentUser.email || "")}</p>
        </div>
      </div>

      <div class="account-section">
        <h4 class="account-section-title">Profile picture</h4>
        <p class="hint">Choose how your avatar is shown in the header. Gravatar uses the email hash; Local uses a built-in placeholder.</p>
        <div class="account-options" role="radiogroup" aria-label="Avatar source">
          <label class="check schedule-option account-option">
            <input type="radio" name="avatarMode" value="gravatar" ${mode === "gravatar" ? "checked" : ""} />
            <span>
              <strong>Gravatar</strong>
              <span class="meta">Pull image from gravatar.com for this email (if you have one set).</span>
            </span>
          </label>
          <label class="check schedule-option account-option">
            <input type="radio" name="avatarMode" value="local" ${mode === "local" ? "checked" : ""} />
            <span>
              <strong>Local avatar</strong>
              <span class="meta">Use the on-device default picture (no external request).</span>
            </span>
          </label>
        </div>
        <div class="btn-row account-actions">
          <button type="button" class="btn primary" id="saveAvatarBtn">Save avatar preference</button>
        </div>
      </div>

      <div class="account-section">
        <h4 class="account-section-title">Security</h4>
        <p class="hint">Reset your password with the security question you set at registration. You must use the same browser/device where the account was created.</p>
        <div class="btn-row account-actions">
          <button type="button" class="btn ghost" id="openRecoverBtn">Password recovery</button>
        </div>
      </div>

      <div class="account-section account-section-danger">
        <h4 class="account-section-title">Session</h4>
        <p class="hint">Log out ends your session on this device. You will need to sign in again to use the app.</p>
        <div class="btn-row account-actions">
          <button type="button" class="btn danger" id="logoutBtn">Log out</button>
        </div>
      </div>
    </div>`;
  $("#saveAvatarBtn").onclick = async () => {
    const next = $$('input[name="avatarMode"]').find((r) => r.checked)?.value || "gravatar";
    currentUser = updateProfile({ avatarMode: next });
    await refreshUserChrome();
    renderAccountPanel();
    toast(next === "local" ? "Using local avatar" : "Using Gravatar");
  };
  $("#logoutBtn").onclick = async () => {
    logout();
    currentUser = null;
    await refreshUserChrome();
    renderAccountPanel();
    lockAppForAuth();
    openAuth("login", { required: true });
    toast("Signed out — log in or create an account to continue");
  };
  $("#openRecoverBtn").onclick = () => openAuth("recover", { required: false });
}

function renderLogs() {
  const logs = loadLogs().slice(0, 40);
  $("#logsBox").textContent = logs.length
    ? logs.map((l) => `${l.at} [${l.level}] ${l.message}`).join("\n")
    : "No log entries yet.";
}

function formatClock(hour, minute) {
  const h = Math.min(23, Math.max(0, Number(hour) || 0));
  const m = Math.min(59, Math.max(0, Number(minute) || 0));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function renderScheduleStatus() {
  const line = $("#scheduleStatusLine");
  const preview = $("#scheduleTimePreview");
  const s = state.schedule || {};
  const hour = s.hour ?? 8;
  const minute = s.minute ?? 0;
  const time = formatClock(hour, minute);
  if (preview) preview.textContent = `Daily job time: ${time} (local device time)`;
  if (!line) return;

  const enabled = !!s.enabled;
  const auto = !!s.autoRotate;
  const notif = !!state.settings?.notifications;
  let notifLabel = "off";
  if (notif && "Notification" in window) {
    notifLabel = Notification.permission === "granted" ? "allowed" : Notification.permission === "denied" ? "blocked by browser" : "permission not granted yet";
  } else if (notif) {
    notifLabel = "not supported here";
  }
  const last = s.lastRun ? `Last run day: ${escapeHtml(s.lastRun)}` : "Not run yet today";
  const histN = (s.history || []).length;

  if (!enabled) {
    line.innerHTML = `<strong>Status:</strong> Off · set a time and enable the daily job, then Save. Jobs only run while this app is open on this device.`;
    return;
  }
  line.innerHTML = `<strong>Status:</strong> On · daily at <strong>${escapeHtml(time)}</strong> local · auto-rotate ${
    auto ? "<strong>on</strong>" : "off"
  } · notifications ${escapeHtml(notifLabel)} · ${last} · ${histN} run(s) logged`;
}

function renderSettings() {
  syncRestrictionControls();
  // Keep static form controls in sync with state (import / recover / delete / save)
  if ($("#schedEnabled")) $("#schedEnabled").checked = !!state.schedule?.enabled;
  if ($("#schedHour")) $("#schedHour").value = state.schedule?.hour ?? 8;
  if ($("#schedMinute")) $("#schedMinute").value = state.schedule?.minute ?? 0;
  if ($("#schedAutoRotate")) $("#schedAutoRotate").checked = !!state.schedule?.autoRotate;
  if ($("#notifEnabled")) $("#notifEnabled").checked = !!state.settings?.notifications;
  renderScheduleStatus();

  renderAccountPanel();
  const a = state.analytics;
  if ($("#analyticsBox")) {
    $("#analyticsBox").innerHTML = `Sessions: ${a.sessions || 0}<br/>Plans: ${a.plansGenerated || 0}<br/>Grocery builds: ${a.groceriesBuilt || 0}<br/>Rotations: ${a.rotations || 0}<br/>Searches: ${a.searches || 0}<br/>Last open: ${a.lastOpen || "—"}`;
  }
  const hist = state.schedule?.history || [];
  if ($("#scheduleReport")) {
    $("#scheduleReport").innerHTML = hist.length
      ? hist
          .slice(0, 8)
          .map((h) => {
            const when = h.at ? new Date(h.at) : null;
            const whenLabel =
              when && !Number.isNaN(when.getTime())
                ? when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                : h.at || "—";
            const note = h.note || (h.autoRotate ? "Reminder + auto-rotate" : "Reminder fired");
            return `<div class="schedule-run-row">
              <span class="run-when">${escapeHtml(whenLabel)}</span>
              <span class="run-note">${escapeHtml(note)}</span>
            </div>`;
          })
          .join("")
      : `<p class="schedule-report-empty">No scheduled jobs yet. Enable the daily job, save, and keep the app open near the scheduled time.</p>`;
  }
  const trash = loadTrash();
  if ($("#trashList")) {
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
        state.restrictions = normalizeRestrictions(state.restrictions || defaultRestrictions());
        if (!Array.isArray(state.customIngredients)) state.customIngredients = [];
        rebuildIngredientDb();
        ensureAutoMealPlan();
        renderAll();
        toast("Recovered");
      } catch (err) {
        toast(err.message);
      }
    };
  }
}

/* ---------- Search / share ---------- */
function ingredientQuickDetailHtml(item) {
  const n = nutritionForItem(item);
  const microBits = Object.entries(MICRO_LABELS)
    .map(([k, meta]) => `${meta.name} ${n.micros?.[k] ?? 0} ${meta.unit}`)
    .join(" · ");
  const source = item.custom ? "Your custom values" : "Estimated per typical blend portion";
  return `
    <div class="search-detail" id="searchDetail" role="region" aria-label="Ingredient nutrition">
      <div class="search-detail-head">
        <strong>${iconFor(item)} ${escapeHtml(item.name)}</strong>
        <span class="meta">${escapeHtml(item.category)}${item.custom ? " · custom" : ""}</span>
      </div>
      <p class="meta">${escapeHtml(source)}${item.notes ? ` · ${escapeHtml(item.notes)}` : ""}</p>
      <p class="meta"><strong>${n.calories}</strong> kcal · P ${n.protein}g · C ${n.carbs}g · F ${n.fat}g · Fiber ${n.fiber}g · ~${n.waterMl} ml water</p>
      <p class="meta"><strong>Micros:</strong> ${escapeHtml(microBits)}</p>
      <div class="btn-row compact-row">
        <button type="button" class="btn ghost" id="searchAddToCustomMeal" data-add-custom-ing="${escapeHtml(item.id)}">Add to custom meal</button>
        <button type="button" class="btn ghost" id="searchCloseDetail">Close</button>
      </div>
    </div>`;
}

function renderQuickSearchResults(q) {
  const box = $("#searchResults");
  if (!box) return;
  if (!q || q.length < 2) {
    box.innerHTML = "";
    return;
  }
  state.analytics.searches = (state.analytics.searches || 0) + 1;
  saveState(state);
  const hits = filterIngredients(db.ingredients, getRestrictions(), q).slice(0, 15);
  if (!hits.length) {
    box.innerHTML = `<p class="meta search-empty">No ingredients match “${escapeHtml(q)}” under your dietary restrictions.</p>`;
    return;
  }
  box.innerHTML = hits
    .map((i) => {
      const n = nutritionForItem(i);
      return `<button type="button" class="search-item" data-id="${i.id}" role="option">
        <span class="search-item-main">${iconFor(i)} ${escapeHtml(i.name)}${i.custom ? ' <span class="badge-custom">Custom</span>' : ""}</span>
        <span class="search-item-meta meta">${escapeHtml(i.category)} · ${n.calories} kcal · P ${n.protein}g · C ${n.carbs}g · F ${n.fat}g</span>
      </button>`;
    })
    .join("");
}

function bindSearch() {
  $("#searchToggle").onclick = () => {
    $("#quickSearchBar").classList.toggle("hide");
    if (!$("#quickSearchBar").classList.contains("hide")) {
      $("#globalSearch")?.focus();
    } else if ($("#searchResults")) {
      $("#searchResults").innerHTML = "";
    }
  };
  $("#globalSearch")?.addEventListener("input", () => {
    renderQuickSearchResults($("#globalSearch").value);
  });
  $("#searchResults")?.addEventListener("click", (e) => {
    const close = e.target.closest("#searchCloseDetail");
    if (close) {
      renderQuickSearchResults($("#globalSearch")?.value || "");
      return;
    }
    const addCustom = e.target.closest("#searchAddToCustomMeal, [data-add-custom-ing]");
    if (addCustom) {
      const id = addCustom.dataset.addCustomIng;
      const item = findIngredient(id);
      if (!item) return;
      if (item.category === "base") {
        customDraft.baseId = item.id;
        populateCustomBaseSelect();
      } else if (!customDraft.ingredientIds.includes(item.id)) {
        if (customDraft.ingredientIds.length >= 5) {
          toast("Maximum 5 ingredients in a custom meal");
          return;
        }
        customDraft.ingredientIds.push(item.id);
      }
      showTab("plan");
      $("#quickSearchBar")?.classList.add("hide");
      if ($("#searchResults")) $("#searchResults").innerHTML = "";
      renderCustomIngSelected();
      toast(`Added “${item.name}” to custom meal builder`);
      $("#customMealName")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const b = e.target.closest("[data-id]");
    if (!b) return;
    const item = findIngredient(b.dataset.id);
    if (!item) return;
    const box = $("#searchResults");
    if (box) box.innerHTML = ingredientQuickDetailHtml(item);
  });
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
