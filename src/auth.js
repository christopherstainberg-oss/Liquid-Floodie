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
/** Secondary durable copy (survives some private-mode / storage flukes) */
const USERS_BACKUP_KEY = "liquidfloodie.users.bak.v1";

/** Iteration counts used by current + legacy accounts */
const PBKDF2_ITERS = 120000;
const SHA256_ITER_ROUNDS = 12000;
const LEGACY_SHA256_ITERS = 50000;

const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What city were you born in?",
  "What is your favorite whole food?",
  "What was your childhood nickname?",
  "What is the model of your first blender?",
];

function loadUsers() {
  try {
    const primary = JSON.parse(localStorage.getItem(USERS_KEY) || "null");
    if (Array.isArray(primary) && primary.length) return primary;
  } catch {
    /* fall through */
  }
  try {
    const bak = JSON.parse(localStorage.getItem(USERS_BACKUP_KEY) || "null");
    if (Array.isArray(bak) && bak.length) {
      // Restore primary from backup so later saves stay consistent
      try {
        localStorage.setItem(USERS_KEY, JSON.stringify(bak));
      } catch {
        /* ignore */
      }
      return bak;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function saveUsers(users) {
  const raw = JSON.stringify(users);
  localStorage.setItem(USERS_KEY, raw);
  try {
    localStorage.setItem(USERS_BACKUP_KEY, raw);
  } catch {
    /* quota / private mode — primary write already done */
  }
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

  // sha256-iter fallback — works without crypto.subtle (Docker LAN HTTP, etc.)
  const requested = Number(iterations);
  const fallback = SHA256_ITER_ROUNDS;
  // Cap only extreme values; honor legacy 50k and current 12k counts exactly
  const rounds = Math.max(1, Math.min(Number.isFinite(requested) && requested > 0 ? requested : fallback, 100000));
  let out = `${password}:${saltHex}`;
  for (let i = 0; i < rounds; i++) {
    out = sha256HexSync(`${out}:${i}:${saltHex}`);
  }
  return out;
}

function preferredHashMethod() {
  return hasSubtleCrypto() ? "pbkdf2" : "sha256-iter";
}

function preferredIterations(method = preferredHashMethod()) {
  return method === "pbkdf2" ? PBKDF2_ITERS : SHA256_ITER_ROUNDS;
}

/**
 * Verify password against stored hash. Tries the account's recorded method first,
 * then alternate algorithms / iteration counts so HTTP↔HTTPS and legacy accounts still work.
 * @returns {{ ok: true, method: string, iterations: number } | { ok: false }}
 */
async function passwordMatches(user, password) {
  if (!user?.salt || !user?.passwordHash || password == null || password === "") {
    return { ok: false };
  }

  const methods = [];
  if (user.hashMethod) methods.push(user.hashMethod);
  methods.push("pbkdf2", "sha256-iter");

  const iterCandidates = [
    user.iterations,
    PBKDF2_ITERS,
    SHA256_ITER_ROUNDS,
    LEGACY_SHA256_ITERS,
    50000,
    12000,
    10000,
    8000,
  ].filter((n) => Number.isFinite(Number(n)) && Number(n) > 0);

  const seen = new Set();
  for (const method of methods) {
    for (const iterations of iterCandidates) {
      const key = `${method}:${iterations}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const hash = await deriveKey(password, user.salt, Number(iterations), method);
        if (hash === user.passwordHash) {
          return { ok: true, method, iterations: Number(iterations) };
        }
      } catch {
        /* method unavailable in this context (e.g. pbkdf2 without subtle) */
      }
    }
  }
  return { ok: false };
}

/** Re-hash password with the best method on this origin and persist. */
async function upgradePasswordHash(user, password, matched) {
  const nextMethod = preferredHashMethod();
  const nextIters = preferredIterations(nextMethod);
  // Skip rewrite if already on preferred scheme and same password verifies as stored method
  if (user.hashMethod === nextMethod && user.iterations === nextIters && matched?.method === nextMethod) {
    return user;
  }
  try {
    const salt = randomSalt();
    user.salt = salt;
    user.iterations = nextIters;
    user.hashMethod = nextMethod;
    user.passwordHash = await deriveKey(password, salt, nextIters, nextMethod);
    // Keep security-answer hashes usable: leave ansSalt / securityAnswerHash as-is
    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      users[idx] = user;
      saveUsers(users);
    }
  } catch {
    /* non-fatal — login already succeeded */
  }
  return user;
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

/**
 * Classic Gravatar still indexes many profiles by MD5(email).
 * Web Crypto has no MD5 — small pure-JS implementation (email hashes only).
 */
function md5Hex(str) {
  function cmn(q, a, b, x, s, t) {
    a = (a + q + x + t) | 0;
    return (((a << s) | (a >>> (32 - s))) + b) | 0;
  }
  function ff(a, b, c, d, x, s, t) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a, b, c, d, x, s, t) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function md5blks(s) {
    const n = s.length;
    const n16 = (((n + 8) >>> 6) + 1) * 16;
    const blks = new Array(n16).fill(0);
    for (let i = 0; i < n; i++) blks[i >> 2] |= s.charCodeAt(i) << ((i % 4) * 8);
    blks[n >> 2] |= 0x80 << ((n % 4) * 8);
    blks[n16 - 2] = n * 8;
    return blks;
  }
  // UTF-8 encode for non-ASCII emails
  const utf8 = unescape(encodeURIComponent(String(str || "")));
  const x = md5blks(utf8);
  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;
  for (let i = 0; i < x.length; i += 16) {
    const oa = a;
    const ob = b;
    const oc = c;
    const od = d;
    a = ff(a, b, c, d, x[i], 7, -680876936);
    d = ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = ff(c, d, a, b, x[i + 2], 17, 606105819);
    b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897);
    d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, x[i + 10], 17, -42063);
    b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, x[i + 1], 5, -165796510);
    d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, x[i + 11], 14, 643717713);
    b = gg(b, c, d, a, x[i], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691);
    d = gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = gg(c, d, a, b, x[i + 15], 14, -660478335);
    b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = gg(a, b, c, d, x[i + 9], 5, 568446438);
    d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, x[i + 3], 14, -187363961);
    b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, x[i + 5], 4, -378558);
    d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, x[i + 7], 16, -155497632);
    b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13], 4, 681279174);
    d = hh(d, a, b, c, x[i], 11, -358537222);
    c = hh(c, d, a, b, x[i + 3], 16, -722521979);
    b = hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = hh(a, b, c, d, x[i + 9], 4, -640364487);
    d = hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = hh(c, d, a, b, x[i + 15], 16, 530742520);
    b = hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = ii(a, b, c, d, x[i], 6, -198630844);
    d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
    b = ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
    d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, x[i + 10], 15, -1051523);
    b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
    d = ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
    b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4], 6, -145523070);
    d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, x[i + 2], 15, 718787259);
    b = ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = (a + oa) | 0;
    b = (b + ob) | 0;
    c = (c + oc) | 0;
    d = (d + od) | 0;
  }
  function rhex(n) {
    let s = "";
    for (let j = 0; j < 4; j++) s += ((n >> (j * 8)) & 255).toString(16).padStart(2, "0");
    return s;
  }
  return rhex(a) + rhex(b) + rhex(c) + rhex(d);
}

/**
 * Build Gravatar image URLs for an email.
 * Prefer SHA-256 (current Gravatar docs); also include classic MD5 for older profiles.
 * Hosts chosen to match CSP allow-list (www + secure).
 */
export async function gravatarUrls(email, size = 96) {
  const e = normalizeEmail(email);
  if (!e) return [];
  const s = Math.max(1, Math.min(2048, Number(size) || 96));
  const sha = await sha256Hex(e);
  const md5 = md5Hex(e);
  // d=identicon so empty profiles still show a pattern (never transparent blank)
  const q = `s=${s}&d=identicon&r=pg`;
  return [
    `https://www.gravatar.com/avatar/${sha}?${q}`,
    `https://secure.gravatar.com/avatar/${sha}?${q}`,
    `https://www.gravatar.com/avatar/${md5}?${q}`,
    `https://secure.gravatar.com/avatar/${md5}?${q}`,
  ];
}

/** @deprecated use gravatarUrls — kept for callers expecting a single URL */
export async function gravatarUrl(email, size = 96) {
  const urls = await gravatarUrls(email, size);
  return urls[0] || null;
}

/** Local identicon fallback when offline / CSP blocks remote / load error */
export function localAvatarDataUrl(seed, size = 96) {
  // Simple deterministic SVG avatar
  let h = 0;
  const s = String(seed || "guest");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const c1 = `hsl(${h % 360} 55% 42%)`;
  const c2 = `hsl(${(h + 80) % 360} 60% 55%)`;
  // Initials from seed (email local-part or display name)
  const base = s.includes("@") ? s.split("@")[0] : s;
  const parts = base.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let initials = "?";
  if (parts.length >= 2) initials = (parts[0][0] + parts[1][0]).toUpperCase();
  else if (parts[0]) initials = parts[0].slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="96" height="96" rx="48" fill="url(#g)"/>
    <text x="48" y="48" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI, system-ui, sans-serif" font-size="34" font-weight="700" fill="#fff">${initials}</text>
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
  // Do not trim passwords — only reject empty / too short (spaces may be intentional)
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  if (!securityQuestion || !securityAnswer?.trim()) throw new Error("Choose a security question and answer.");

  const users = loadUsers();
  if (users.some((u) => u.email === e)) throw new Error("An account with this email already exists.");

  const hashMethod = preferredHashMethod();
  const iterations = preferredIterations(hashMethod);
  const salt = randomSalt();
  const passwordHash = await deriveKey(password, salt, iterations, hashMethod);
  if (!passwordHash || passwordHash.length < 32) {
    throw new Error("Could not secure your password on this device. Try again or use HTTPS.");
  }

  // Round-trip verify before saving so a bad hash never locks the user out
  const verify = await deriveKey(password, salt, iterations, hashMethod);
  if (verify !== passwordHash) {
    throw new Error("Password hashing failed verification. Please try Create Account again.");
  }

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

  // Confirm persistence — surface storage failures instead of a silent broken account
  const persisted = loadUsers().find((u) => u.id === user.id && u.email === e);
  if (!persisted?.passwordHash) {
    throw new Error(
      "Account could not be saved on this device (storage blocked or full). Allow site data / local storage and try again."
    );
  }

  // Final login-path check with the same multi-method matcher used at Sign In
  const match = await passwordMatches(persisted, password);
  if (!match.ok) {
    // Roll back the broken record so the email can be re-registered
    saveUsers(users.filter((u) => u.id !== user.id));
    throw new Error("Account save failed password check. Please try Create Account again.");
  }

  setSession({ userId: user.id, at: new Date().toISOString() });
  return publicUser(user);
}

export async function login(email, password) {
  const e = normalizeEmail(email);
  const user = loadUsers().find((u) => u.email === e);
  if (!user) {
    throw new Error(
      "No account found for that email on this device. Create an account here first (accounts do not sync across browsers/devices)."
    );
  }
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const match = await passwordMatches(user, password);
  if (!match.ok) {
    throw new Error(
      "Incorrect password. Use Password Recovery with your security question if you forgot it, or create a new account on this device."
    );
  }

  await upgradePasswordHash(user, password, match);
  setSession({ userId: user.id, at: new Date().toISOString() });
  return publicUser(loadUsers().find((u) => u.id === user.id) || user);
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
  const iterations = preferredIterations(nextMethod);
  const salt = randomSalt();
  user.salt = salt;
  user.iterations = iterations;
  user.hashMethod = nextMethod;
  user.passwordHash = await deriveKey(newPassword, salt, iterations, nextMethod);
  // Round-trip check so recovery never stores an unverifiable hash
  const check = await deriveKey(newPassword, salt, iterations, nextMethod);
  if (check !== user.passwordHash) {
    throw new Error("Could not set the new password. Please try again.");
  }
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

/**
 * Resolve avatar src for a user.
 * Returns a remote Gravatar URL (or local data URL). Callers should wire
 * img.onerror → local fallback via applyAvatarToImg / localAvatarDataUrl.
 */
export async function resolveAvatar(user, size = 80) {
  if (!user) return localAvatarDataUrl("guest", size);
  const seed = user.displayName || user.email || user.id || "guest";
  if (user.avatarMode === "local") return localAvatarDataUrl(seed, size);
  try {
    // Prefer local immediately when clearly offline
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return localAvatarDataUrl(seed, size);
    }
    const urls = await gravatarUrls(user.email, size);
    return urls[0] || localAvatarDataUrl(seed, size);
  } catch {
    return localAvatarDataUrl(seed, size);
  }
}

/**
 * Apply avatar to an <img>, with multi-host Gravatar fallback then local SVG.
 * Avoids blank brown circles when CSP/CDN/network blocks the first URL.
 * @param {HTMLImageElement|null} img
 * @param {object|null} user
 * @param {number} [size]
 */
export async function applyAvatarToImg(img, user, size = 80) {
  if (!img) return;
  const seed = user?.displayName || user?.email || user?.id || "guest";
  const local = localAvatarDataUrl(seed, size);
  // Decorative: parent control has the accessible name (avoids "Chris…" in broken-img box)
  img.alt = "";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.setAttribute("width", String(size > 48 ? 72 : 32));
  img.setAttribute("height", String(size > 48 ? 72 : 32));

  if (!user || user.avatarMode === "local") {
    img.onerror = null;
    img.src = local;
    return;
  }

  let candidates = [];
  try {
    candidates = await gravatarUrls(user.email, size);
  } catch {
    candidates = [];
  }
  if (!candidates.length) {
    img.onerror = null;
    img.src = local;
    return;
  }

  let idx = 0;
  const tryNext = () => {
    if (idx >= candidates.length) {
      img.onerror = null;
      img.src = local;
      return;
    }
    const url = candidates[idx++];
    img.onerror = tryNext;
    img.src = url;
  };
  tryNext();
}
