# Deploy the Plonter MongoDB clone to Render (free tier)

This container image runs the Plonter clone (PHP 8.2 + Apache) against **MongoDB Atlas**.
It reproduces the live path layout — every PHP API at `/plonter/api/<name>.php`, the SPA at
`/plonter/clone/` — and reads its Atlas connection string from the **`MONGO_URI` environment
variable only** (never baked into the image).

> **Secret hygiene (non-negotiable):** the real `MONGO_URI` lives only in `../.mongo_uri`
> (chmod 600, gitignored, `.dockerignore`-excluded). Never commit it, never paste it into
> `render.yaml`, never `echo` it. On Render it is set as a dashboard secret (`sync:false`).

---

## What's in `deploy/`

| File | Purpose |
|------|---------|
| `Dockerfile` | `php:8.2-apache` + `pecl install mongodb` + mod_rewrite; reproduces `/plonter/` layout |
| `000-default.conf` | Apache vhost: docroot + the 3 rewrites that put `sharing/` + root `media_api.php` under `/plonter/api/` |
| `php-uploads.ini` | media upload limits (mod_php ignores per-dir `.user.ini`, so set globally) |
| `docker-entrypoint.sh` | binds Apache to `$PORT` (Render=10000, Fly=8080, local=80) |
| `render.yaml` | Render Blueprint — free Docker web service, declares `MONGO_URI`(secret) + `MONGO_DB=plonter` |
| `../.dockerignore` | **at repo root** (build-context root — the only place Docker honors it); keeps the secret/data out, trims context |

### Path-mapping strategy (why the rewrites exist)
The PHP files resolve their dependencies relative to their own location:
- `api/*.php` and `sharing/content*_api.php` → `__DIR__/../vendor`, `__DIR__/../mongo_adapter`
- `media_api.php` (repo root) → `__DIR__/vendor`, `__DIR__/mongo_adapter` (siblings)

So `vendor/` + `mongo_adapter/` sit at `/plonter/` (parent of `api/` & `sharing/`, sibling of
`media_api.php`). The image keeps each file at its **physical** location and exposes the
`sharing/` endpoints and root `media_api.php` under `/plonter/api/` via **internal Apache
rewrites**. Rewriting preserves each script's `__DIR__`, so every relative `require_once`
keeps resolving — **no PHP source is modified.** The real `api/*.php` files already sit
physically at `/plonter/api/`, so they're served directly.

---

## Option A — Render Blueprint (recommended)

1. Push this repo to a Git host Render can read (GitHub/GitLab). The repo root is the
   build context; `deploy/render.yaml` + the root `.dockerignore` must be present.
2. Render dashboard → **New → Blueprint** → pick the repo. Render reads `deploy/render.yaml`
   and proposes a free Docker web service `plonter-mongo-clone`.
3. **Before/at first deploy, set the secret:** the service's **Environment** tab →
   `MONGO_URI` → paste the real Atlas SRV string (the value from `../.mongo_uri`).
   `MONGO_DB` is already `plonter` from the blueprint. Apply.
4. Deploy. Render builds the Dockerfile, injects `PORT`, and the entrypoint binds Apache to it.
5. Health check `GET /plonter/api/content_org_api.php?action=ping` must return
   `{"ok":true,"pong":true}` for the deploy to go live.

## Option B — Manual Render service (no blueprint)

1. Render dashboard → **New → Web Service** → connect repo.
2. **Runtime:** Docker. **Dockerfile path:** `deploy/Dockerfile`. **Docker build context:** `.` (repo root).
3. **Instance type:** Free.
4. **Environment variables:**
   - `MONGO_URI` = *(the real Atlas string — mark as secret)*
   - `MONGO_DB` = `plonter`
5. Create → Render builds and deploys.

> **Atlas IP allowlist:** Render free egress IPs are dynamic. The Atlas cluster's Network
> Access must allow `0.0.0.0/0` (or Render's documented egress ranges) or the app gets
> connection-timeout errors. The migration cluster is already open; verify before blaming the image.

---

## Smoke-test the deployed service

Replace `$URL` with your Render URL (e.g. `https://plonter-mongo-clone.onrender.com`):

```bash
URL=https://<your-service>.onrender.com

# 1. API routing (live layout) — all must return JSON, not SPA HTML:
curl -s "$URL/plonter/api/content_org_api.php?action=ping"        # {"ok":true,"pong":true}
curl -s "$URL/plonter/api/content_api.php?action=ping"            # {"success":true,"message":"Content API is alive",...}
curl -s "$URL/plonter/api/content_share_api.php?action=ping"      # {"success":true,"message":"content_share_api alive",...}
curl -s -X POST "$URL/plonter/api/media_api.php" \
     -H 'Content-Type: application/json' -d '{"action":"list_folders"}'   # HTTP 401 {"ok":false,...auth_required:true}

# 2. SPA loads:
curl -s -o /dev/null -w "%{http_code}\n" "$URL/plonter/clone/"    # 200, HTML

# 3. Authed read against Atlas (unauth Mongo-reading endpoint — proves php->Atlas over HTTP):
curl -s "$URL/plonter/api/ai_dict_cache.php?action=lookup&term=كلب"   # {"found":true,"result":{...real data...}}
```

A green health check + a real `ai_dict_cache` lookup result = the full stack
(Apache → PHP → mongodb ext → Atlas) is live.

---

## Local build & run (what was verified, 2026-06-20)

```bash
cd projects/plonter_mongo_clone
DOCKER_BUILDKIT=0 docker build -f deploy/Dockerfile -t plonter-mongo-clone .
docker run -d --name plonter_test -p 8099:80 \
    -e MONGO_URI="$(cat .mongo_uri)" -e MONGO_DB=plonter plonter-mongo-clone
# smoke-test against http://localhost:8099 (same curls as above) then:
docker rm -f plonter_test
```

(Use `DOCKER_BUILDKIT=0` if `buildx` is missing on the build host, as on this Mac.)

---

## Portability notes (Oracle / Fly later)

- The entrypoint binds Apache to `$PORT` if set, else 80 — so the same image runs on
  Render (10000), Fly (`fly.toml internal_port = 8080` → set `PORT=8080`), and a plain
  Oracle VM (port 80). No rebuild needed; just supply `MONGO_URI` + `MONGO_DB` as env.
- For **Fly**: `fly launch --dockerfile deploy/Dockerfile`, then
  `fly secrets set MONGO_URI="..."` and `fly secrets set MONGO_DB=plonter`.
- For **Oracle Always-Free VM**: `docker run -d -p 80:80 -e MONGO_URI="..." -e MONGO_DB=plonter ...`.
