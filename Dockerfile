# =============================================================================
# Dockerfile — API Center Gateway (Production-Hardened for GCP Cloud Run)
# =============================================================================
# MULTI-STAGE BUILD:
#  Stage 1 (deps):    Install ALL dependencies including workspace packages
#  Stage 2 (builder): Compile TypeScript monorepo packages & gateway app
#  Stage 3 (runner):  Copy only production runtime artifacts for Cloud Run
# =============================================================================

# ---- Stage 1: Dependencies ----
FROM node:24-bookworm-slim AS deps

WORKDIR /app

# Copy root manifest and workspace package manifests for cached dependency installation
COPY package.json package-lock.json* ./
COPY packages/ ./packages/
COPY apps/gateway/package.json ./apps/gateway/

RUN npm ci --include=dev --no-fund

# ---- Stage 2: Build ----
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY tsconfig.base.json tsconfig.json tsconfig.build.json nest-cli.json ./
COPY packages/ ./packages/
COPY apps/gateway/ ./apps/gateway/
COPY config/ ./config/
COPY prisma/ ./prisma/

RUN npm run db:generate && \
    npm run build --workspace @apicenter/gateway && \
    npm prune --omit=dev && \
    npm cache clean --force

# ---- Stage 3: Production Runner ----
FROM node:24-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy runtime dependencies and app build output from builder
COPY --chown=node:node package.json package-lock.json* ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/gateway/dist ./dist
COPY --from=builder --chown=node:node /app/config ./config

# Create logs directory
RUN mkdir -p /app/logs && chown node:node /app/logs

# Non-root user for security — Cloud Run runs containers under non-root
USER node

# Expose default Cloud Run port
EXPOSE 8080

CMD ["node", "dist/main.js"]
