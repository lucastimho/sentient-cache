import { SemanticCache } from "../cache/SemanticCache";
import { SemanticController } from "../controller/SemanticController";
import { SessionRegistry } from "../controller/SessionRegistry";
import { HashEmbedder } from "../embeddings/HashEmbedder";
import { createIngestorApp } from "./app";

const DB_PATH = process.env.CACHE_DB_PATH ?? "./sentient-cache.sqlite";
const PORT = Number(process.env.PORT ?? 3000);
const EMBED_DIMS = Number(process.env.EMBED_DIMS ?? 384);
const POLICY_MAX_MB = Number(process.env.POLICY_MAX_MB ?? 100);

const cache = new SemanticCache({
  path: DB_PATH,
  maxBytes: POLICY_MAX_MB * 1024 * 1024 * 1.5,
});
const embedder = new HashEmbedder(EMBED_DIMS);
const controller = new SemanticController({
  cache,
  embedder,
  policyMaxBytes: POLICY_MAX_MB * 1024 * 1024,
});
const registry = new SessionRegistry();

const app = createIngestorApp({ controller, registry });

const shutdown = async () => {
  await controller.close();
  await cache.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[ingestor] listening on :${PORT} (dims=${EMBED_DIMS}, policy=${POLICY_MAX_MB}MB)`);

export default {
  port: PORT,
  fetch: app.fetch,
};
