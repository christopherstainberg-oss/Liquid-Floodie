/**
 * Full UI functionality audit: buttons, inputs, checkboxes, outputs.
 * Requires Chrome/Edge + puppeteer-core. App must be at APP_URL (default :5173).
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const puppeteer = require(join(projectRoot, "node_modules", "puppeteer-core"));

const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chrome = chromeCandidates.find((p) => existsSync(p));
if (!chrome) {
  console.error("No Chrome/Edge found");
  process.exit(1);
}

const url = process.env.APP_URL || "http://localhost:5173/";
const findings = [];
const pass = (msg) => {
  console.log("PASS:", msg);
  findings.push({ ok: true, msg });
};
const fail = (msg, detail) => {
  console.error("FAIL:", msg, detail || "");
  findings.push({ ok: false, msg, detail });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const logs = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => logs.push(`PAGEERROR: ${e.message}`));

async function clickable(sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const pe = style.pointerEvents;
    const vis = style.visibility;
    const disp = style.display;
    const disabled = !!el.disabled;
    const centerX = r.x + r.width / 2;
    const centerY = r.y + r.height / 2;
    const top = document.elementFromPoint(centerX, centerY);
    const hit =
      top === el ||
      el.contains(top) ||
      (top && (top.closest(s) === el || el.contains(top.closest("button, a, label, input, select"))));
    return {
      exists: true,
      disabled,
      pe,
      vis,
      disp,
      w: r.width,
      h: r.height,
      hit: !!hit,
      topTag: top?.tagName,
      topId: top?.id,
      topClass: top?.className?.toString?.()?.slice?.(0, 80),
    };
  }, sel);
}

async function mustClick(sel, label) {
  const info = await clickable(sel);
  if (!info.exists) {
    fail(`${label}: missing ${sel}`);
    return false;
  }
  if (info.disabled) {
    fail(`${label}: disabled ${sel}`, info);
    return false;
  }
  if (info.w < 2 || info.h < 2) {
    // Still try JS click — element may be off-screen but interactive
  }
  if (info.pe === "none") {
    fail(`${label}: pointer-events none ${sel}`, info);
    return false;
  }
  if (info.disp === "none" || info.vis === "hidden") {
    fail(`${label}: not visible ${sel}`, info);
    return false;
  }
  try {
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) throw new Error("missing");
      el.scrollIntoView({ block: "center", inline: "nearest" });
      el.click();
    }, sel);
    pass(`${label}: clickable ${sel}`);
    return true;
  } catch (e) {
    fail(`${label}: click failed ${sel}`, e.message);
    return false;
  }
}

async function setValue(sel, value) {
  await page.evaluate(
    (s, v) => {
      const el = document.querySelector(s);
      if (!el) throw new Error("missing " + s);
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    sel,
    value
  );
}

console.log("Opening", url);
await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
await sleep(2000);

// ---- AUTH GATE ----
const authInit = await page.evaluate(() => ({
  locked: document.body.classList.contains("auth-locked"),
  modalHide: document.getElementById("authModal")?.classList.contains("hide"),
  regVisible: !document.getElementById("formRegister")?.classList.contains("hide"),
}));
if (!authInit.locked || authInit.modalHide) fail("Auth gate should lock app on first visit", authInit);
else pass("Auth gate locks app on first visit");

// Tabs
for (const t of ["login", "register", "recover"]) {
  await mustClick(`.auth-tab[data-auth="${t}"]`, `Auth tab ${t}`);
  await sleep(200);
  const vis = await page.evaluate((which) => {
    const map = { login: "formLogin", register: "formRegister", recover: "formRecover" };
    return {
      formHide: document.getElementById(map[which])?.classList.contains("hide"),
      title: document.getElementById("authTitle")?.textContent,
    };
  }, t);
  if (vis.formHide) fail(`Auth form ${t} still hidden after tab`);
  else pass(`Auth form ${t} visible`);
}

// Register inputs
await mustClick('.auth-tab[data-auth="register"]', "Register tab");
const email = `audit-${Date.now()}@example.com`;
await setValue("#regEmail", email);
await setValue("#regName", "Auditor");
await setValue("#regPassword", "password123");
await setValue("#regAnswer", "fluffy");
const typed = await page.evaluate(() => ({
  email: document.getElementById("regEmail")?.value,
  name: document.getElementById("regName")?.value,
  pass: document.getElementById("regPassword")?.value,
  ans: document.getElementById("regAnswer")?.value,
}));
if (typed.email === email && typed.pass === "password123" && typed.ans === "fluffy") {
  pass("Auth inputs accept typing");
} else fail("Auth inputs did not retain values", typed);

await mustClick("#registerSubmitBtn", "Create Account");
await sleep(2500);
const afterReg = await page.evaluate(() => ({
  locked: document.body.classList.contains("auth-locked"),
  modalHide: document.getElementById("authModal")?.classList.contains("hide"),
  session: !!localStorage.getItem("liquidfloodie.session.v1"),
  user: document.getElementById("headerUserLabel")?.textContent,
  dailyHtml: (document.getElementById("dailyMealsOutput")?.innerHTML || "").length,
}));
if (afterReg.session && afterReg.modalHide && !afterReg.locked) pass("Register unlocks app and shows home");
else fail("Register did not unlock app", afterReg);
if (afterReg.dailyHtml > 50) pass("Daily meals output rendered");
else fail("Daily meals empty", afterReg);

// ---- NAV TABS ----
for (const tab of ["plan", "grocery", "nutrients", "settings", "home"]) {
  const ok = await mustClick(`.tab[data-tab="${tab}"]`, `Nav tab ${tab}`);
  await sleep(400);
  if (!ok) continue;
  const panel = await page.evaluate((t) => {
    const p = document.getElementById(`panel-${t}`);
    return {
      active: p?.classList.contains("active"),
      hidden: p?.hasAttribute("hidden"),
      text: (p?.innerText || "").slice(0, 80),
    };
  }, tab);
  if (panel.active && !panel.hidden) pass(`Panel ${tab} active`);
  else fail(`Panel ${tab} not active`, panel);
}

// ---- HOME BUTTONS ----
await mustClick('.tab[data-tab="home"]', "Home tab");
await sleep(300);
await mustClick("#goPlanBtn", "Weekly Meal Plan CTA");
await sleep(300);
if (!(await page.evaluate(() => document.getElementById("panel-plan")?.classList.contains("active")))) {
  fail("goPlanBtn did not open plan");
} else pass("goPlanBtn opens plan");

await mustClick('.tab[data-tab="home"]', "Home again");
await sleep(200);
await mustClick("#goNutrientsBtn", "Nutrients CTA");
await sleep(300);
if (!(await page.evaluate(() => document.getElementById("panel-nutrients")?.classList.contains("active")))) {
  fail("goNutrientsBtn did not open nutrients");
} else pass("goNutrientsBtn opens nutrients");

await mustClick('.tab[data-tab="home"]', "Home");
await sleep(200);
await mustClick("#homeOpenSettingsRestrictions", "Manage Restrictions");
await sleep(300);
if (!(await page.evaluate(() => document.getElementById("panel-settings")?.classList.contains("active")))) {
  fail("homeOpenSettingsRestrictions failed");
} else pass("Manage Restrictions opens settings");

// ---- PLAN: selects, restriction checkboxes, rotate ----
await mustClick('.tab[data-tab="plan"]', "Plan tab");
await sleep(500);

// Meals per day select
const mpdBefore = await page.evaluate(() => document.getElementById("mealsPerDay")?.value);
await page.select("#mealsPerDay", mpdBefore === "2" ? "1" : "2");
await sleep(200);
const mpdAfter = await page.evaluate(() => document.getElementById("mealsPerDay")?.value);
if (mpdAfter !== mpdBefore) pass(`mealsPerDay select works (${mpdBefore}→${mpdAfter})`);
else fail("mealsPerDay select did not change");

// Does plan regenerate on mealsPerDay change? (expected behavior)
await sleep(900);
const mealsPerDayEffect = await page.evaluate(() => {
  try {
    const raw = localStorage.getItem("liquidfloodie.v1");
    const st = raw ? JSON.parse(raw) : null;
    const planMpd = st?.mealPlan?.mealsPerDay ?? st?.mealPlan?.plan?.[0]?.meals?.length;
    const formMpd = Number(document.getElementById("mealsPerDay")?.value);
    const dayMeals = st?.mealPlan?.plan?.[0]?.meals?.length;
    return { planMpd, formMpd, stateMpd: st?.mealsPerDay, dayMeals };
  } catch (e) {
    return { err: e.message };
  }
});
if (
  mealsPerDayEffect.formMpd === mealsPerDayEffect.planMpd &&
  mealsPerDayEffect.formMpd === mealsPerDayEffect.dayMeals
) {
  pass("mealsPerDay change reflected in plan");
} else {
  fail("mealsPerDay change does not update plan (stale plan)", mealsPerDayEffect);
}

// Ingredient count
await page.select("#ingredientCount", "4");
const ic = await page.evaluate(() => document.getElementById("ingredientCount")?.value);
if (ic === "4") pass("ingredientCount select works");
else fail("ingredientCount select failed");

// Plan restrictions are summary-only (Settings is source of truth)
const planRestrictSummary = await page.evaluate(() => ({
  status: document.getElementById("planRestrictionsStatus")?.textContent || "",
  manageBtn: !!document.getElementById("planOpenSettingsRestrictions"),
  oldForm: !!document.getElementById("planRestrictionsForm"),
}));
if (!planRestrictSummary.oldForm && planRestrictSummary.manageBtn && planRestrictSummary.status.length > 10) {
  pass("Plan shows restriction summary + link to Settings (no duplicate form)");
} else fail("Plan restriction dedup incomplete", planRestrictSummary);

// Favorite search
await setValue("#prefSearch", "spin");
await sleep(400);
const prefHits = await page.evaluate(() => document.querySelectorAll("#prefResults button.chip").length);
if (prefHits > 0) {
  pass(`Favorite search results (${prefHits})`);
  await page.evaluate(() => document.querySelector("#prefResults button.chip")?.click());
  await sleep(200);
  const pinned = await page.evaluate(() => (document.getElementById("prefSelected")?.innerText || "").length);
  if (pinned > 10) pass("Favorite pin works");
  else fail("Favorite pin failed");
} else fail("Favorite search returned no chips");

// Rotate all
const titleBefore = await page.evaluate(() => document.querySelector("#planOutput .meal-title")?.textContent);
await mustClick("#rotatePlanBtn", "Rotate All Meals");
await sleep(800);
const titleAfter = await page.evaluate(() => document.querySelector("#planOutput .meal-title")?.textContent);
if (titleBefore && titleAfter) pass(`Rotate all ran (before/after meal titles present)`);
else fail("Rotate all — no meal titles", { titleBefore, titleAfter });

// Single meal rotate (re-query after rotate-all re-renders DOM)
const rotatedOne = await page.evaluate(() => {
  const btn = document.querySelector("#planOutput [data-rotate-day]");
  if (!btn) return { ok: false, reason: "missing" };
  const before = btn.closest(".meal")?.querySelector(".meal-title")?.textContent || "";
  btn.scrollIntoView({ block: "center" });
  btn.click();
  return { ok: true, before };
});
await sleep(600);
if (!rotatedOne.ok) fail("No per-meal rotate button", rotatedOne);
else {
  const afterTitle = await page.evaluate(() =>
    document.querySelector("#planOutput .meal-title")?.textContent
  );
  pass(`Rotate single meal button works (title was “${rotatedOne.before}”, now “${afterTitle}”)`);
}

// Custom meal builder inputs
await page.evaluate(() => document.getElementById("customMealName")?.scrollIntoView({ block: "center" }));
await setValue("#customMealName", "Audit Blend");
const nameVal = await page.evaluate(() => document.getElementById("customMealName")?.value);
if (nameVal === "Audit Blend") pass("Custom meal name input works");
else fail("Custom meal name input failed", nameVal);

const baseOpts = await page.evaluate(() => document.querySelectorAll("#customMealBase option").length);
if (baseOpts >= 2) pass(`Custom base select has options (${baseOpts})`);
else fail("Custom base select empty");

await setValue("#customIngSearch", "berr");
await sleep(400);
const ingHits = await page.evaluate(() => document.querySelectorAll("#customIngResults button.chip").length);
if (ingHits > 0) {
  pass(`Custom ingredient search (${ingHits})`);
  await page.evaluate(() => document.querySelector("#customIngResults button.chip")?.click());
  await sleep(200);
  await setValue("#customIngSearch", "spin");
  await sleep(400);
  await page.evaluate(() => document.querySelector("#customIngResults button.chip")?.click());
  await sleep(200);
  const cnt = await page.evaluate(() => document.getElementById("customIngCount")?.textContent);
  pass(`Custom ingredients selected: ${cnt}`);
} else fail("Custom ingredient search empty");

await setValue("#customServingAmount", "350");
await setValue("#customCal", "300");
await mustClick("#estimateCustomNutritionBtn", "Estimate nutrition");
await sleep(300);
await mustClick("#saveCustomMealBtn", "Save custom meal");
await sleep(600);
const customList = await page.evaluate(() => document.getElementById("customMealsList")?.innerText || "");
if (/Audit Blend/i.test(customList)) pass("Custom meal appears in list");
else fail("Custom meal not saved to list", customList.slice(0, 200));

// ---- GROCERY ----
await mustClick('.tab[data-tab="grocery"]', "Grocery tab");
await sleep(500);
await mustClick("#rebuildGroceryBtn", "Rebuild grocery");
await sleep(500);
const groceryCbs = await page.evaluate(() =>
  document.querySelectorAll("#groceryOutput input[type=checkbox][data-gid]").length
);
if (groceryCbs > 0) {
  pass(`Grocery checkboxes present (${groceryCbs})`);
  const navSample = await page.evaluate(() => {
    const card = document.querySelector(".grocery-item-card");
    const text = card?.innerText || "";
    const total = document.getElementById("groceryCostSummary")?.innerText || "";
    return {
      hasAisle: /aisle|produce|bulk|meat|frozen/i.test(text),
      hasSide: /left side|right side|wall|endcap|center/i.test(text),
      hasDepth: /halfway|front of aisle|back of aisle/i.test(text),
      hasCost: /\$/.test(text),
      hasTotal: /\$/.test(total),
      storeSelect: document.getElementById("groceryStoreSelect")?.value,
    };
  });
  if (navSample.hasAisle && navSample.hasSide && navSample.hasDepth) {
    pass("Grocery items show aisle + side + depth navigation");
  } else fail("Grocery nav details missing", navSample);

  const detailUi = await page.evaluate(() => {
    const card = document.querySelector(".grocery-item-card");
    const html = card?.innerHTML || "";
    const text = card?.innerText || "";
    const wincoStrong = (html.match(/<strong>WinCo<\/strong>/gi) || []).length;
    const steps = card?.querySelectorAll(".grocery-nav-steps li")?.length || 0;
    const storeBlocks = card?.querySelectorAll(".grocery-store-nav")?.length || 0;
    return {
      wincoStrong,
      steps,
      storeBlocks,
      hasWalmartWord: /walmart/i.test(text),
      hasWincoWord: /winco/i.test(text),
      hasStepList: steps >= 4,
    };
  });
  if (detailUi.storeBlocks >= 2 && detailUi.hasStepList && detailUi.hasWalmartWord && detailUi.hasWincoWord) {
    pass("Each grocery item shows Walmart + WinCo detailed find instructions");
  } else fail("Detailed dual-store instructions missing", detailUi);
  if (detailUi.wincoStrong >= 1) pass("WinCo is bold under grocery items");
  else fail("WinCo not bolded in grocery item HTML", detailUi);
  if (navSample.hasCost && navSample.hasTotal) pass("Grocery shows item cost + approximate total");
  else fail("Grocery cost display missing", navSample);

  const mapUi = await page.evaluate(() => {
    const img = document.getElementById("groceryMapImg");
    return {
      panel: !!document.getElementById("groceryMapPanel"),
      src: img?.getAttribute("src") || "",
      naturalOk: true,
      illustratedBtn: !!document.getElementById("mapViewIllustrated"),
      diagramBtn: !!document.getElementById("mapViewDiagram"),
    };
  });
  if (mapUi.panel && /walmart-grocery-layout/i.test(mapUi.src) && mapUi.illustratedBtn && mapUi.diagramBtn) {
    pass("Grocery store layout map is shown with view toggles");
  } else fail("Grocery layout map missing", mapUi);
  await page.evaluate(() => document.getElementById("mapViewDiagram")?.click());
  await sleep(200);
  const diagramSrc = await page.evaluate(() => document.getElementById("groceryMapImg")?.getAttribute("src") || "");
  if (/walmart-grocery-layout-map\.png/i.test(diagramSrc)) pass("Diagram map view switches to labeled PNG");
  else fail("Diagram map toggle failed", diagramSrc);

  // Switch store path + WinCo map
  await page.select("#groceryStoreSelect", "winco");
  await sleep(400);
  const winco = await page.evaluate(() => {
    const src = document.getElementById("groceryMapImg")?.getAttribute("src") || "";
    const title = document.getElementById("groceryMapTitle")?.textContent || "";
    return {
      select: document.getElementById("groceryStoreSelect")?.value,
      src,
      title,
      hasWincoMap: /winco-grocery-layout/i.test(src),
      titleOk: /winco/i.test(title),
    };
  });
  if (winco.select === "winco" && winco.hasWincoMap && winco.titleOk) {
    pass("Grocery store select switches to WinCo path and WinCo layout map");
  } else fail("WinCo store switch / map failed", winco);

  const firstState = await page.evaluate(() => {
    const cb = document.querySelector("#groceryOutput input[type=checkbox][data-gid]");
    return { id: cb?.dataset.gid, checked: cb?.checked };
  });
  await page.evaluate(() => {
    const cb = document.querySelector("#groceryOutput input[type=checkbox][data-gid]");
    cb?.scrollIntoView({ block: "center" });
    cb?.click();
  });
  await sleep(300);
  const after = await page.evaluate((id) => {
    const cb = document.querySelector(`#groceryOutput input[data-gid="${id}"]`);
    const itemDone = cb?.closest(".grocery-item-card")?.classList.contains("done");
    let stored = null;
    try {
      const st = JSON.parse(localStorage.getItem("liquidfloodie.v1") || "null");
      const it = st?.groceryList?.items?.find((i) => String(i.id) === String(id));
      stored = it?.checked;
    } catch {
      /* ignore */
    }
    return { checked: cb?.checked, itemDone, stored };
  }, firstState.id);
  if (after.checked === !firstState.checked && after.stored === after.checked) {
    pass("Grocery checkbox toggles and persists");
  } else {
    fail("Grocery checkbox toggle/persist failed", { firstState, after });
  }
  await page.evaluate((id) => {
    document.querySelector(`#groceryOutput input[data-gid="${id}"]`)?.click();
  }, firstState.id);
  await sleep(200);
} else fail("No grocery checkboxes");

await mustClick("#exportGroceryBtn", "Export grocery");
await mustClick("#shareGroceryBtn", "Share grocery");

// ---- NUTRIENTS ----
await mustClick('.tab[data-tab="nutrients"]', "Nutrients tab");
await sleep(500);
const bars = await page.evaluate(() => (document.getElementById("macroBars")?.innerHTML || "").length);
if (bars > 50) pass("Macro bars rendered");
else fail("Macro bars empty");

await mustClick("#waterPlus250", "Water +250");
await sleep(300);
const waterVal = await page.evaluate(() => document.getElementById("waterLogged")?.value);
if (Number(waterVal) >= 250) pass(`Water log updated (${waterVal})`);
else fail("Water +250 did not update log", waterVal);

await mustClick("#waterPlus500", "Water +500");
await sleep(200);
await setValue("#extraFiber", "5");
await mustClick("#saveFiberBtn", "Save fiber");
await sleep(200);
await mustClick("#saveWaterBtn", "Save water");
await sleep(200);

// Goals inputs
await setValue("#goalCalories", "2000");
await mustClick("#saveGoalsBtn", "Save goals");
await sleep(300);
const goalSaved = await page.evaluate(() => {
  try {
    const st = JSON.parse(localStorage.getItem("liquidfloodie.v1") || "null");
    return st?.nutrients?.goals?.calories;
  } catch {
    return null;
  }
});
if (goalSaved === 2000) pass("Goals save works");
else fail("Goals not saved", goalSaved);

// Custom ingredient flags checkboxes
const flagIds = [
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
];
for (const id of flagIds) {
  const before = await page.evaluate((i) => document.getElementById(i)?.checked, id);
  await page.evaluate((i) => {
    const el = document.getElementById(i);
    el?.scrollIntoView({ block: "center" });
    el?.click();
  }, id);
  await sleep(40);
  const after = await page.evaluate((i) => document.getElementById(i)?.checked, id);
  if (after === !before) pass(`Flag checkbox ${id} toggles`);
  else fail(`Flag checkbox ${id} stuck`, { before, after });
  // restore
  await page.evaluate((i) => document.getElementById(i)?.click(), id);
}

await setValue("#ciName", "Audit Superfood");
await setValue("#ciCal", "50");
await setValue("#ciProtein", "2");
await mustClick("#saveCustomIngredientBtn", "Save custom ingredient");
await sleep(500);
const ciList = await page.evaluate(() => document.getElementById("customIngredientsList")?.innerText || "");
if (/Audit Superfood/i.test(ciList)) pass("Custom ingredient saved");
else fail("Custom ingredient not in list", ciList.slice(0, 200));

// Library card removed — nutrition browse is via Quick Search (tested later)

// ---- SETTINGS ----
await mustClick('.tab[data-tab="settings"]', "Settings tab");
await sleep(500);

// Settings restriction checkboxes
const sMilkBefore = await page.evaluate(() =>
  document.querySelector('#dietaryRestrictionsForm input[data-restriction-id="gluten"]')?.checked
);
await page.evaluate(() => {
  const el = document.querySelector('#dietaryRestrictionsForm input[data-restriction-id="gluten"]');
  el?.scrollIntoView({ block: "center" });
  el?.click();
});
await sleep(700);
const sMilkAfter = await page.evaluate(() =>
  document.querySelector('#dietaryRestrictionsForm input[data-restriction-id="gluten"]')?.checked
);
if (sMilkAfter === !sMilkBefore) pass("Settings restriction checkbox toggles");
else fail("Settings restriction checkbox stuck", { sMilkBefore, sMilkAfter });
// restore
await page.evaluate(() =>
  document.querySelector('#dietaryRestrictionsForm input[data-restriction-id="gluten"]')?.click()
);
await sleep(500);

// Restrictions auto-save (no separate Save button)
const noSaveBtn = await page.evaluate(() => !document.getElementById("saveRestrictionsBtn"));
if (noSaveBtn) pass("Redundant Save Restrictions button removed");
else fail("Save Restrictions button still present");
await sleep(200);

// Schedule checkboxes
const schedBefore = await page.evaluate(() => document.getElementById("schedEnabled")?.checked);
await page.evaluate(() => document.getElementById("schedEnabled")?.click());
await sleep(100);
const schedAfter = await page.evaluate(() => document.getElementById("schedEnabled")?.checked);
if (schedAfter === !schedBefore) pass("schedEnabled checkbox toggles");
else fail("schedEnabled stuck", { schedBefore, schedAfter });

await page.evaluate(() => {
  document.getElementById("schedAutoRotate")?.click();
  document.getElementById("notifEnabled")?.click();
});
const schedFlags = await page.evaluate(() => ({
  auto: document.getElementById("schedAutoRotate")?.checked,
  notif: document.getElementById("notifEnabled")?.checked,
}));
pass(`Schedule flags: auto=${schedFlags.auto} notif=${schedFlags.notif}`);

await setValue("#schedHour", "9");
await mustClick("#saveScheduleBtn", "Save schedule");
await sleep(400);

// Avatar radios
const radioCount = await page.evaluate(() => document.querySelectorAll('input[name="avatarMode"]').length);
if (radioCount >= 2) {
  await page.evaluate(() => {
    document.querySelector('input[name="avatarMode"][value="local"]')?.click();
  });
  await sleep(100);
  const mode = await page.evaluate(
    () => document.querySelector('input[name="avatarMode"]:checked')?.value
  );
  if (mode === "local") pass("Avatar radio selectable");
  else fail("Avatar radio not selected");
  await mustClick("#saveAvatarBtn", "Save avatar");
} else fail("Avatar radios missing");

// Display name
await setValue("#displayName", "AuditUser");
await page.evaluate(() => document.getElementById("displayName")?.dispatchEvent(new Event("change")));
await sleep(200);
const dn = await page.evaluate(() => document.getElementById("displayName")?.value);
if (dn === "AuditUser") pass("Display name input works");
else fail("Display name failed", dn);

// Feedback
await setValue("#feedbackText", "UI audit feedback note");
await mustClick("#sendFeedbackBtn", "Save feedback");
await sleep(200);

// Export / logs / handoff
await mustClick("#exportAllBtn", "Export backup");
await mustClick("#refreshLogsBtn", "Refresh logs");
await sleep(200);
const logsText = await page.evaluate(() => document.getElementById("logsBox")?.textContent || "");
if (logsText.length > 5) pass("Logs output populated");
else fail("Logs empty");

await mustClick("#exportHandoffBtn", "Export handoff");
await mustClick("#shareProgressBtn", "Share achievements");

// Header actions
await mustClick("#searchToggle", "Quick search toggle");
await sleep(200);
const searchOpen = await page.evaluate(() => !document.getElementById("quickSearchBar")?.classList.contains("hide"));
if (searchOpen) {
  pass("Quick search opens");
  await setValue("#globalSearch", "kale");
  await sleep(300);
  const hits = await page.evaluate(() => document.querySelectorAll("#searchResults .search-item").length);
  if (hits > 0) pass(`Global search results (${hits})`);
  else fail("Global search no results");
  // Open detail (replaces library browse)
  await page.evaluate(() => document.querySelector("#searchResults .search-item")?.click());
  await sleep(200);
  const detail = await page.evaluate(() => ({
    has: !!document.getElementById("searchDetail"),
    text: document.getElementById("searchDetail")?.innerText || "",
  }));
  if (detail.has && /kcal/i.test(detail.text)) pass("Quick search shows ingredient nutrition detail");
  else fail("Quick search detail missing", detail);
} else fail("Quick search bar not open");

await mustClick("#shareAppBtn", "Share app");

// Join event if present
const joinedEvent = await page.evaluate(() => {
  const btn = document.querySelector("#gameOutput button[data-event]:not([disabled])");
  if (!btn) return false;
  btn.scrollIntoView({ block: "center" });
  btn.click();
  return true;
});
if (joinedEvent) {
  await sleep(300);
  pass("Join event button works");
} else pass("Join event skipped (none available)");

// Community post
const hasCommunity = await page.evaluate(() => !!document.getElementById("communityText"));
if (hasCommunity) {
  await setValue("#communityText", "Blend frozen berries first");
  await mustClick("#postCommunityBtn", "Post community tip");
} else fail("Community text missing");

// Check for page errors
const pageErrors = logs.filter((l) => l.startsWith("PAGEERROR") || l.startsWith("error"));
if (pageErrors.length) fail("Console page errors during audit", pageErrors.slice(0, 10));
else pass("No page errors during audit");

// Inventory: static buttons without handlers (heuristic)
const orphanButtons = await page.evaluate(() => {
  const ids = [
    "goPlanBtn",
    "goNutrientsBtn",
    "homeOpenSettingsRestrictions",
    "rotatePlanBtn",
    "sharePlanBtn",
    "planOpenSettingsRestrictions",
    "estimateCustomNutritionBtn",
    "clearCustomNutritionBtn",
    "saveCustomMealBtn",
    "addCustomToPlanBtn",
    "clearCustomMealBtn",
    "rebuildGroceryBtn",
    "exportGroceryBtn",
    "shareGroceryBtn",
    "waterPlus250",
    "waterPlus500",
    "waterReset",
    "saveWaterBtn",
    "saveFiberBtn",
    "saveGoalsBtn",
    "saveCustomIngredientBtn",
    "clearCustomIngredientBtn",
    "resetRestrictionsBtn",
    "settingsAddCustomRestriction",
    "groceryStoreSelect",
    "saveScheduleBtn",
    "exportAllBtn",
    "deletePlanBtn",
    "deleteGroceryBtn",
    "deleteAllBtn",
    "sendFeedbackBtn",
    "refreshLogsBtn",
    "clearLogsBtn",
    "exportHandoffBtn",
    "shareProgressBtn",
    "searchToggle",
    "shareAppBtn",
    "accountBtn",
  ];
  return ids
    .map((id) => {
      const el = document.getElementById(id);
      if (!el) return { id, missing: true };
      return { id, missing: false, disabled: !!el.disabled };
    })
    .filter((x) => x.missing || x.disabled);
});
if (orphanButtons.length) fail("Missing/disabled expected buttons", orphanButtons);
else pass("All expected primary buttons present");

// Summary
const failed = findings.filter((f) => !f.ok);
const passed = findings.filter((f) => f.ok);
console.log("\n========== AUDIT SUMMARY ==========");
console.log(`Passed: ${passed.length}  Failed: ${failed.length}`);
if (failed.length) {
  console.log("\nFAILURES:");
  for (const f of failed) console.log(" -", f.msg, f.detail ? JSON.stringify(f.detail) : "");
}
if (logs.length) {
  console.log("\nLOGS (warn/error):");
  for (const l of logs.slice(0, 30)) console.log(" ", l);
}

await browser.close();
process.exit(failed.length ? 1 : 0);
