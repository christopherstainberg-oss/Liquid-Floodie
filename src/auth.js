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

function hasSubtleCrypto() {
  return typeof crypto !== "undefined" && !!crypto.subtle && typeof crypto.subtle.digest === "function";
}

/** Pure JS SHA-256 for non-secure contexts (HTTP LAN/Docker) where crypto.subtle is missing */
function sha256HexSync(message) {
  // Minimal SHA-256 (public domain style implementation)
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  function rotr(n, x) {
    return (x >>> n) | (x << (32 - n));
  }
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array(((bytes.length + 9 + 63) & ~63));
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLen >>> 0, false);
  // high 32 bits of length stay 0 for messages < 512MB
  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(7, w[j - 15]) ^ rotr(18, w[j - 15]) ^ (w[j - 15] >>> 3);
      const s1 = rotr(17, w[j - 2]) ^ rotr(19, w[j - 2]) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("");
}

async function sha256Hex(text) {
  if (hasSubtleCrypto()) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return bufToHex(hash);
  }
  return sha256HexSync(text);
}

/**
 * Hash password with the algorithm recorded on the account.
 * - pbkdf2: Web Crypto PBKDF2-SHA-256 (HTTPS / localhost)
 * - sha256-iter: pure-JS iterative SHA-256 for plain HTTP (Docker LAN, etc.)
 */
async function deriveKey(password, saltHex, iterations = 120000, method = null) {
  const algo = method || (hasSubtleCrypto() ? "pbkdf2" : "sha256-iter");

  if (algo === "pbkdf2") {
    if (!hasSubtleCrypto()) {
      throw new Error(
        "This account needs a secure connection (HTTPS or localhost). Open the app over HTTPS, or reset the password from Password Recovery after creating a new account on this network."
      );
    }
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

  // sha256-iter fallback — works without crypto.subtle
  const rounds = Math.min(Number(iterations) || 50000, 50000);
  let out = `${password}:${saltHex}`;
  for (let i = 0; i < rounds; i++) {
    out = sha256HexSync(`${out}:${i}:${saltHex}`);
  }
  return out;
}

function preferredHashMethod() {
  return hasSubtleCrypto() ? "pbkdf2" : "sha256-iter";
}

function randomSalt(bytes = 16) {
  const a = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(a);
  } else {
    for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  }
  return bufToHex(a);
}

/** True when browser can use Web Crypto (secure context). */
export function cryptoReady() {
  return hasSubtleCrypto();
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

  const hashMethod = preferredHashMethod();
  const iterations = hashMethod === "pbkdf2" ? 120000 : 50000;
  const salt = randomSalt();
  const passwordHash = await deriveKey(password, salt, iterations, hashMethod);
  const ansSalt = randomSalt();
  const securityAnswerHash = await deriveKey(
    securityAnswer.trim().toLowerCase(),
    ansSalt,
    iterations,
    hashMethod
  );

  const user = {
    id: `u-${Date.now()}-${randomSalt(4)}`,
    email: e,
    displayName: (displayName || e.split("@")[0]).slice(0, 40),
    salt,
    passwordHash,
    iterations,
    hashMethod,
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
  const method = user.hashMethod || "pbkdf2";
  const hash = await deriveKey(password, user.salt, user.iterations || 120000, method);
  if (hash !== user.passwordHash) throw new Error("Incorrect password.");
  setSession({ userId: user.id, at: new Date().toISOString() });
  return publicUser(user);
}

export function logout() {
  setSession(null);
}

/**
 * Verify security answer against stored hash. Tries the account's hashMethod first,
 * then legacy fallbacks so older accounts still recover after hashing changes.
 */
async function securityAnswerMatches(user, securityAnswer) {
  const answer = String(securityAnswer || "").trim().toLowerCase();
  if (!answer) return false;
  if (!user?.ansSalt || !user?.securityAnswerHash) return false;

  const methods = [];
  if (user.hashMethod) methods.push(user.hashMethod);
  methods.push("pbkdf2", "sha256-iter");
  const tried = new Set();
  const iterations = user.iterations || 120000;

  for (const method of methods) {
    if (tried.has(method)) continue;
    tried.add(method);
    try {
      const ansHash = await deriveKey(answer, user.ansSalt, iterations, method);
      if (ansHash === user.securityAnswerHash) return true;
      // Also try with the fallback iteration count used by sha256-iter accounts
      if (method === "sha256-iter" && iterations !== 50000) {
        const alt = await deriveKey(answer, user.ansSalt, 50000, method);
        if (alt === user.securityAnswerHash) return true;
      }
    } catch {
      /* method unavailable in this context (e.g. pbkdf2 without subtle) */
    }
  }
  return false;
}

export async function recoverPassword({ email, securityAnswer, newPassword }) {
  const e = normalizeEmail(email);
  if (!e || !e.includes("@")) throw new Error("Enter the email for your account.");
  const answer = String(securityAnswer || "").trim();
  if (!answer) throw new Error("Enter the answer to your security question.");
  if (!newPassword || newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  const users = loadUsers();
  const idx = users.findIndex((u) => u.email === e);
  if (idx < 0) throw new Error("No account found for that email on this device.");

  const user = users[idx];
  if (!user.securityAnswerHash || !user.ansSalt) {
    throw new Error(
      "This account has no recovery question. Create a new account on this device, or import a backup."
    );
  }

  const ok = await securityAnswerMatches(user, answer);
  if (!ok) throw new Error("Security answer is incorrect.");

  // Re-hash password with best method available on this origin
  const nextMethod = preferredHashMethod();
  const iterations = nextMethod === "pbkdf2" ? 120000 : 50000;
  const salt = randomSalt();
  user.salt = salt;
  user.iterations = iterations;
  user.hashMethod = nextMethod;
  user.passwordHash = await deriveKey(newPassword, salt, iterations, nextMethod);
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
  if (!e || !e.includes("@")) throw new Error("Enter a valid email address.");
  const user = loadUsers().find((u) => u.email === e);
  if (!user) {
    throw new Error("No account found for that email on this device.");
  }
  if (!user.securityQuestion) {
    throw new Error("This account has no security question saved.");
  }
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
