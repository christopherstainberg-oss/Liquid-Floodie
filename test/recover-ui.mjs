/**
 * Headless check: Password Recovery / Reset Password.
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
  console.error("No Chrome/Edge");
  process.exit(1);
}

const url = process.env.APP_URL || "http://localhost:5173/";
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`CONSOLE ${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`PAGEERROR: ${e.message}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("Opening", url);
await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
await sleep(1500);

// Create account
await page.type("#regEmail", "recover@example.com");
await page.type("#regName", "RecUser");
await page.type("#regPassword", "password123");
await page.type("#regAnswer", "fluffy");
await page.click("#registerSubmitBtn");
await sleep(2000);
console.log(
  "AFTER REG",
  await page.evaluate(() => ({
    session: !!localStorage.getItem("liquidfloodie.session.v1"),
    modalHide: document.getElementById("authModal")?.classList.contains("hide"),
  }))
);

// Logout
await page.evaluate(() => localStorage.removeItem("liquidfloodie.session.v1"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(1500);

// Open recover tab
await page.click('.auth-tab[data-auth="recover"]');
await sleep(400);
console.log(
  "RECOVER TAB",
  await page.evaluate(() => {
    const b = document.getElementById("recoverSubmitBtn");
    const r = b?.getBoundingClientRect();
    return {
      formHide: document.getElementById("formRecover")?.classList.contains("hide"),
      title: document.getElementById("authTitle")?.textContent,
      btn: !!b,
      disabled: b?.disabled,
      rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
    };
  })
);

// Load question without email
await page.click("#loadQuestionBtn");
await sleep(300);
console.log(
  "LOAD NO EMAIL",
  await page.evaluate(() => document.getElementById("authError")?.textContent)
);

// Fill email + load question
await page.type("#recEmail", "recover@example.com");
await page.click("#loadQuestionBtn");
await sleep(400);
console.log(
  "LOAD Q",
  await page.evaluate(() => ({
    q: document.getElementById("recQuestion")?.textContent,
    err: document.getElementById("authError")?.textContent,
  }))
);

// Wrong answer
await page.type("#recAnswer", "wrong");
await page.type("#recPassword", "newpass123");
await page.click("#recoverSubmitBtn");
await sleep(1500);
console.log(
  "WRONG ANS",
  await page.evaluate(() => ({
    err: document.getElementById("authError")?.textContent,
    toast: document.getElementById("toast")?.textContent,
    modalHide: document.getElementById("authModal")?.classList.contains("hide"),
    disabled: document.getElementById("recoverSubmitBtn")?.disabled,
  }))
);

// Correct answer
await page.click("#recAnswer", { clickCount: 3 });
await page.keyboard.press("Backspace");
await page.type("#recAnswer", "fluffy");
await page.click("#recoverSubmitBtn");
await sleep(3000);
console.log(
  "CORRECT",
  await page.evaluate(() => ({
    err: document.getElementById("authError")?.textContent,
    toast: document.getElementById("toast")?.textContent,
    modalHide: document.getElementById("authModal")?.classList.contains("hide"),
    session: !!localStorage.getItem("liquidfloodie.session.v1"),
    user: document.getElementById("headerUserLabel")?.textContent,
  }))
);

// Login with new password
await page.evaluate(() => localStorage.removeItem("liquidfloodie.session.v1"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(1500);
await page.click('.auth-tab[data-auth="login"]');
await sleep(300);
await page.type("#loginEmail", "recover@example.com");
await page.type("#loginPassword", "newpass123");
await page.click("#loginSubmitBtn");
await sleep(2000);
console.log(
  "LOGIN NEW",
  await page.evaluate(() => ({
    modalHide: document.getElementById("authModal")?.classList.contains("hide"),
    user: document.getElementById("headerUserLabel")?.textContent,
    err: document.getElementById("authError")?.textContent,
  }))
);

if (logs.length) console.log("LOGS\n" + logs.join("\n"));
await browser.close();
