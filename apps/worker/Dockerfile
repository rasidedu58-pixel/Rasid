# syntax=docker/dockerfile:1

# ---- Base ---------------------------------------------------------------
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---- Dependencies (full workspace, needed for pnpm workspace resolution) -
FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- Build ----------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
RUN pnpm --filter @academic-precision/config... --filter @academic-precision/observability... --filter @academic-precision/worker... build

# ---- Runtime ----------------------------------------------------------------
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules

# Phase 15D.1 — drop from root to the image's built-in unprivileged `node`
# user. Copied files are world-readable and the worker needs no write access
# to the filesystem (it only talks to Postgres and logs to stdout).
USER node

CMD ["node", "apps/worker/dist/main.js"]
