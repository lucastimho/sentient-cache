import { Pool, type PoolConfig } from "pg";
import type { Memory, Partition, RemoteStore } from "../types";
import { loadMtls, toPgSsl, type MtlsPaths } from "../security/mtls";
import type { PathGuard } from "../security/PathGuard";

export interface PostgresRemoteStoreOptions {
  pool: Pool | PoolConfig;
  table?: string;
  mtls?: MtlsPaths;
  mtlsServername?: string;
  pathGuard?: PathGuard;
}

interface RemoteRow {
  id: string;
  content: string;
  embedding: string | number[];
  created_at: string | Date;
  last_accessed_at: string | Date;
  access_count: number;
  size_bytes: number;
  partition: Partition;
  importance: number;
}

function parsePgVector(v: string | number[]): Float32Array {
  if (Array.isArray(v)) return Float32Array.from(v);
  const trimmed = v.replace(/^\[|\]$/g, "");
  if (trimmed.length === 0) return new Float32Array();
  return Float32Array.from(trimmed.split(",").map(Number));
}

function formatPgVector(v: Float32Array): string {
  return `[${Array.from(v).join(",")}]`;
}

function rowToMemory(r: RemoteRow): Memory {
  return {
    id: r.id,
    content: r.content,
    embedding: parsePgVector(r.embedding),
    createdAt: new Date(r.created_at).getTime(),
    lastAccessedAt: new Date(r.last_accessed_at).getTime(),
    accessCount: r.access_count,
    sizeBytes: r.size_bytes,
    partition: r.partition,
    importance: r.importance,
  };
}

export class PostgresRemoteStore implements RemoteStore {
  private readonly pool: Pool;
  private readonly table: string;

  constructor(opts: PostgresRemoteStoreOptions) {
    if (opts.pool instanceof Pool) {
      this.pool = opts.pool;
    } else {
      const poolConfig: PoolConfig = { ...opts.pool };
      if (opts.mtls) {
        const material = loadMtls({
          paths: opts.mtls,
          servername: opts.mtlsServername,
          pathGuard: opts.pathGuard,
        });
        poolConfig.ssl = toPgSsl(material);
      }
      this.pool = new Pool(poolConfig);
    }
    this.table = opts.table ?? "memories";
  }

  async fetchTopK(embedding: Float32Array, k: number): Promise<Memory[]> {
    const sql = `
      SELECT id, content, embedding::text AS embedding,
             created_at, last_accessed_at, access_count, size_bytes, partition, importance
      FROM ${this.table}
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;
    const res = await this.pool.query<RemoteRow>(sql, [formatPgVector(embedding), k]);
    return res.rows.map(rowToMemory);
  }

  async writeBatch(memories: Memory[]): Promise<void> {
    if (memories.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sql = `
        INSERT INTO ${this.table}
          (id, content, embedding, created_at, last_accessed_at, access_count, size_bytes, partition, importance)
        VALUES ($1, $2, $3::vector, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0), $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          last_accessed_at = EXCLUDED.last_accessed_at,
          access_count = GREATEST(${this.table}.access_count, EXCLUDED.access_count),
          size_bytes = EXCLUDED.size_bytes,
          partition = EXCLUDED.partition,
          importance = EXCLUDED.importance
      `;
      for (const m of memories) {
        await client.query(sql, [
          m.id,
          m.content,
          formatPgVector(m.embedding),
          m.createdAt,
          m.lastAccessedAt,
          m.accessCount,
          m.sizeBytes,
          m.partition,
          m.importance,
        ]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
