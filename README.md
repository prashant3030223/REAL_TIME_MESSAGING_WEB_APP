# ConnectSphere

**ConnectSphere** is a next-generation real-time messaging, calling, and collaboration platform featuring **Predictive Call Recovery** — an autonomous telemetry modeling engine that estimates impending network degradation 5 to 10 seconds before failure and proactively adapts quality parameters to ensure 100% audio continuity.

---

## Key Features & Completed Pages

1. **Rich One-to-One & Group Messaging**:
   - Real-time message exchange with status receipts (sent, delivered, read blue checkmarks).
   - Voice notes with interactive waveform playback and speed controls (1x, 1.5x, 2x).
   - Document & image attachments, emoji reaction bar (`❤️ 👍 🔥 😂 😮 👏`), and quote replies.
   - Contact cards shared from device contacts or entered manually, with call, email, copy, and vCard save actions.
   - Link previews show website titles, descriptions, and privacy-preserving thumbnails fetched through validated public hosts.
   - Forward one or multiple messages to searched contacts or groups, add an optional caption, and keep the original sender private; deleted and expired messages cannot be forwarded.
   - Per-conversation disappearing-message timers (off, 1 hour, 24 hours, 7 days, 30 days, or a custom duration up to 30 days); scheduled messages start their timer when delivered.
   - Group owners and admins can configure who may send messages/media, add members, edit group details, pin messages, and create polls; API checks enforce each setting, including scheduled delivery.
   - Scheduled message delivery and pinned messages.

2. **Offline-First Resilience**:
   - Outbox queue: messages composed offline stay safely in "pending" status.
   - Automatic background dispatch and status synchronization upon network reconnection.
   - "Simulate Offline Mode" header toggle to test offline resilience on demand.

3. **WebRTC Voice & Video Calling with Live Predictive Call Recovery HUD**:
   - Real-time continuous monitoring of WebRTC statistics: RTT latency, Jitter, Packet Loss, Bitrate headroom, FPS, and Resolution.
   - Proactive adaptation threshold engine: automatically throttles video resolution (1080p -> 720p -> 480p -> 240p) and frame rate when risk is elevated or high, maintaining uninterrupted audio.
   - Smooth quality restoration after network stabilization.
   - In-call simulated network disruption buttons ("4G Surge", "Tunnel Congestion", "Clean Fiber").

4. **In-Call Live Collaboration Workspace**:
   - Shared HTML5 Whiteboard with pen, highlighter, eraser, color palette, and PNG export.
   - Shared Collaborative Notes & Task Checklist.
   - Consent-conscious AI Call Summary & Key Decisions generator.

5. **Predictive Call Recovery Simulation Lab**:
   - Interactive metric sliders for RTT, Jitter, Packet Loss, and Bitrate headroom.
   - Live rolling sparkline trend visualizer and real-time degradation risk gauge.
   - Adaptation event stream audit log.

6. **Calls Hub & DTMF Dialpad**:
   - Comprehensive call logs (incoming, outgoing, missed, declined) with timestamps and duration.
   - Web Audio API DTMF tone-synthesized keypad dialer.
   - Scheduled conference call reminders.

7. **Contacts & Communities Directory**:
   - Address book with live presence indicators and bio snippets.
   - Campus & guild community spaces with topic channels (`#general`, `#webrtc-research`, `#hackathon-2026`).
   - Profile QR code generator and interactive camera scanner simulator.

8. **Security, Privacy & Aesthetics**:
   - App Lock with 4-digit PIN and biometric passkey simulation.
   - Confidential / PIN-locked chat management.
   - Theme engine: Dark Obsidian, Pitch OLED, Cyberpunk Neon, and Clean Light.
   - Color accents: Emerald Green, Electric Violet, Ocean Cyan, Rose Pink, and Sunset Gold.
   - Accessibility suite: Text-to-speech speed slider, live captions, high contrast, and reduced motion modes.

---

## Architecture & Technology Stack

- **Frontend**: React 19, TypeScript, Vite 8, Lucide React, Web Audio API synthesizer, HTML5 Canvas.
- **Backend**: Node.js, Express 5, TypeScript (tsx), Helmet, Cookie Parser, Zod, Pino structured logging.
- **Algorithms**: `PredictiveCallRecoveryEstimator` rolling window trend estimator (`src/call-recovery/`).

---

## Running Locally

```sh
# 1. Install dependencies
npm install

# 2. Start the development server (API + Web concurrently)
npm run dev
```

- Web App: `http://127.0.0.1:5173/`
- API Server: `http://127.0.0.1:3001/`

---

## Verification & Tests

```sh
# Run TypeScript typechecks
npm run typecheck

# Run test suites (API + Call Recovery engine)
npm test

# Build production bundles (Typecheck + API + Web)
npm run build
```

---

## Production Deployment

### Required production configuration

- `DATABASE_URL` must point to a managed PostgreSQL database. The server refuses to start in production without it, so users and messages are not silently stored in memory.
- Set `DATABASE_SSL=true` when the database provider requires TLS (including Neon).
- Docker Compose requires `POSTGRES_PASSWORD` to be set in `.env`; never use the example value.
- Phone sign-in requires `SMS_HORIZON_TOKEN`, `SMS_HORIZON_USER`, `SMS_HORIZON_SENDER_ID`, and `SMS_HORIZON_TID`.
- Email password resets require `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME`.
- Reliable calls across restrictive mobile/carrier networks require `TURNIX_API_TOKEN`. Create a project API token in Turnix and add it to the backend secret/environment settings (or a local shell environment). The backend requests short-lived ICE credentials per call; never expose the token to frontend code or commit it.
- Chat file attachments require a private Cloudflare R2 bucket and the backend variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`. Create an R2 API token with access limited to that bucket, and keep its credentials server-side. Chat attachments stream directly to R2 without an app-level size cap; Cloudflare R2 and your hosting provider still impose maximum object/request limits.
- Add credentials in the hosting provider's secret/environment settings. Never commit `.env` files; rotate any credentials that have already been pushed to a remote repository.

For Docker Compose, copy `.env.production.example` to `.env`, fill in the four R2 values, and run `docker compose up -d`. For a standalone deployment, set the same variables on the API service.

### Option A: Docker Compose (Quickest Full-Stack Deployment)

The included `docker-compose.yml` provisions PostgreSQL 16 and builds the multi-stage production container with automatic migrations and health checks:

The API also applies pending migrations on startup when `DATABASE_URL` is configured. For bare-metal deployments, the explicit migration command below can still be used to apply and verify schema changes before starting the service.

```sh
# 1. Start application and database
docker compose up -d

# 2. View streaming logs
docker compose logs -f

# 3. Access ConnectSphere
# Open http://localhost:3001 in your browser
```

### Option B: Production Container (`Dockerfile`)

```sh
# Build production image
docker build -t connect-sphere:latest .

# Run with an external PostgreSQL database
docker run -d \
  --name connect-sphere \
  -p 3001:3001 \
  -e NODE_ENV=production \
  -e PORT=3001 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/dbname" \
  -e DATABASE_SSL="true" \
  -e TRUST_PROXY="1" \
  connect-sphere:latest
```

### Option C: Bare Metal / Linux VM / PaaS

```sh
# 1. Install production dependencies and build
npm ci
npm run build

# 2. Apply database migrations
DATABASE_URL="postgresql://user:pass@host:5432/dbname" npm run db:migrate:prod

# 3. Start unified production server
NODE_ENV=production PORT=3001 DATABASE_URL="postgresql://user:pass@host:5432/dbname" npm start
```

---

## Health Checks & Monitoring Endpoints

ConnectSphere exposes standard health and readiness probes for orchestrators (Kubernetes, AWS ECS, Docker Swarm):

- `GET /api/health/live` — Liveness check (200 OK if process is responsive).
- `GET /api/health/ready` — Readiness check (verifies PostgreSQL connection; returns 200 ready or 503 unavailable).
- `GET /api/telemetry/health` — WebRTC Predictive Call Recovery algorithm status and forecast parameters.

---

## Reverse Proxy (Nginx) Example

```nginx
server {
    listen 443 ssl http2;
    server_name connect.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/connect.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/connect.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
