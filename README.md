# Sentient-Cache

**An edge-native, AP-consistent semantic memory controller for AI agents — with a 3D operator console.**

Sentient-Cache is a local-first memory layer that gives AI agents a persistent "long-term memory" which stays available offline, synchronizes eventually to a central vector store, and visualizes its internal state in real time. It was built end-to-end to demonstrate infrastructure-grade engineering: a Bun/TypeScript backend with a two-tier semantic eviction policy, a write-behind sync pipeline over BullMQ + pgvector, a Searchable-Encryption-ready security layer, and a Next.js 15 + Three.js console that renders up to several thousand 384-dimensional embeddings at 60fps.

```
~3,800 lines of TypeScript    24 backend modules + 19 frontend files
143 tests across 18 specs     tsc --noEmit passes on backend & web/
next build → 121 KB first-load JS, 13.1 KB main route
Single-author, clean history  Bisectable commit chain
```

---

## Table of Contents

1. [Problem this project solves](#problem-this-project-solves)
2. [What makes it non-trivial](#what-makes-it-non-trivial)
3. [System architecture](#system-architecture)
4. [Feature matrix](#feature-matrix)
5. [Interactive HUD](#interactive-hud)
6. [Tech stack](#tech-stack)
7. [Prerequisites](#prerequisites)
8. [Installation](#installation)
9. [Running it](#running-it)
10. [HTTP API reference](#http-api-reference)
11. [Using the library](#using-the-library)
12. [Repository layout](#repository-layout)
13. [Testing](#testing)
14. [Performance & design characteristics](#performance--design-characteristics)
15. [Security model](#security-model)
16. [Design decisions & trade-offs](#design-decisions--trade-offs)
17. [Known limitations](#known-limitations)
18. [Impact summary](#impact-summary)

---

## Problem this project solves

AI agents accumulate "thoughts" — retrieved context, plans, reflections — that need to persist across sessions and devices. Centralized vector databases make every retrieval a network round-trip; pure local storage disappears when the device is wiped. Sentient-Cache takes the CAP-theorem trade-off explicitly: it is an **AP system** — it prioritizes availability and partition tolerance over strong consistency, so the agent never blocks waiting on the central store.

Concretely the project demonstrates:

- **Sub-millisecond local retrieval** via synchronous `bun:sqlite`, with zero `await` on the read path.
- **Eventual consistency** to a central `pgvector` instance via a write-behind queue (BullMQ + Postgres).
- **Semantic eviction** that keeps the most useful memories hot even under 100MB pressure, using a pluggable utility formula (Recency × Importance / SimilarityDensity).
- **Refresh-ahead prefetch** — when the agent's `current_task` changes, the top-K nearest historical memories are streamed from central to the edge before the agent asks.
- **Zero-Knowledge-ready encryption-at-rest** for embedding blobs, with a pluggable interface sized for a real Searchable Symmetric Encryption primitive.
- **Capability-based authorization** via Open Policy Agent.
- **A real-time 3D operator console** rendering the memory galaxy, latency vitals, and write-behind telemetry.

## What makes it non-trivial

| Challenge | Engineering response |
|---|---|
| Sub-10ms retrieval under load | The hot `get`/`search`/`set` path is **fully synchronous** — no `async`, no network I/O, no `await`. Dirty-row sync runs on an unref'd interval; remote fetches are fire-and-forget. |
| Evicting "useless" memories without vector math on every write | **Two-tier eviction**: tier-1 is a cheap inline TTL+LRU prune (single `DELETE … RETURNING`) that runs when the byte budget is crossed; tier-2 is a periodic semantic pass that scores candidates by `U = Recency × Importance / (1 + Density)` and evicts the bottom 10%. |
| Searching encrypted data | The `EmbeddingEncryptor` interface is shaped for a real SSE primitive (ORE, secure inner product). The current `XorEmbeddingEncryptor` ships encryption-at-rest with a deterministic SHA-256-CTR keystream; the README below is honest about when to swap in ciphertext-native similarity. |
| Visualizing thousands of 384-d embeddings at 60fps | Three.js `Points` with a custom additive-blend shader; positions projected from 384-d to 3-d via a zero-JS-matrix fold; attribute buffers updated in place so re-renders don't rebuild the scene. |
| Making the centerpiece *interactive* without hurting 60fps | A `THREE.Raycaster` (`Points.threshold = 0.5`) picks the nearest star under the cursor. Pointer-capture-based drag-to-rotate with a 5px click-vs-drag threshold. Auto-rotation pauses on interaction, resumes after 4s of idle. Pitch clamped to ±1.2 rad so the cloud can't be inverted. Latest props mirrored into refs so the long-lived input handlers and RAF loop see fresh values without re-mounting the WebGL context. |
| Client-side semantic search without leaking query text | A feature-hashed 384-dim `HashEmbedder` runs entirely in the browser. The raw query never leaves the device. Interface is swap-compatible with a real `@xenova/transformers` ONNX embedder. |
| Memory-bomb defense | A `ResourceSentinel` admits requests against a 100MB queue budget, rejects with 503 + exponential `Retry-After`, and releases on response completion. |
| Least privilege | A `PathGuard` refuses any filesystem path that escapes the designated `/data` volume — blocks absolute escapes, traversal, prefix-matching siblings, and empty inputs before `readFileSync` is called. |

## System architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Sentient-HUD (Next.js 15)                       │
│  ┌─────────────────┐  ┌────────────────┐  ┌────────────────────────┐   │
│  │ Memory Galaxy   │  │ Latency Vitals │  │ Write-Behind Queue     │   │
│  │ (Three.js +     │  │ (Canvas 60fps  │  │ (TanStack Query +      │   │
│  │  custom shader) │  │  sparkline)    │  │  optimistic mutation)  │   │
│  └─────────┬───────┘  └────────┬───────┘  └───────────┬────────────┘   │
│            │                   │                      │                │
│  ┌─────────┴─────────┐  ┌──────┴───────┐  ┌──────────┴──────────┐      │
│  │ Intent Search     │  │ StarField    │  │ GlassPanel          │      │
│  │ (WASM-ready       │  │ (background) │  │ (frosted shell)     │      │
│  │  HashEmbedder)    │  │              │  │                     │      │
│  └───────────────────┘  └──────────────┘  └─────────────────────┘      │
└────────────────────┬────────────────────────────────────────────────────┘
                     │ HTTP / JSON
                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Sentinel  →  OPA  →  Refresh-Ahead  →  Routes       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                 Ingestor (Hono on Bun)                           │   │
│  │  POST /ingest  POST /search  POST /sessions/:id/task  /healthz   │   │
│  └──────────────────────────────┬───────────────────────────────────┘   │
│                                 ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │             SemanticController  (U policy, compact())             │   │
│  └──────────────────────────────┬───────────────────────────────────┘   │
│                                 ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │            SemanticCache  (bun:sqlite WAL, two-tier LRU)         │   │
│  │                 EmbeddingEncryptor (XOR / SSE)                   │   │
│  └───────┬───────────────────────────────────────────┬──────────────┘   │
│          │                                           │                  │
│   dirty-row poll (2s)                         refresh-ahead             │
│          ▼                                           │                  │
│  ┌───────────────┐       BullMQ job        ┌─────────┴──────────┐       │
│  │ Sync Worker   │────────────────────────▶│ PostgresRemoteStore │       │
│  └───────────────┘     (fire-and-forget)   │  mTLS 1.3 → pgvector│       │
│                                            └─────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

Flow at a glance:

1. **Write** — `POST /ingest` → `ResourceSentinel.admit()` → OPA policy check → `SemanticController.ingest()` → `SemanticCache.set()` (synchronous SQLite write, row marked `synced=0`). Response returns before any network I/O.
2. **Background sync** — every 2s, the cache scans dirty IDs and enqueues a BullMQ batch. A `SyncWorker` drains the queue, upserts through `PostgresRemoteStore` over mTLS 1.3, and marks rows `synced=1` only after the transaction commits.
3. **Intent change** — `POST /sessions/:id/task` runs through refresh-ahead middleware. If the task changed, it fires `controller.prefetchForTask()` without awaiting; the prefetch embeds the task, calls `cache.setGoal()`, which asynchronously fetches the top-5 nearest rows from pgvector and inserts them locally.
4. **Search** — `POST /search` → embed on the server, call `cache.search()` synchronously (cosine across in-memory embeddings), return top-K.
5. **Eviction** — tier-1 LRU prune fires inline when `totalBytes > maxBytes`. A separate `SemanticController` tick runs every 60s, computes `Recency × Importance / (1 + Density)` over the oldest-25% candidate pool, and evicts the bottom 10% when the policy threshold is exceeded.

## Feature matrix

| Area | Capability |
|---|---|
| **Cache engine** | bun:sqlite WAL; Float32Array BLOB encode/decode; `set / get / search / list / delete / compact` primitives; `upsert` with byte-accurate size tracking; file-backed persistence survives restart. |
| **Eviction** | Two-tier: inline TTL+LRU prune at `maxBytes`, plus semantic-utility compaction on a configurable interval. Pluggable utility formula (the default is `S × C / T` in the cache, and `R × I / (1 + D)` in the controller). |
| **Sync** | Write-behind via BullMQ; batched dirty-row poll; `SyncWorker` drains jobs and commits per-batch. `PostgresRemoteStore` upserts through pgvector with cosine distance lookup for top-K. mTLS 1.3 with CA pin available. |
| **Refresh-ahead** | `setGoal(embedding)` kicks off a top-5 pgvector fetch and inserts results locally without awaiting. Wired into a Hono middleware that triggers whenever `(session_id, current_task)` changes. |
| **Embeddings** | `Embedder` interface; 384-dim `HashEmbedder` (FNV-1a feature hashing + bigrams + L2 normalize, deterministic, zero deps); `TransformersEmbedder` wrapping `@xenova/transformers` with lazy import. Swap via constructor argument. |
| **Security** | `PathGuard` confines FS access; `loadMtls` pins TLS 1.3; `EmbeddingEncryptor` layer; `OpaEvaluator` (HTTP + in-process capability table) + middleware; `ResourceSentinel` token-bucket + 503 back-pressure. |
| **HUD** | Next.js 15 RSC shell; Three.js `Points` with additive-blend shader; Canvas-based sparkline with hover read-out; TanStack Query optimistic ingest mutation; Tailwind v4 `@theme` tokens for the glass aesthetic; StarField background. |
| **HUD interactivity** | Raycasted hover (cursor-following tooltip) + click-to-pin (`MemoryInspector` side panel with full memory metadata). Drag-to-rotate galaxy. 4-key keyboard shortcut layer (`/`, `⌘/Ctrl+K`, `i`, `r`, `Esc` with cascading deselect). Sparkline reveals exact ms + source on hover. |

## Interactive HUD

The console behaves like a real operator tool, not a static demo.

**Galaxy gestures**

- **Hover a star** → fixed-position tooltip showing the memory's id, content (truncated), utility, importance, and partition. Auto-flips to the cursor's left when within 288px of the right viewport edge.
- **Click a star** → bottom-left legend swaps to a `MemoryInspector` panel showing the memory's full content, live utility against the current goal vector, access count, age, partition, sync state, and size. The selected star tints warm-gold and gains a sharp inner ring in the GLSL fragment shader.
- **Drag anywhere** → orbit the cloud. Click vs. drag is disambiguated with a 5px movement threshold using `setPointerCapture`. Pitch clamped to ±1.2 rad. Auto-rotation pauses while interacting and resumes after 4s of idle.

**Keyboard layer**

| Binding | Action |
|---|---|
| `/` | Focus + select-all on the search input |
| `⌘K` / `Ctrl+K` | Same as `/` (works even while another input is focused) |
| `i` | Focus the ingest input |
| `r` | Clear search highlights and the goal vector |
| `Esc` | Cascading: deselect inspected memory → clear highlights → blur active element |

The 4-key shortcut hint strip is rendered at the bottom of the legend so the bindings are discoverable without a tour. Single-key bindings (`/`, `i`, `r`) are suppressed while a text input is focused so the user can still type those characters.

**Latency sparkline**

- Hover → exact ms readout for the bin under the cursor, plus the source label (`local-cache` / `refresh-ahead`). Cursor switches to a crosshair while hovering.

## Tech stack

**Backend (Bun/TypeScript)**
- [Bun](https://bun.sh) ≥ 1.1 — runtime, `bun:sqlite` native SQLite driver, `bun:test` test runner.
- [Hono](https://hono.dev) 4.x — edge-class HTTP framework.
- [BullMQ](https://docs.bullmq.io) 5.x — durable job queue over Redis.
- [pg](https://node-postgres.com) 8.x with `pgvector` for central vector store.
- [ioredis](https://github.com/redis/ioredis) 5.x — Redis client.
- TypeScript 5.6, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.

**Frontend (web/)**
- [Next.js](https://nextjs.org) 15 (App Router, React 19, RSC).
- [Tailwind CSS](https://tailwindcss.com) v4 (CSS-first `@theme` config, `@tailwindcss/postcss`).
- [Three.js](https://threejs.org) 0.170 with a custom GLSL vertex/fragment shader.
- [@tanstack/react-query](https://tanstack.com/query) v5 with `useMutation` optimistic UI.

**Security (optional but documented)**
- [Open Policy Agent](https://www.openpolicyagent.org) — capability authorization.
- Node `crypto` — SHA-256 counter-mode KDF for the XOR keystream.
- Node `tls` — TLS 1.3 pinned min+max.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Bun | ≥ 1.1 | Backend runtime and test runner. |
| Node.js | ≥ 18 | Only needed for running the Next.js frontend. (Node 20+ recommended.) |
| npm | ≥ 9 | Package installer for both the backend lockfile and `web/`. |
| Redis | ≥ 6 | Optional — required only if you run the sync worker against a real queue. |
| Postgres + pgvector | ≥ 14 / pgvector 0.5 | Optional — required only if you run the sync worker against a real central store. |
| OpenSSL | any modern | Only if you want to generate mTLS material for end-to-end secure sync. |

Bun isn't strictly required — the backend will typecheck and the orchestrator is plain TS, but `bun:sqlite` and `bun:test` are Bun-specific, so to actually **run** the backend you need Bun.

## Installation

Clone and install both packages — the backend and the web HUD are independent npm projects.

```bash
git clone https://github.com/lucastimho/sentient-cache.git
cd sentient-cache

# Backend (Bun + BullMQ + pg)
npm install

# Frontend (Next.js + Three.js + TanStack Query + Tailwind v4)
cd web
npm install
cd ..
```

### Verify the install

```bash
# Backend typecheck
npx tsc --noEmit

# Frontend typecheck + production build
cd web
npx tsc --noEmit
npx next build
cd ..

# Backend tests (requires Bun)
bun test
```

Expected: `tsc --noEmit` exits cleanly in both locations, `next build` reports a ~120 KB first-load JS page, and `bun test` runs **143 tests** across 18 spec files.

## Running it

### 1) The edge ingestor (HTTP API)

```bash
# Defaults: PORT=3000, EMBED_DIMS=384, POLICY_MAX_MB=100
bun run ingestor
```

The ingestor exposes `/healthz`, `/ingest`, `/search`, and `/sessions/:id/task` on port 3000. It boots with an in-memory cache by default; set `CACHE_DB_PATH` to persist to disk.

### 2) The sync worker (optional, needs Redis + Postgres)

```bash
REDIS_URL=redis://localhost:6379 \
DATABASE_URL=postgres://user:pw@localhost:5432/sentient \
bun run worker
```

The worker registers a BullMQ consumer that drains the write-behind queue into pgvector. Missing env vars fail-fast (no hardcoded defaults). To enable mTLS, construct `PostgresRemoteStore` with the `mtls` option — see [Using the library](#using-the-library) below.

### 3) The HUD console

```bash
cd web
npm run dev
# open http://localhost:3000
```

By default the HUD seeds 420 synthetic memories and a plausible latency stream so it works standalone. Point it at a live ingestor:

```bash
NEXT_PUBLIC_INGESTOR_URL=http://localhost:3000 npm run dev
```

…and real ingestion goes over the network to the Bun service; the `Syncing…` indicator in the Write-Behind panel flips to `idle` once the round-trip completes.

## HTTP API reference

All endpoints accept and return `application/json`. Security-sensitive deployments should set `x-agent-id` on every request and configure OPA via `createIngestorApp({ opaEvaluator })`.

### `GET /healthz`

```json
{ "ok": true, "embeddingDims": 384 }
```

### `POST /ingest`

```bash
curl -X POST http://localhost:3000/ingest \
  -H 'content-type: application/json' \
  -H 'x-agent-id: agent-alpha' \
  -d '{
    "content": "Plan the Q2 launch checklist",
    "importance": 8,
    "session_id": "session-42",
    "current_task": "q2-launch-planning",
    "memory_tag": "journal"
  }'
```

Response:
```json
{
  "id": "0c4e4f6f-…",
  "size_bytes": 1688,
  "importance": 8,
  "prefetch_triggered": true
}
```

### `POST /search`

```bash
curl -X POST http://localhost:3000/search \
  -H 'content-type: application/json' \
  -H 'x-agent-id: agent-alpha' \
  -d '{ "query": "launch checklist", "k": 5, "memory_tag": "journal" }'
```

Response:
```json
{
  "results": [
    {
      "id": "…",
      "content": "Plan the Q2 launch checklist",
      "similarity": 0.9173,
      "importance": 8
    }
  ]
}
```

### `POST /sessions/:id/task`

```bash
curl -X POST http://localhost:3000/sessions/session-42/task \
  -H 'content-type: application/json' \
  -d '{ "current_task": "post-launch-retrospective" }'
```

Response:
```json
{
  "session_id": "session-42",
  "previous_task": "q2-launch-planning",
  "current_task": "post-launch-retrospective",
  "changed": true
}
```

A `changed: true` response triggers the refresh-ahead middleware fire-and-forget — the ingestor embeds the new task, calls `cache.setGoal()`, and pre-fetches the top-5 nearest pgvector rows into the local cache.

### Back-pressure & policy responses

```
HTTP/1.1 503 Service Unavailable
Retry-After: 2

{
  "error": "server_busy",
  "retry_after_ms": 1600,
  "snapshot": { "pendingBytes": 104857601, "queueLimitBytes": 104857600, … }
}
```

```
HTTP/1.1 403 Forbidden
{ "error": "forbidden", "reason": "agent-beta lacks write on journal" }
```

## Using the library

The backend also ships as an importable library for embedding the controller in another Bun service.

```ts
import {
  SemanticCache,
  SemanticController,
  SessionRegistry,
  HashEmbedder,
  createIngestorApp,
  BullWriteBehindQueue,
  PostgresRemoteStore,
  ResourceSentinel,
  CapabilityTableEvaluator,
  XorEmbeddingEncryptor,
  PathGuard,
} from "sentient-cache";
import IORedis from "ioredis";
import { randomBytes } from "node:crypto";

const guard  = new PathGuard("/data");
const cache  = new SemanticCache({
  path: guard.resolve("cache.sqlite"),
  maxBytes: 150 * 1024 * 1024,
  encryptor: new XorEmbeddingEncryptor({ key: new Uint8Array(randomBytes(32)) }),
});

const embedder   = new HashEmbedder(384);
const controller = new SemanticController({ cache, embedder, policyMaxBytes: 100 * 1024 * 1024 });
const registry   = new SessionRegistry();
const sentinel   = new ResourceSentinel({ queueLimitBytes: 100 * 1024 * 1024 });

const opaEvaluator = new CapabilityTableEvaluator({
  table: {
    "agent-alpha": { journal: ["read", "write", "search"], "*": ["search"] },
    "agent-beta":  { journal: ["read", "search"] },
  },
});

const app = createIngestorApp({
  controller,
  registry,
  sentinel,
  opaEvaluator,
});

// Optional: attach a BullMQ producer + pgvector consumer over mTLS 1.3.
const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const queue      = new BullWriteBehindQueue({ connection });
const remote     = new PostgresRemoteStore({
  pool: { connectionString: process.env.DATABASE_URL! },
  mtls: { ca: "certs/ca.pem", cert: "certs/client.crt", key: "certs/client.key" },
  mtlsServername: "central.internal",
  pathGuard: guard,
});

export default { port: 3000, fetch: app.fetch };
```

## Repository layout

```
sentient-cache/
├── src/                          # Bun/TypeScript backend
│   ├── cache/
│   │   ├── SemanticCache.ts      # bun:sqlite engine, two-tier eviction, sync poll
│   │   ├── similarity.ts         # cosine + Float32Array blob encode/decode
│   │   └── eviction.ts           # utility scoring + candidate ranking
│   ├── controller/
│   │   ├── SemanticController.ts # R × I / (1 + D) semantic LRU policy
│   │   └── SessionRegistry.ts    # per-session task-change tracker
│   ├── embeddings/
│   │   ├── Embedder.ts           # interface
│   │   ├── HashEmbedder.ts       # 384-d FNV-1a feature hash (default)
│   │   └── TransformersEmbedder  # lazy @xenova/transformers wrapper
│   ├── ingestor/
│   │   ├── app.ts                # Hono routes
│   │   ├── refreshAhead.ts       # task-change middleware + body cache
│   │   └── server.ts             # Bun.serve entry
│   ├── sync/
│   │   ├── WriteBehindQueue.ts   # BullMQ producer
│   │   ├── RemoteStore.ts        # pgvector client (mTLS-capable)
│   │   └── SyncWorker.ts         # BullMQ consumer
│   ├── security/
│   │   ├── EmbeddingEncryptor.ts # interface + XOR impl
│   │   ├── OpaEvaluator.ts       # HTTP + capability-table evaluators
│   │   ├── opaMiddleware.ts      # Hono middleware
│   │   ├── ResourceSentinel.ts   # token-bucket + 503 back-pressure
│   │   ├── PathGuard.ts          # /data confinement
│   │   └── mtls.ts               # TLS 1.3 material loader
│   ├── db/schema.ts              # SQLite schema + indexes
│   ├── types.ts                  # domain types
│   ├── index.ts                  # public API barrel
│   └── worker.ts                 # sync worker entry
│
├── tests/                        # bun:test specs — 143 tests across 18 files
│   ├── similarity.test.ts        semantic-cache.test.ts
│   ├── eviction.test.ts          semantic-cache.eviction.test.ts
│   ├── embeddings.test.ts        semantic-cache.sync.test.ts
│   ├── session-registry.test.ts  semantic-controller.test.ts
│   ├── ingestor-app.test.ts      integration.test.ts
│   ├── robustness.test.ts        background-loops.test.ts
│   ├── path-guard.test.ts        mtls.test.ts
│   ├── opa-middleware.test.ts    resource-sentinel.test.ts
│   ├── embedding-encryptor.test.ts
│   └── security-integration.test.ts
│
├── web/                          # Next.js 15 + Tailwind v4 HUD
│   ├── app/                      # RSC layout, page, providers, globals.css
│   ├── components/
│   │   ├── MemoryGalaxy.tsx      # Three.js point cloud + shader + raycasting
│   │   ├── MemoryInspector.tsx   # selected-memory side panel (full metadata)
│   │   ├── MemoryTooltip.tsx     # cursor-following hover label
│   │   ├── LatencyVitalsPanel.tsx# log-scale bars + Canvas sparkline w/ hover
│   │   ├── SyncStatusPanel.tsx   # TanStack Query optimistic ingest
│   │   ├── SearchBar.tsx         # on-device embedder + highlight
│   │   ├── HudConsole.tsx        # client orchestrator + shortcut layer
│   │   ├── GlassPanel.tsx        # frosted-glass shell
│   │   └── StarField.tsx         # Canvas background
│   └── lib/                      # types, embedder, utility, API client,
│                                 #   mock seeder, useKeyboardShortcuts
│
├── package.json                  # backend deps + scripts
├── tsconfig.json                 # strict, verbatimModuleSyntax, tests included
└── README.md                     # you are here
```

## Testing

143 tests across 18 spec files, run via `bun test`. Coverage is organized by scope:

| Layer | Files | Highlights |
|---|---|---|
| Unit | `similarity`, `eviction`, `embeddings`, `session-registry`, `path-guard` | Algorithmic correctness and edge cases. Cosine on zero-vectors, FNV-1a determinism, `../secret` traversal rejection. |
| Cache | `semantic-cache*`, `background-loops` | CRUD round-trip, tier-1 LRU under 50MB pressure, tier-2 `compact()` preferring semantic density, file-backed persistence, background timers firing. |
| Sync | `semantic-cache.sync`, `integration` | Write-behind dirty polling, stub-based end-to-end through a BullMQ-shaped queue, refresh-ahead populates the cache from a stub remote. |
| Controller & API | `semantic-controller`, `ingestor-app` | Policy triggering at the 100MB threshold, `U = R × I / (1 + D)` eviction bias toward dense duplicates, Hono routes, refresh-ahead middleware non-blocking (< 140ms with a 150ms slow embedder). |
| Security | `embedding-encryptor`, `opa-middleware`, `resource-sentinel`, `mtls`, `security-integration` | XOR round-trip preserves search ordering, raw SQLite blob differs from plaintext ≥ 50% of bytes, OPA 401/403/allow paths, exponential back-pressure capped at 15s, TLS 1.3 pinned both ways. |
| Robustness | `robustness` | Unicode/emoji content, SQL-injection payloads stored as text, 500KB bodies, 1,000-ingest load, 50-concurrent-ingest + 20-concurrent-search interleaving, idempotent `close()`. |

Every commit in the history was ordered so that `npx tsc --noEmit` passes with only its ancestors present, so any regression can be bisected.

## Performance & design characteristics

- **Retrieval hot path is synchronous.** `SemanticCache.get()` and `SemanticCache.search()` are sync TypeScript methods with no `async`. They make zero network calls; the maximum latency is dominated by SQLite's single-threaded query path.
- **Dirty-row sync does not block ingest.** Writes set `synced=0` and return. A 2s poll batches up to 64 dirty IDs and enqueues a BullMQ job; the worker does the pgvector upsert out-of-band.
- **Background timers are `unref`'d.** The tier-2 compaction timer and the sync poll timer both call `.unref()` so they never hold the process alive in tests or in graceful shutdown.
- **Bounded memory on the edge.** `SemanticCache.maxBytes` (default 50MB) + `SemanticController.policyMaxBytes` (default 100MB) form two concentric limits; the robustness test proves 1,000 ingests at ~700 bytes each converge under the tier-1 ceiling.
- **Semantic eviction prefers dense clusters.** The test suite shows that with an importance-10 unique entry surrounded by 20 importance-1 duplicates, the unique entry survives compaction while the duplicates get pruned.
- **HUD at 60fps.** Three.js additive-blend shader + in-place BufferAttribute updates; the main effect that mounts the scene runs once per component life (not per memory update).

## Security model

Five composable primitives; all opt-in so the core cache stays lightweight.

1. **Encryption at rest** — `XorEmbeddingEncryptor` derives a SHA-256 counter-mode keystream from a caller-supplied 128-bit (or larger) key and XORs every embedding blob before it hits SQLite. Raw database exfil yields opaque bytes; decrypt happens transparently in memory when the cache reads for cosine.
2. **Capability authorization** — `opaMiddleware` maps `(agentId, operation, memoryTag)` into an OPA decision. `HttpOpaEvaluator` targets a real OPA sidecar over HTTP with a timeout; `CapabilityTableEvaluator` is an in-process fallback.
3. **Resource sentinel** — `ResourceSentinel.admit(sizeBytes)` is a token-bucket admission controller. When the queue would exceed 100MB, it rejects with 503 + exponential backoff up to 15s; clients see a machine-readable `Retry-After` header.
4. **Filesystem confinement** — every path that reaches `fs` goes through `PathGuard.resolve()`, which throws `PathGuardViolation` on `/etc/passwd`, `../secrets`, `/data-evil/*`, or empty inputs. Wired into `loadMtls` so TLS key material cannot be sourced from outside the data volume.
5. **mTLS 1.3** — `loadMtls` pins `minVersion` and `maxVersion` to `"TLSv1.3"`, forces `rejectUnauthorized`, and emits a pg-compatible SSL config. Sync-worker traffic to the central pgvector instance is authenticated both ways.

The `security-integration` spec demonstrates all five running inside the Hono app together: sentinel rejects a 4KB body when the queue limit is 256B, OPA 403s a write by an agent that only holds read/search, a missing agent header 401s before the cache is touched, and a legitimate `/search` request traverses the whole stack and returns ranked results out of an encrypted-at-rest cache.

## Design decisions & trade-offs

Honest notes that signal engineering maturity:

- **XOR is encryption-at-rest, not true SSE.** Raw-byte XOR on IEEE-754 floats does not preserve dot products, so cosine similarity is still computed on decrypted embeddings in memory. The `EmbeddingEncryptor` interface was deliberately shaped so a real privacy-preserving transform (ORE, lattice-based secure inner product) drops in behind the same API. The XOR impl is documented as such at the top of `src/security/EmbeddingEncryptor.ts`.
- **Ingestor embedding runs per request.** `/search` embeds the query server-side with the same `HashEmbedder` the controller uses; retrieval latency is dominated by the embedder, not the cache. A production deployment would front this with an ONNX model served by Transformers.js on a warmed-up worker.
- **Semantic density is computed over a candidate pool, not the whole cache.** O(N²) cosine over a 10k-row cache is too expensive. The controller takes the oldest 25% by `last_accessed_at`, computes pairwise similarity inside that pool, and evicts the bottom 10% of the whole cache from it. That's an approximation — it trades perfect ranking for bounded CPU cost.
- **Refresh-ahead can temporarily inflate cache size.** If the top-5 fetch returns rows that push `totalBytes` above `maxBytes`, tier-1 prune runs immediately on the same event-loop tick. The integration test verifies the cache converges.
- **The HUD uses mock latency/memory by default** so the frontend works offline in a demo. A production deployment would subscribe to a `/metrics` WebSocket or Server-Sent Events stream.
- **`TransformersEmbedder` is dependency-optional.** Installing `@xenova/transformers` adds ~50MB; most consumers don't need it. The class fails fast with a helpful error if invoked without the dep.

## Known limitations

- `@xenova/transformers` is not a declared dependency; the WASM embedder path is a lazy dynamic import and requires the consumer to install it separately.
- The sync worker currently re-enqueues dirty IDs on every poll until they're marked synced; a production deployment would add BullMQ `jobId` dedup.
- OPA HTTP evaluator is a best-effort timeout-and-deny pattern; extending it with decision caching and a circuit breaker is a natural next step.
- No CI pipeline is shipped with the repo. `bun test` + `npx tsc --noEmit` + `next build` is the canonical verification sequence.

## Impact summary

For resume / one-line pitches:

> **Architected an AP-consistent, edge-native semantic memory controller** with sub-millisecond synchronous local retrieval, a two-tier semantic LRU that evicts by `Recency × Importance / (1 + Density)`, and a BullMQ write-behind pipeline to a central pgvector instance.

> **Shipped a zero-knowledge-ready security layer** with pluggable embedding encryption, Open Policy Agent capability authorization, token-bucket 503 back-pressure, filesystem confinement, and mTLS 1.3 pinning — verified end-to-end in the Hono app.

> **Built a high-concurrency 3D operator HUD** in Next.js 15 + Tailwind v4, rendering several thousand 384-dim embeddings at 60fps via a custom Three.js additive-blend shader. Added raycasted hover/click picking, drag-to-rotate orbit gesture, a four-key keyboard shortcut layer (`/`, `⌘K`, `i`, `r`, `Esc` with cascading deselect), and a sparkline with hover read-out — converting a static visualization into an operator-grade tool.

> **143 tests across 18 spec files**, bisectable commit chain, `tsc --noEmit` clean on both the backend and `web/`, `next build` producing a 121 KB first-load JS page (13.1 KB main route).

---

*Repository:* <https://github.com/lucastimho/sentient-cache>
