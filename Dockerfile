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

RUN npm ci --include=dev --no-fund && mkdir -p /app/apps/gateway/node_modules

# ---- Stage 2: Build ----
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Prisma's query engine needs the OpenSSL ABI that Prisma detects at generate time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY package.json package-lock.json* ./
COPY tsconfig.base.json tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY packages/ ./packages/
COPY apps/gateway/ ./apps/gateway/
COPY config/ ./config/
COPY prisma/ ./prisma/

RUN npm run db:generate && \
    npm run build --workspace @apicenter/gateway && \
    npm prune --omit=dev && \
    mkdir -p /app/apps/gateway/node_modules && \
    npm cache clean --force

# ---- Stage 3: Production Runner ----
FROM node:24-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080

# Copy runtime dependencies and app build output from builder
COPY --chown=node:node package.json package-lock.json* ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=builder --chown=node:node /app/apps/gateway/package.json ./apps/gateway/package.json
COPY --from=builder --chown=node:node /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=builder --chown=node:node /app/config ./config

# Create logs directory
RUN mkdir -p /app/logs && chown node:node /app/logs

# Non-root user for security — Cloud Run runs containers under non-root
USER node

# Expose default Cloud Run port
EXPOSE 8080

CMD ["node", "apps/gateway/dist/main.js"]
