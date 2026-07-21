# LiquidFloodie Security Notes

Reviewed against common client-side / static-app practices (OWASP ASVS L1 posture for browser-only deployments). This is an engineering checklist, not a formal penetration-test report.

## Trust model

- **Default deploy** is a static PWA (Cloudflare Pages or Docker nginx).
- **User data** (meal plans, grocery lists, analytics, feedback) stays **on-device** via `localStorage` + **IndexedDB**.
- **Accounts** are multi-profile on a single device (not a multi-device cloud IdP unless you add a backend later).

## Authentication

| Control | Implementation |
|--------|----------------|
| Password storage | PBKDF2-SHA-256, 120,000 iterations, random 16-byte salt |
| Password recovery | Security question; answer hashed with separate salt (never plain) |
| Session | `localStorage` session pointer to user id; no JWT exfiltration surface |
| Min password length | 8 characters (enforced in UI + register/recover) |
| Gravatar | Optional avatar via HTTPS Gravatar; local SVG avatar fallback |

## Browser hardening

- Content-Security-Policy (default-src self; limited img-src for Gravatar)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN` / `frame-ancestors 'none'`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` disables camera/mic/geo
- Docker nginx enables HSTS

## Data privacy

- No third-party analytics SDKs
- Export/import is user-initiated JSON backup
- Soft-delete trash for meal plan / grocery recovery
- Ingredient catalog is static whole-food data (no PII)

## Deployment security

- Prefer HTTPS at the edge (Cloudflare Pages or reverse proxy)
- Do not bake secrets into the static bundle
- Optional API (`server/index.mjs`) is for local/LAN use; put it behind auth if exposed publicly
- CI runs `npm test` + `npm run build` before publish (see `.github/workflows/ci.yml`)

## Residual risks (accepted for v1)

- Device-local accounts can be cleared if storage is wiped
- Anyone with physical access to an unlocked browser profile can use the app data
- Gravatar may leak a hashed email to gravatar.com when remote avatars are enabled (users can switch to local avatar)

## Contact / handoff

Export **Settings → Export handoff summary** and attach logs if investigating an issue.
