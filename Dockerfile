# syntax=docker/dockerfile:1.7
# Production image for the WhatsApp AI Bot platform.
# Built for DigitalOcean App Platform / any Dockerfile-based PaaS.
#
# Why a Dockerfile and not the Node buildpack?
#   The Heroku-style Node buildpack used by DO requires a lockfile that
#   matches the local npm version. With contributors on mixed Node
#   versions (20.x engines vs 22.x dev machines) the buildpack repeatedly
#   fails with "npm lockfile is not in sync". Docker pins Node 20 for
#   everyone, eliminating the class of error.

############################
# Stage 1: build everything
############################
FROM node:20.18.1-bookworm-slim AS builder

WORKDIR /app

# ffmpeg is needed by @ffmpeg-installer/ffmpeg at install time and by the
# voice pipeline at runtime; install once in the build image to avoid
# repeated downloads.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      build-essential \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install backend dependencies first (better layer caching).
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --include=dev; else npm install --include=dev; fi

# Install frontend dependencies.
COPY client/package.json client/package-lock.json* ./client/
RUN cd client \
 && if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source and build.
COPY tsconfig.json ./
COPY src ./src
COPY client ./client
RUN npm run build

# Prune dev dependencies from the backend node_modules so we can copy a
# lean tree into the runtime image.
RUN npm prune --omit=dev

############################
# Stage 2: minimal runtime
############################
FROM node:20.18.1-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

# Runtime ffmpeg (used by voice pipeline). Smaller than build-time deps.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
      tini \
 && rm -rf /var/lib/apt/lists/*

# Copy production node_modules + built artifacts.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/package.json ./package.json

# Drop privileges.
RUN groupadd --system --gid 1001 app \
 && useradd  --system --uid 1001 --gid app --create-home --shell /usr/sbin/nologin app \
 && chown -R app:app /app
USER app

EXPOSE 8080

# tini handles signal forwarding + zombie reaping; the bot relies on
# clean SIGTERM for graceful WhatsApp shutdown.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]

# DO App Platform health check hits /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
