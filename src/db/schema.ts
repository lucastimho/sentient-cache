import type { Database } from "bun:sqlite";

export function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL,
      partition TEXT NOT NULL DEFAULT 'working',
      synced INTEGER NOT NULL DEFAULT 0,
      importance REAL NOT NULL DEFAULT 1.0
    );
    CREATE INDEX IF NOT EXISTS idx_last_accessed ON memories(last_accessed_at);
    CREATE INDEX IF NOT EXISTS idx_synced ON memories(synced);
    CREATE INDEX IF NOT EXISTS idx_partition ON memories(partition);
    CREATE INDEX IF NOT EXISTS idx_access ON memories(access_count);
  `);
}
