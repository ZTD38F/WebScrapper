# Self-hosted WebScrapper Server

The server turns WebScrapper from a browser-only extension into a 24/7 local/VPS scraping service.

## What it provides

- authenticated REST API
- persistent Playwright/Chromium browser profiles
- SQLite-backed durable queue
- retryable leased workers
- recurring schedules
- cancellation
- result metadata
- screenshot/artifact storage
- optional OpenAI-compatible AI
- multiple workers
- no WebScrapper account, credits, subscription, or hosted quota

## Fastest deployment: Docker Compose

From the repository root:

```bash
cp server/.env.example .env
```

Set a long random token in `.env` if the service will be reachable by anything other than localhost:

```dotenv
WS_SERVER_TOKEN=replace-with-a-long-random-secret
```

Then start it:

```bash
docker compose up -d --build
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

The Docker service listens on `127.0.0.1:8787` by default, so it is not exposed publicly.

Persistent data is written to:

```text
./server-data/
├── webscrapper.sqlite3
├── profiles/
└── artifacts/
```

## Native Node deployment

Requirements:

- Node.js 22+
- Chromium dependencies supported by Playwright

Install:

```bash
cd server
npm install
npx playwright install --with-deps chromium
cp .env.example .env
```

Run after exporting the desired environment variables:

```bash
npm start
```

## Authentication

If `WS_SERVER_TOKEN` is non-empty, every endpoint except `/health` requires:

```http
Authorization: Bearer <token>
```

Do not expose an unauthenticated instance to the public internet.

## REST API

### Create scrape job

```http
POST /v1/scrape
Content-Type: application/json
Authorization: Bearer <token>
```

Example body:

```json
{
  "startUrl": "https://example.com/products",
  "profileId": "shopping",
  "rowSelector": ".product",
  "fields": [
    {"name":"title","selector":"h2","attribute":"text"},
    {"name":"price","selector":".price","attribute":"text"},
    {"name":"url","selector":"a","attribute":"href"}
  ],
  "pagination": "next",
  "maxPages": 0,
  "waitMs": 1000
}
```

Poll the durable queued job with `GET /v1/jobs/<job-id>`.

### Jobs

```text
POST /v1/jobs
POST /v1/scrape
GET  /v1/jobs
GET  /v1/jobs/:id
POST /v1/jobs/:id/cancel
```

### Schedules

```text
GET    /v1/schedules
POST   /v1/schedules
GET    /v1/schedules/:id
POST   /v1/schedules/:id/enabled
DELETE /v1/schedules/:id
```

### Persistent browser profiles

```text
GET    /v1/profiles
DELETE /v1/profiles/:id
```

A profile stores Chromium session state on disk and is serialized with a per-profile mutex, so two workers do not open the same persistent profile simultaneously.

### Artifacts

`GET /v1/artifacts/:jobId/:name`

Artifact paths are validated against traversal.

## Worker model

SQLite jobs use leased execution:

```text
queued
  ↓
running + worker_id + lease_until
  ↓
heartbeat renews lease
  ↓
succeeded / failed / cancelled
```

If a worker dies, an expired lease can be reclaimed. `WS_WORKERS` controls concurrency.

## Scheduling

Schedules are stored in SQLite and converted to jobs by the scheduler loop. Unlike `chrome.alarms`, this continues while the server is running even when Chrome/Edge with the extension is closed.

## Optional AI

```dotenv
WS_AI_ENDPOINT=http://127.0.0.1:11434/v1
WS_AI_MODEL=
WS_AI_VISION_MODEL=
WS_AI_API_KEY=
```

The server uses an OpenAI-compatible interface, so it is not tied to a WebScrapper cloud account.

## No artificial product limits

`WS_MAX_JOB_MS=0` disables WebScrapper's optional wall-clock cap. There is no subscription row limit, page limit, job credit system, or paid scheduler tier.

Physical constraints still exist: CPU, memory, storage, browser stability, network throughput, target-site behavior, and AI context capacity.

## Security baseline

- bind to localhost unless remote access is deliberately configured
- use `WS_SERVER_TOKEN` for remote access
- put TLS/reverse proxy in front of Internet-facing deployments
- protect `server-data/profiles` because browser profiles may contain authenticated session state
- do not publish `.env`
- use only on systems and data you are authorized to automate
