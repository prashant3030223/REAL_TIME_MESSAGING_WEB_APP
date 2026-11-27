# Deployment and Operations

## Production Readiness Status

ConnectSphere is configured for zero-downtime production deployment with:
- **Unified Production Server**: Express serves optimized Vite SPA static assets from `apps/web/dist` with long-term immutable caching for hashed bundles (`/assets/*`), `no-cache` HTML headers, and client-side SPA routing fallback.
- **Security & Headers**: Helmet with customized Content Security Policy (allowing secure WebRTC audio/media blobs and Unsplash avatars), HTTP Strict Transport Security, frame-guarding, X-Content-Type-Options, and configurable CORS origins.
- **Reverse Proxy & TLS Support**: Express `trust proxy` enabled for cloud load balancers and reverse proxies (AWS ALB, Nginx, Cloudflare), preserving real client IPs for rate-limiting and HTTPS secure cookies.
- **PostgreSQL Database Engine**: Connection pooling (`max`, `idleTimeoutMillis`, `connectionTimeoutMillis`), SSL encrypted connections (`DATABASE_SSL=true`), and transactional advisory-locked migration runner (`npm run db:migrate:prod`).
- **Containerization**: Multi-stage `Dockerfile` (Node 22 Alpine, non-root `node` user, layer-cached `npm ci`, pruned production dependencies, built-in container healthcheck) and `docker-compose.yml` for automated PostgreSQL 16 orchestration.
- **Graceful Termination**: Bounded graceful shutdown on `SIGTERM` / `SIGINT` with `server.closeIdleConnections()`, pool teardown, and a 10s watchdog force-exit timer.
- **Observability Probes**: Distinct `/api/health/live` (process liveness) and `/api/health/ready` (PostgreSQL ping) probes for Kubernetes/ECS orchestrators.

## Deployment Prerequisites

1. **Environment Setup**:
   - PostgreSQL 16+ database instance (provisioned with SSL support for cloud environments).
   - Node.js 22.12.0+ (if running on bare metal / VM) or Docker engine.
2. **Secrets Configuration**:
   - Supply `DATABASE_URL` via environment variables or secret manager (never committed to git).
   - Use `.env.production.example` as a template for production variables.
3. **TURN / STUN Relays**:
   - STUN alone cannot connect peers behind every carrier/mobile NAT or restrictive firewall. A TURN relay is required as a fallback. The recommended managed setup uses `TURNIX_API_TOKEN`; the API requests short-lived ICE credentials server-side for each call.
   - Create a project API token in Turnix and add it to the backend secret/environment settings. Never expose it to frontend code, logs, or source control.
   - The backend forwards the caller IP to Turnix for nearest-region routing. Configure trusted proxy settings correctly so Express `request.ip` reflects the real client IP.
   - For Docker Compose, set `TURN_URL`, `TURN_EXTERNAL_IP`, `TURN_SHARED_SECRET`, and `TURN_REALM` in `.env`, open the configured TURN port (default `3478`) plus UDP/TCP relay ports `49160-49200`, then start with `docker compose --profile turn up -d`.
   - Use a long random `TURN_SHARED_SECRET`; the API issues authenticated, 10-minute TURN credentials to signed-in users. Never expose the shared secret to the browser.
   - For managed hosting, configure the same API environment variables and run Coturn (or a managed TURN provider) on a public address with its relay port range open. Set `TURN_URL` to that public relay address.
4. **Chat Attachment Storage**:
   - Create a private Cloudflare R2 bucket and an R2 API token scoped to that bucket.
   - Configure `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME` as backend secrets. Do not expose the credentials in frontend configuration.
   - Chat attachments stream to R2 and have no app-level size cap. R2 and the hosting provider still enforce object, request, timeout, and bandwidth limits.
   - With Docker Compose, place these variables in `.env` before starting the app. Deleted messages remove their R2 attachment objects as well as their database references.

## Deployment Strategies

### 1. Docker Compose
Run the full stack with automated migration and health checks:
```sh
docker compose up -d
```

### 2. Standalone Container
```sh
docker build -t connect-sphere:latest .
docker run -d -p 3001:3001 --env-file .env.production connect-sphere:latest
```

### 3. Kubernetes / Cloud Platforms
- Liveness Probe: `HTTP GET /api/health/live` on port 3001 (initialDelay: 5s, period: 10s).
- Readiness Probe: `HTTP GET /api/health/ready` on port 3001 (initialDelay: 10s, period: 10s).
- Run migration job before rolling out new deployments: `node apps/api/dist/db/migrate.js`.

## Release workflow

- CI provisions PostgreSQL, applies migrations, and requires type-check, unit/integration tests, and frontend/backend builds. Before pilot, add formatting, security/secret scans, and deployment smoke tests.
- Deploy to staging first; apply reviewed backward-compatible migrations; run readiness checks and smoke tests.
- Promote only after verification. Define rollback or forward-recovery before risky schema changes.
- Keep health and readiness endpoints distinct. Use graceful shutdown and bounded retries.
- Alert on sustained API failures/latency, database exhaustion, queue backlog, WebSocket failures, call setup/reconnect regressions, and TURN/SFU resource exhaustion.

## Operations still required

Document actual environment variables and commands once the stack exists. Add runbooks for application, database, queue, WebSocket, TURN/SFU, deployment, restore, and security incidents. Verify backup restoration rather than relying on successful backup job status alone.
