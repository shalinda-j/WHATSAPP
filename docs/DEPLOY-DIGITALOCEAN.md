# Deploying to DigitalOcean App Platform

This project deploys via a Dockerfile, not the Node buildpack. The buildpack
repeatedly fails with `npm lockfile is not in sync` because contributors run
mixed Node versions (engines field says 20.x, dev machines often have 22.x).
Docker pins Node 20.18.1 inside the image so the lockfile mismatch class of
error disappears.

## One-time setup

In the DO App Platform dashboard:

1. **Apps → your app → Settings → Components → `api` (or whatever the
   service is called)**.
2. Under **Source → Build & Deploy**:
   - **Build method:** _Dockerfile_
   - **Dockerfile path:** `Dockerfile`
   - **Source directory:** `/`
3. Save. The next push to `main` will rebuild using the Dockerfile.

Alternatively, point DO at the spec in this repo:

```bash
doctl apps create --spec .do/app.yaml
# or, for an existing app:
doctl apps update <APP_ID> --spec .do/app.yaml
```

## Secrets to set in the dashboard

Set these under **Settings → App-Level Environment Variables** (type: `SECRET`):

| Var                  | Required?    | Notes                                     |
| -------------------- | ------------ | ----------------------------------------- |
| `MONGODB_URI`        | yes          | Atlas connection string                   |
| `JWT_SECRET`         | yes (prod)   | 32+ char random                           |
| `ENCRYPTION_KEY`     | yes (prod)   | Exactly 32 chars, used by `CryptoService` |
| `GEMINI_API_KEY`     | one of these | At least one AI provider                  |
| `OPENAI_API_KEY`     | one of these |                                           |
| `GROQ_API_KEY`       | one of these |                                           |
| `OPENROUTER_API_KEY` | one of these |                                           |
| `ALLOWED_ORIGINS`    | recommended  | CORS list, comma-separated                |
| `WEBHOOK_SECRET`     | recommended  | Required to authenticate inbound webhooks |

## Health check

The container exposes `GET /health` on port 8080. DO probes it every 30s
with a 5s timeout (see `.do/app.yaml`).

## Local Docker smoke test

```bash
docker build -t whatsapp-bot .
docker run --rm -p 8080:8080 \
  -e MONGODB_URI=... \
  -e JWT_SECRET=... \
  -e ENCRYPTION_KEY=... \
  -e GEMINI_API_KEY=... \
  whatsapp-bot
# Then:
curl -fs http://localhost:8080/health
```

## Why we still gitignore the lockfile

When DO builds via Dockerfile, the lockfile is only used if it exists in
the build context. The Dockerfile is written to fall back to `npm install`
when `package-lock.json` is absent, so we keep the lockfile out of the
repo to avoid the cross-platform regeneration churn that caused the
original DO failures. If you want reproducible installs, generate the
lockfile inside the same Node 20 container before committing:

```bash
docker run --rm -v "$PWD:/app" -w /app node:20.18.1-bookworm-slim \
  sh -c "npm install --package-lock-only && cd client && npm install --package-lock-only"
```

Then `git add package-lock.json client/package-lock.json` after first
removing the `package-lock.json` line from `.gitignore`.
