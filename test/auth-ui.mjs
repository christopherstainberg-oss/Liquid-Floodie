/**
 * Headless browser check: auth gate tabs + register/login buttons.
 * Requires Chrome/Edge and puppeteer-core.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const puppeteer = require(join(projectRoot, "node_modules", "puppeteer-core"));
const url = process.env.APP_URL || "http://localhost:5173/";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
const logs = [];
page.on("console", (msg) => logs.push(`CONSOLE ${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`PAGEERROR: ${err.message}`));
page.on("requestfailed", (req) =>
  logs.push(`REQFAIL: ${req.url()} ${req.failure()?.errorText || ""}`)
);

console.log("Opening", url, "via", chrome);
await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
await new Promise((r) => setTimeout(r, 2500));

const state = await page.evaluate(() => {
  const modal = document.getElementById("authModal");
  const formReg = document.getElementById("formRegister");
  const formLogin = document.getElementById("formLogin");
  const tabs = [...document.querySelectorAll(".auth-tab")].map((t) => ({
    text: t.textContent.trim(),
    auth: t.dataset.auth,
    active: t.classList.contains("active"),
  }));
  return {
    bodyClass: document.body.className,
    modalHide: modal?.classList.contains("hide"),
    modalGate: modal?.classList.contains("auth-gate"),
    formRegHide: formReg?.classList.contains("hide"),
    formLoginHide: formLogin?.classList.contains("hide"),
    tabs,
    regBtn: formReg?.querySelector('button[type="submit"]')?.textContent?.trim(),
    scripts: [...document.scripts].map((s) => s.src || s.type),
  };
});
console.log("INITIAL STATE", JSON.stringify(state, null, 2));
if (logs.length) console.log("LOGS\n" + logs.join("\n"));

const loginTab = await page.$('.auth-tab[data-auth="login"]');
if (!loginTab) {
  console.error("FAIL: Login tab not found");
  await browser.close();
  process.exit(1);
}
await loginTab.click();
await new Promise((r) => setTimeout(r, 400));
const afterLoginTab = await page.evaluate(() => ({
  formLoginHide: document.getElementById("formLogin")?.classList.contains("hide"),
  formRegHide: document.getElementById("formRegister")?.classList.contains("hide"),
  title: document.getElementById("authTitle")?.textContent,
  loginTabActive: document
    .querySelector('.auth-tab[data-auth="login"]')
    ?.classList.contains("active"),
}));
console.log("AFTER LOGIN TAB CLICK", afterLoginTab);

if (afterLoginTab.formLoginHide) {
  console.error("FAIL: Login form still hidden after tab click — handlers not bound?");
}

await page.click('.auth-tab[data-auth="register"]');
await new Promise((r) => setTimeout(r, 300));
await page.click("#regEmail", { clickCount: 3 });
await page.type("#regEmail", "ui-test@example.com");
await page.type("#regName", "UI Test");
await page.type("#regPassword", "password123");
await page.type("#regAnswer", "fluffy");

await page.evaluate(() => {
  window.__authClicked = false;
  const f = document.getElementById("formRegister");
  f?.addEventListener(
    "submit",
    () => {
      window.__authClicked = true;
    },
    { capture: true }
  );
});

await page.click('#formRegister button[type="submit"]');
await new Promise((r) => setTimeout(r, 2000));

const afterReg = await page.evaluate(() => ({
  bodyClass: document.body.className,
  modalHide: document.getElementById("authModal")?.classList.contains("hide"),
  toast: document.getElementById("toast")?.textContent,
  toastHidden: document.getElementById("toast")?.hidden,
  userLabel: document.getElementById("headerUserLabel")?.textContent,
  session: localStorage.getItem("liquidfloodie.session.v1"),
  usersLen: (localStorage.getItem("liquidfloodie.users.v1") || "").length,
  authClicked: window.__authClicked,
  canUse: !!JSON.parse(localStorage.getItem("liquidfloodie.session.v1") || "null")?.userId,
}));
console.log("AFTER REGISTER SUBMIT", afterReg);
if (logs.length) console.log("ALL LOGS\n" + logs.join("\n"));

const ok =
  afterLoginTab.formLoginHide === false &&
  afterReg.canUse === true &&
  afterReg.modalHide === true;

await browser.close();
if (!ok) {
  console.error("AUTH UI CHECK FAILED");
  process.exit(1);
}
console.log("AUTH UI CHECK PASSED");
