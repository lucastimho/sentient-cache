import IORedis from "ioredis";
import { SemanticCache } from "./cache/SemanticCache";
import { PostgresRemoteStore } from "./sync/RemoteStore";
import { SyncWorker } from "./sync/SyncWorker";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const DB_PATH = process.env.CACHE_DB_PATH ?? "./sentient-cache.sqlite";
const REDIS_URL = requireEnv("REDIS_URL");
const PG_URL = requireEnv("DATABASE_URL");

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const cache = new SemanticCache({ path: DB_PATH });
const remote = new PostgresRemoteStore({ pool: { connectionString: PG_URL } });

const worker = new SyncWorker({ cache, remote, connection });

worker.on("failed", (...args) => console.error("[sync-worker] failed", args));
worker.on("error", (...args) => console.error("[sync-worker] error", args));

const shutdown = async () => {
  await worker.close();
  await cache.close();
  await connection.quit();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[sync-worker] listening; db=${DB_PATH}`);
