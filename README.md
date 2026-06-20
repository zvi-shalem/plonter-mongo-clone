# plonter-mongo-clone — container deploy package

Containerized build of the Plonter clone (PHP 8.2 + Apache) running against **MongoDB Atlas**.
Reproduces the live path layout: every PHP API at `/plonter/api/<name>.php`, the SPA at
`/plonter/clone/`. The Atlas connection string is read from the **`MONGO_URI` environment
variable only** — it is never stored in this repo or baked into the image.

## Deploy (Render free tier)

See [`deploy/DEPLOY_RENDER.md`](deploy/DEPLOY_RENDER.md) for full steps. Short version:

1. Render → **New → Blueprint** (uses [`deploy/render.yaml`](deploy/render.yaml)) or **New → Web Service** (Docker, Dockerfile `deploy/Dockerfile`, context `.`).
2. Set env vars: `MONGO_URI` (secret — your Atlas SRV string) and `MONGO_DB=plonter`.
3. Deploy. Health check: `GET /plonter/api/content_org_api.php?action=ping` → `{"ok":true,"pong":true}`.

## Build context

The Docker build context is the repo root; the Dockerfile lives at `deploy/Dockerfile`.
The image bundles `vendor/` (composer `mongodb/mongodb`) and installs the `mongodb` PECL
extension at build time. No secrets or database files are present in this repo.
