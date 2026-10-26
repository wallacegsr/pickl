# syntax=docker/dockerfile:1
#
# Pickl — "Out of the pickle, onto the plate."
# Household recipe jar + weekly meal plan (Next.js 16 + SQLite).
#
# Node 24: the long-term-support line until April 2028. Node 20 reached end
# of life in April 2026 and stopped getting security fixes.

#############################################
# Base image with build tools for native deps
#############################################
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

#############################################
# Install dependencies (needs build tools for
# better-sqlite3's native compilation step)
#############################################
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

#############################################
# Build the Next.js app
#############################################
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js projects conventionally have a public/ directory, and the runtime
# stage copies it. This project has no static assets there (the favicon is a
# data URI in layout.tsx), and git does not track empty directories, so a
# fresh clone has no public/ at all and that COPY fails. Creating it here
# keeps the copy valid whether or not the project ever gains static assets.
RUN mkdir -p public
RUN npm run build

#############################################
# Minimal runtime image
#############################################
FROM node:24-bookworm-slim AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="Pickl"
LABEL org.opencontainers.image.description="Out of the pickle, onto the plate. Household recipe jar and weekly meal plan."

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/data/app.db

# Non-root user
RUN groupadd --system nodejs && useradd --system --gid nodejs --uid 1001 nextjs

# Next.js standalone output (server.js + minimal traced node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Migration tooling: drizzle migrations, the migrate/start scripts, and the
# drizzle-orm/better-sqlite3 packages needed to run them at container start.
# better-sqlite3 13+ loads its addon from its own prebuilds/ or build/ folder,
# so it no longer needs `bindings` or `file-uri-to-path` beside it.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

RUN mkdir -p /data && chown -R nextjs:nodejs /data /app

USER nextjs

EXPOSE 3000

CMD ["node", "scripts/start.js"]
