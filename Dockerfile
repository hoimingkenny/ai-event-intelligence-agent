# syntax=docker/dockerfile:1
# Multi-stage build. Runs TypeScript directly via tsx (no compile step needed
# for this service); deps are installed with `npm ci` for reproducibility.
# Pin the digest in production (Pillar 3) — tag used here for readability.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Non-root: the app never needs write access to its own code.
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node

# Default command runs the internal scheduler; override to `npm run pipeline:run`
# for one-shot / external-cron deployments, or `npm run worker` for queue mode.
CMD ["npm", "run", "scheduler"]
