# LiquidFloodie

**Whole-food liquid meal planner** — milk-free, gluten-free blender meals with a 5-day plan, **step-by-step blend instructions**, grocery list, Quick Search over ~5,000 ingredients, login/recovery, rewards, and PWA install.

Built from `Liquid Foodie.md` in the Dietary Application Drive folder.

## What it does

- Builds **liquid meals** from a **liquid base** (water, broth, juice) + **2–5 whole-food** add-ins  
- **Step-by-step instructions** for creating each liquid meal in a blender  
- Default dietary restrictions: **no milk**, **no gluten**  
- **5-day meal plan**, **≤ 2 meals/day**  
- **Endless meal variations** with **rotate**  
- **Grocery list** with **Walmart / WinCo aisle navigation** (side + depth), on-screen **Supercenter layout map**, comparable **item costs**, approximate **cart total**, and third-party grocery links  
- **Quick Search** for ingredients (macros/micros + add to custom meal)  
- **Login / register / password recovery** (security questions) + **Gravatar** profile pics  
- **PWA** sections: **Home** (daily meals), **Weekly Meal Plan**, **Grocery List**, **Nutrients**, **Settings**  
- **Nutrients**: calories, macronutrients, micronutrients, water intake, fiber intake + customizable goals  
- Settings: **gamification**, **analytics**, **job scheduling + reports**, **import/export**, **delete/recovery**, **logging**, security/handoff  
- **IndexedDB** durable store + optional **Web API**  
- **CI/CD** workflow (`.github/workflows/ci.yml`) and **SECURITY.md**  

> Educational tool only — not medical advice.

## Quick start (local)

```bash
cd LiquidFloodie
npm run build
npm run serve
```

Open http://localhost:5173

```bash
npm test          # engine smoke tests
npm run api       # optional REST API on :3001
```

## Portainer / Docker Compose / GHCR

**Image:** `ghcr.io/christopherstainberg-oss/liquid-floodie:latest`

Published automatically on every push to `main` via `.github/workflows/docker-publish.yml`.

### Pull and run

```bash
docker pull ghcr.io/christopherstainberg-oss/liquid-floodie:latest
docker compose up -d
```

Browse **http://&lt;host&gt;:8090**

If the package is private, log in first:

```bash
echo YOUR_GITHUB_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

(PAT needs `read:packages`; for push from CI, `packages: write` is granted via `GITHUB_TOKEN`.)

### Portainer

1. (Optional) Registries → Add registry → GitHub / URL `ghcr.io`, username + PAT with `read:packages`
2. Stacks → Add stack → paste `docker-compose.yml` or use the repo
3. Deploy → open port **8090**

Stack includes optional **Watchtower** to auto-pull `:latest` about every 5 minutes.

### Local build (no GHCR)

```bash
docker compose -f docker-compose.yml build
# or: docker build -t liquidfloodie:local .
```

## Cloudflare Pages

1. Connect this folder (or monorepo path) as the Pages project root.  
2. **Build command:** `npm run build`  
3. **Output directory:** `dist`  
4. Headers are in `public/_headers` (copied into `dist`).

No server required for core features — all user data stays **on-device** (`localStorage`).

## Project layout

| Path | Role |
|------|------|
| `index.html` / `styles.css` / `app.js` | PWA shell & UI |
| `src/engine.js` | Meal generation, grocery, restrictions |
| `src/storage.js` | Persistence, trash recovery, gamification |
| `data/ingredients.js` | Generated whole-food catalog |
| `scripts/` | generators + build + local server |
| `server/index.mjs` | Optional Web API |
| `docker-compose.yml` / `Dockerfile` / `nginx.conf` | Portainer stack |
| `dist/` | Static deploy artifact |

## Deployment notes (handoff)

- **CI/CD:** run `npm test && npm run build` on every push; publish `dist/` to Pages and/or build the Docker image.  
- **Rollback:** redeploy previous image tag / previous Pages deployment.  
- **Scaling:** static assets scale via CDN (Pages) or multiple nginx replicas behind a load balancer.  
- **Monitoring:** container healthcheck on `/`; optional external uptime check on the Pages URL.  
- **Privacy:** no accounts; backups are user-exported JSON.  
- **API:** `GET /api/health`, `GET /api/ingredients`, `POST /api/meal-plan/generate` when `npm run api` is running.

## License

MIT
