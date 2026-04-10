# =============================================================================
# Dockerfile — API Center (Production-Hardened)
# =============================================================================
# MULTI-STAGE BUILD:
#  Stage 1 (deps):    Install ALL deps once for cached builds
#  Stage 2 (builder): Compile TypeScript and prune to production deps
#  Stage 3 (runner):  Copy only runtime artifacts and start the app
#
# WHY MULTI-STAGE:
#  - Final image is ~80% smaller (no TypeScript, no devDependencies)
#  - Faster deploys (smaller images push/pull faster)
#  - Smaller attack surface (fewer packages = fewer vulnerabilities)
#
# WHY ALPINE:
#  - Alpine Linux is ~5MB vs ~100MB for full Ubuntu
#  - Minimal packages = fewer CVEs to patch
#
# SECURITY:
#  - Runs as non-root user (appuser) — even if exploited, attacker has limited access
#  - No secrets baked into the image — all config comes from env vars at runtime
#  - Uses npm ci (not npm install) for deterministic, reproducible builds
# =============================================================================

# ---- Stage 1: Dependencies ----
FROM node:20-alpine AS deps

WORKDIR /app

# Install dependencies first (Docker caches this layer as long as package.json
# doesn't change, making rebuilds much faster)
COPY package.json package-lock.json* ./
RUN npm ci --include=dev --no-audit --no-fund

# ---- Stage 2: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Reuse dependencies from the deps stage to avoid reinstalling on source changes
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./

# Copy source and compile TypeScript (NestJS uses nest build)
COPY tsconfig.json nest-cli.json ./
COPY src/ ./src/
RUN npm run build && \
    npm prune --omit=dev && \
    npm cache clean --force

# ---- Stage 3: Production ----
FROM node:20-alpine AS runner

# Security: install dumb-init for proper signal handling in containers
# Node.js doesn't handle signals well as PID 1 — dumb-init fixes this
RUN apk add --no-cache dumb-init

WORKDIR /app

ENV NODE_ENV=production

# Copy runtime dependencies and app build output from builder
COPY --chown=node:node package.json package-lock.json* ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

# Create logs directory
RUN mkdir -p /app/logs && chown node:node /app/logs

# Non-root user for security — NEVER run containers as root in production
USER node

# Expose the application port
EXPOSE 3000

# Use dumb-init as PID 1 to properly forward signals (SIGTERM, SIGINT)
# This enables NestJS enableShutdownHooks() to work correctly inside Docker
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
