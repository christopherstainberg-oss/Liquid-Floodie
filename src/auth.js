/**
 * Secure local accounts for LiquidFloodie (PWA / Docker / Pages).
 * - PBKDF2-SHA-256 password hashing (Web Crypto)
 * - Security-question password recovery
 * - Gravatar (gravicon) avatars from email hash
 *
 * Accounts stay on-device (localStorage). Suitable for personal multi-profile use;
 * for multi-device cloud accounts, pair with a server later.
 */

const USERS_KEY = "liquidfloodie.users.v1";
const SESSION_KEY = "liquidfloodie.session.v1";

const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What city were you born in?",
  "What is your favorite whole food?",
  "What was your childhood nickname?",
  "What is the model of your first blender?",
];

function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr.buffer;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bufToHex(hash);
}

async function deriveKey(password, saltHex, iterations = 120000) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBuf(saltHex),
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    256
  );
  return bufToHex(bits);
}

function randomSalt(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return bufToHex(a);
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/** Gravatar URL (gravicon) from email */
export async function gravatarUrl(email, size = 96) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const hash = await sha256Hex(e); // Gravatar now accepts SHA-256
  // MD5 is classic Gravatar; many CDNs still work with sha256 on newer endpoints.
  // Use d=identicon for privacy-friendly default.
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon&r=pg`;
}

/** Local identicon fallback when offline / CSP blocks remote */
export function localAvatarDataUrl(seed, size = 96) {
  // Simple deterministic SVG avatar
  let h = 0;
  const s = String(seed || "guest");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const c1 = `hsl(${h % 360} 55% 42%)`;
  const c2 = `hsl(${(h + 80) % 360} 60% 55%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="96" height="96" rx="48" fill="url(#g)"/>
    <circle cx="48" cy="38" r="16" fill="#fff" opacity="0.9"/>
    <ellipse cx="48" cy="78" rx="28" ry="22" fill="#fff" opacity="0.9"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

export function setSession(session) {
  if (!session) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getCurrentUser() {
  const session = getSession();
  if (!session?.userId) return null;
  return loadUsers().find((u) => u.id === session.userId) || null;
}

export function listSecurityQuestions() {
  return SECURITY_QUESTIONS.slice();
}

export async function registerAccount({
  email,
  password,
  displayName,
  securityQuestion,
  securityAnswer,
}) {
  const e = normalizeEmail(email);
  if (!e || !e.includes("@")) throw new Error("Enter a valid email.");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");
  if (!securityQuestion || !securityAnswer?.trim()) throw new Error("Choose a security question and answer.");

  const users = loadUsers();
  if (users.some((u) => u.email === e)) throw new Error("An account with this email already exists.");

  const salt = randomSalt();
  const passwordHash = await deriveKey(password, salt);
  const ansSalt = randomSalt();
  const securityAnswerHash = await deriveKey(securityAnswer.trim().toLowerCase(), ansSalt);

  const user = {
    id: `u-${Date.now()}-${randomSalt(4)}`,
    email: e,
    displayName: (displayName || e.split("@")[0]).slice(0, 40),
    salt,
    passwordHash,
    iterations: 120000,
    securityQuestion,
    ansSalt,
    securityAnswerHash,
    createdAt: new Date().toISOString(),
    avatarMode: "gravatar", // gravatar | local
  };
  users.push(user);
  saveUsers(users);
  setSession({ userId: user.id, at: new Date().toISOString() });
  return publicUser(user);
}

export async function login(email, password) {
  const e = normalizeEmail(email);
  const user = loadUsers().find((u) => u.email === e);
  if (!user) throw new Error("No account found for that email.");
  const hash = await deriveKey(password, user.salt, user.iterations || 120000);
  if (hash !== user.passwordHash) throw new Error("Incorrect password.");
  setSession({ userId: user.id, at: new Date().toISOString() });
  return publicUser(user);
}

export function logout() {
  setSession(null);
}

export async function recoverPassword({ email, securityAnswer, newPassword }) {
  const e = normalizeEmail(email);
  const users = loadUsers();
  const idx = users.findIndex((u) => u.email === e);
  if (idx < 0) throw new Error("No account found for that email.");
  if (!newPassword || newPassword.length < 8) throw new Error("New password must be at least 8 characters.");
  const user = users[idx];
  const ansHash = await deriveKey(
    String(securityAnswer || "").trim().toLowerCase(),
    user.ansSalt,
    user.iterations || 120000
  );
  if (ansHash !== user.securityAnswerHash) throw new Error("Security answer is incorrect.");
  const salt = randomSalt();
  user.salt = salt;
  user.passwordHash = await deriveKey(newPassword, salt);
  users[idx] = user;
  saveUsers(users);
  setSession({ userId: user.id, at: new Date().toISOString() });
  return publicUser(user);
}

export function updateProfile(patch) {
  const session = getSession();
  if (!session?.userId) throw new Error("Not logged in.");
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === session.userId);
  if (idx < 0) throw new Error("Account missing.");
  const u = users[idx];
  if (patch.displayName != null) u.displayName = String(patch.displayName).slice(0, 40);
  if (patch.avatarMode) u.avatarMode = patch.avatarMode;
  users[idx] = u;
  saveUsers(users);
  return publicUser(u);
}

export function getRecoveryQuestion(email) {
  const e = normalizeEmail(email);
  const user = loadUsers().find((u) => u.email === e);
  if (!user) throw new Error("No account found for that email.");
  return user.securityQuestion;
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarMode: u.avatarMode || "gravatar",
    createdAt: u.createdAt,
  };
}

export async function resolveAvatar(user, size = 80) {
  if (!user) return localAvatarDataUrl("guest", size);
  if (user.avatarMode === "local") return localAvatarDataUrl(user.email || user.id, size);
  try {
    return (await gravatarUrl(user.email, size)) || localAvatarDataUrl(user.email, size);
  } catch {
    return localAvatarDataUrl(user.email || user.id, size);
  }
}
