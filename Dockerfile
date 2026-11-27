# syntax=docker/dockerfile:1

# -------------------------------------------------------------
# Stage 1: Build Application (API + Web Client + Migrations)
# -------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first for Docker layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and configurations
COPY apps ./apps
COPY src ./src
COPY scripts ./scripts

# Run TypeScript typechecks and production builds
RUN npm run typecheck
RUN npm run build

# Remove development dependencies to keep production bundle lean
RUN npm prune --omit=dev

# -------------------------------------------------------------
# Stage 2: Production Runtime
# -------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment flags
ENV NODE_ENV=production
ENV PORT=3001

# Copy production node_modules and built artifacts from builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/src ./src

# Use non-root node user for container security
USER node

EXPOSE 3001

# Healthcheck probe using Node's native fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3001) + '/api/health/live').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
