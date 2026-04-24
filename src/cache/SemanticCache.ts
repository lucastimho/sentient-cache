import { Database, type Statement } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { initSchema } from "../db/schema";
import { cosine, decodeEmbedding, encodeEmbedding } from "./similarity";
import { rankForEviction } from "./eviction";
import type { EmbeddingEncryptor } from "../security/EmbeddingEncryptor";
import type {
  Memory,
  MemoryInput,
  Partition,
  RemoteStore,
  ScoredMemory,
  WriteBehindQueue,
} from "../types";

const DEFAULTS = {
  maxBytes: 50 * 1024 * 1024,
  tier1TargetRatio: 0.85,
  tier1TtlMs: 7 * 24 * 60 * 60 * 1000,
  tier1PruneBatch: 256,
  tier2IntervalMs: 30_000,
  tier2ScanRows: 512,
  syncPollMs: 2_000,
  syncBatchSize: 64,
  refreshAheadK: 5,
  searchScanRows: 4_096,
};

export interface SemanticCacheOptions {
  path?: string;
  maxBytes?: number;
  tier2IntervalMs?: number;
  syncPollMs?: number;
  refreshAheadK?: number;
  remote?: RemoteStore;
  queue?: WriteBehindQueue;
  encryptor?: EmbeddingEncryptor;
  onSyncError?: (err: unknown) => void;
}

interface ResolvedOptions {
  path: string;
  maxBytes: number;
  tier1TargetRatio: number;
  tier1TtlMs: number;
  tier1PruneBatch: number;
  tier2IntervalMs: number;
  tier2ScanRows: number;
  syncPollMs: number;
  syncBatchSize: number;
  refreshAheadK: number;
  searchScanRows: number;
  remote?: RemoteStore;
  queue?: WriteBehindQueue;
  encryptor?: EmbeddingEncryptor;
  onSyncError: (err: unknown) => void;
}

interface Row {
  id: string;
  content: string;
  embedding: Uint8Array;
  created_at: number;
  last_accessed_at: number;
  access_count: number;
  size_bytes: number;
  partition: Partition;
  importance: number;
}

function sizeOf(content: string, embedding: Float32Array): number {
  return Buffer.byteLength(content, "utf8") + embedding.byteLength + 64;
}

export class SemanticCache {
  private readonly db: Database;
  private readonly opts: ResolvedOptions;

  private totalBytes = 0;
  private currentGoal: Float32Array | null = null;
  private closed = false;
  private tier2Timer?: ReturnType<typeof setInterval>;
  private syncTimer?: ReturnType<typeof setInterval>;

  private readonly sInsert: Statement;
  private readonly sGet: Statement<Row, [string]>;
  private readonly sTouch: Statement;
  private readonly sTotalSize: Statement<{ total: number }, []>;
  private readonly sDelete: Statement;
  private readonly sTTLEvict: Statement<{ size_bytes: number }, [number, number]>;
  private readonly sLRUScan: Statement<Row, [number]>;
  private readonly sDirtyIds: Statement<{ id: string }, [number]>;
  private readonly sMarkSynced: Statement;
  private readonly sAllForScan: Statement<Row, [number]>;
  private readonly sHas: Statement<{ id: string }, [string]>;

  constructor(opts: SemanticCacheOptions = {}) {
    this.db = new Database(opts.path ?? ":memory:", { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA temp_store = MEMORY;");
    initSchema(this.db);

    this.opts = {
      path: opts.path ?? ":memory:",
      maxBytes: opts.maxBytes ?? DEFAULTS.maxBytes,
      tier1TargetRatio: DEFAULTS.tier1TargetRatio,
      tier1TtlMs: DEFAULTS.tier1TtlMs,
      tier1PruneBatch: DEFAULTS.tier1PruneBatch,
      tier2IntervalMs: opts.tier2IntervalMs ?? DEFAULTS.tier2IntervalMs,
      tier2ScanRows: DEFAULTS.tier2ScanRows,
      syncPollMs: opts.syncPollMs ?? DEFAULTS.syncPollMs,
      syncBatchSize: DEFAULTS.syncBatchSize,
      refreshAheadK: opts.refreshAheadK ?? DEFAULTS.refreshAheadK,
      searchScanRows: DEFAULTS.searchScanRows,
      remote: opts.remote,
      queue: opts.queue,
      encryptor: opts.encryptor,
      onSyncError: opts.onSyncError ?? ((err) => console.error("[sentient-cache] sync error", err)),
    };

    this.sInsert = this.db.prepare(`
      INSERT INTO memories (id, content, embedding, created_at, last_accessed_at, access_count, size_bytes, partition, synced, importance)
      VALUES ($id, $content, $embedding, $now, $now, 0, $size, $partition, 0, $importance)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        embedding = excluded.embedding,
        last_accessed_at = excluded.last_accessed_at,
        size_bytes = excluded.size_bytes,
        importance = excluded.importance,
        synced = 0
    `);
    this.sGet = this.db.prepare<Row, [string]>(`SELECT * FROM memories WHERE id = ?`);
    this.sHas = this.db.prepare<{ id: string }, [string]>(`SELECT id FROM memories WHERE id = ?`);
    this.sTouch = this.db.prepare(
      `UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`,
    );
    this.sTotalSize = this.db.prepare<{ total: number }, []>(
      `SELECT COALESCE(SUM(size_bytes), 0) AS total FROM memories`,
    );
    this.sDelete = this.db.prepare(`DELETE FROM memories WHERE id = ?`);
    this.sTTLEvict = this.db.prepare<{ size_bytes: number }, [number, number]>(`
      DELETE FROM memories WHERE id IN (
        SELECT id FROM memories
        WHERE last_accessed_at < ?
        ORDER BY last_accessed_at ASC, access_count ASC
        LIMIT ?
      )
      RETURNING size_bytes
    `);
    this.sLRUScan = this.db.prepare<Row, [number]>(
      `SELECT * FROM memories ORDER BY last_accessed_at ASC, access_count ASC LIMIT ?`,
    );
    this.sDirtyIds = this.db.prepare<{ id: string }, [number]>(
      `SELECT id FROM memories WHERE synced = 0 ORDER BY last_accessed_at ASC LIMIT ?`,
    );
    this.sMarkSynced = this.db.prepare(`UPDATE memories SET synced = 1 WHERE id = ?`);
    this.sAllForScan = this.db.prepare<Row, [number]>(
      `SELECT * FROM memories ORDER BY last_accessed_at ASC LIMIT ?`,
    );

    const t = this.sTotalSize.get();
    this.totalBytes = t?.total ?? 0;

    if (this.opts.queue) this.startSyncLoop();
    this.startTier2Loop();
  }

  private encodeVec(e: Float32Array): Uint8Array {
    return this.opts.encryptor ? this.opts.encryptor.encrypt(e) : encodeEmbedding(e);
  }

  private decodeVec(b: Uint8Array): Float32Array {
    return this.opts.encryptor ? this.opts.encryptor.decrypt(b) : decodeEmbedding(b);
  }

  private rowToMemoryDecrypted(r: Row): Memory {
    return {
      id: r.id,
      content: r.content,
      embedding: this.decodeVec(r.embedding),
      createdAt: r.created_at,
      lastAccessedAt: r.last_accessed_at,
      accessCount: r.access_count,
      sizeBytes: r.size_bytes,
      partition: r.partition,
      importance: r.importance,
    };
  }

  set(input: MemoryInput): Memory {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const partition: Partition = input.partition ?? "working";
    const size = sizeOf(input.content, input.embedding);

    const existing = this.sHas.get(id);
    const prevSize = existing ? (this.sGet.get(id)?.size_bytes ?? 0) : 0;

    const importance = input.importance ?? 1.0;
    this.sInsert.run({
      $id: id,
      $content: input.content,
      $embedding: this.encodeVec(input.embedding),
      $now: now,
      $size: size,
      $partition: partition,
      $importance: importance,
    });

    this.totalBytes += size - prevSize;

    if (this.totalBytes > this.opts.maxBytes) this.tier1Prune(now);

    return {
      id,
      content: input.content,
      embedding: input.embedding,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      sizeBytes: size,
      partition,
      importance,
    };
  }

  get(id: string): Memory | null {
    const row = this.sGet.get(id);
    if (!row) return null;
    this.sTouch.run(Date.now(), id);
    return this.rowToMemoryDecrypted(row);
  }

  search(embedding: Float32Array, k = 10): ScoredMemory[] {
    const rows = this.sAllForScan.all(this.opts.searchScanRows);
    const scored: ScoredMemory[] = [];
    for (const r of rows) {
      const mem = this.rowToMemoryDecrypted(r);
      scored.push({ memory: mem, similarity: cosine(mem.embedding, embedding) });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  }

  setGoal(embedding: Float32Array): void {
    this.currentGoal = embedding;
    if (this.opts.remote) {
      void this.refreshAhead(embedding).catch(this.opts.onSyncError);
    }
  }

  get goal(): Float32Array | null {
    return this.currentGoal;
  }

  size(): number {
    return this.totalBytes;
  }

  count(): number {
    const row = this.db.prepare<{ n: number }, []>(`SELECT COUNT(*) AS n FROM memories`).get();
    return row?.n ?? 0;
  }

  list(limit = 1024): Memory[] {
    return this.sAllForScan.all(limit).map((r) => this.rowToMemoryDecrypted(r));
  }

  delete(id: string): boolean {
    const existing = this.sGet.get(id);
    if (!existing) return false;
    this.sDelete.run(id);
    this.totalBytes -= existing.size_bytes;
    return true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.tier2Timer) clearInterval(this.tier2Timer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.opts.queue) await this.opts.queue.close().catch(this.opts.onSyncError);
    this.db.close();
  }

  private tier1Prune(now: number): void {
    const target = this.opts.maxBytes * this.opts.tier1TargetRatio;
    const ttlCutoff = now - this.opts.tier1TtlMs;
    const batch = this.opts.tier1PruneBatch;

    const ttlFreed = this.sTTLEvict.all(ttlCutoff, batch);
    for (const row of ttlFreed) this.totalBytes -= row.size_bytes;

    if (this.totalBytes <= target) return;

    const candidates = this.sLRUScan.all(batch);
    for (const row of candidates) {
      if (this.totalBytes <= target) break;
      this.sDelete.run(row.id);
      this.totalBytes -= row.size_bytes;
    }
  }

  compact(): void {
    this.tier2Compress();
  }

  private tier2Compress(): void {
    if (this.totalBytes <= this.opts.maxBytes * this.opts.tier1TargetRatio) return;
    const rows = this.sAllForScan.all(this.opts.tier2ScanRows).map((r) => this.rowToMemoryDecrypted(r));
    if (rows.length === 0) return;

    const ranked = rankForEviction(rows, this.currentGoal, Date.now());
    const target = this.opts.maxBytes * this.opts.tier1TargetRatio;

    for (const entry of ranked) {
      if (this.totalBytes <= target) break;
      this.sDelete.run(entry.id);
      this.totalBytes -= entry.sizeBytes;
    }
  }

  private startTier2Loop(): void {
    this.tier2Timer = setInterval(() => {
      if (this.closed) return;
      try {
        this.tier2Compress();
      } catch (err) {
        this.opts.onSyncError(err);
      }
    }, this.opts.tier2IntervalMs);
    this.tier2Timer.unref?.();
  }

  private startSyncLoop(): void {
    this.syncTimer = setInterval(() => {
      if (this.closed) return;
      const dirty = this.sDirtyIds.all(this.opts.syncBatchSize);
      if (dirty.length === 0) return;
      const ids = dirty.map((r) => r.id);
      void this.opts.queue!.enqueueBatch(ids).catch(this.opts.onSyncError);
    }, this.opts.syncPollMs);
    this.syncTimer.unref?.();
  }

  readDirtyMemories(ids: string[]): Memory[] {
    const out: Memory[] = [];
    for (const id of ids) {
      const row = this.sGet.get(id);
      if (row) out.push(this.rowToMemoryDecrypted(row));
    }
    return out;
  }

  markSynced(ids: string[]): void {
    const tx = this.db.transaction((xs: string[]) => {
      for (const id of xs) this.sMarkSynced.run(id);
    });
    tx(ids);
  }

  private async refreshAhead(embedding: Float32Array): Promise<void> {
    if (!this.opts.remote) return;
    const remote = await this.opts.remote.fetchTopK(embedding, this.opts.refreshAheadK);
    for (const mem of remote) {
      const exists = this.sHas.get(mem.id);
      if (exists) continue;
      const size = sizeOf(mem.content, mem.embedding);
      this.sInsert.run({
        $id: mem.id,
        $content: mem.content,
        $embedding: this.encodeVec(mem.embedding),
        $now: Date.now(),
        $size: size,
        $partition: mem.partition,
        $importance: mem.importance,
      });
      this.sMarkSynced.run(mem.id);
      this.totalBytes += size;
    }
    if (this.totalBytes > this.opts.maxBytes) this.tier1Prune(Date.now());
  }
}
