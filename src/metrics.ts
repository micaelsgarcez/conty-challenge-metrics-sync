import type { DatabaseSync } from "node:sqlite";
import type { SnapshotItem } from "./provider.ts";

const COUNTERS = ["views", "likes", "comments", "shares"] as const;

// Reenvio do mesmo snapshot (post + captured_at) não muda nada: o primeiro registro vence.
export function saveSnapshots(db: DatabaseSync, connectionId: string, runId: string, items: SnapshotItem[], fetchedAt: string) {
  const post = db.prepare("INSERT INTO posts (connection_id, external_post_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
  const find = db.prepare("SELECT id FROM posts WHERE connection_id = ? AND external_post_id = ?");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO metric_snapshots (post_id, captured_at, views, likes, comments, shares, fetched_at, sync_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  db.exec("BEGIN");
  try {
    for (const item of items) {
      post.run(connectionId, item.external_post_id);
      const { id } = find.get(connectionId, item.external_post_id) as { id: number };
      const capturedAt = new Date(item.captured_at).toISOString();
      insert.run(id, capturedAt, item.views, item.likes, item.comments, item.shares, fetchedAt, runId);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Contador acumulado: o total do post é o snapshot de maior captured_at, nunca a soma dos snapshots.
const LATEST = "s.captured_at = (SELECT MAX(captured_at) FROM metric_snapshots WHERE post_id = p.id)";

export function listPosts(db: DatabaseSync, connectionId: string) {
  return db
    .prepare(
      `SELECT p.external_post_id, s.views, s.likes, s.comments, s.shares, s.captured_at, s.fetched_at,
              (SELECT COUNT(*) FROM metric_snapshots WHERE post_id = p.id) AS snapshots
       FROM posts p JOIN metric_snapshots s ON s.post_id = p.id
       WHERE p.connection_id = ? AND ${LATEST} ORDER BY p.external_post_id`,
    )
    .all(connectionId)
    .map((row) => ({ ...row }));
}

export function creatorTotals(db: DatabaseSync, creatorId: string) {
  const sums = COUNTERS.map((c) => `COALESCE(SUM(s.${c}), 0) AS ${c}`).join(", ");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS posts, ${sums}, MAX(s.fetched_at) AS last_fetched_at
       FROM connections c JOIN posts p ON p.connection_id = c.id JOIN metric_snapshots s ON s.post_id = p.id
       WHERE c.creator_id = ? AND ${LATEST}`,
    )
    .get(creatorId)!;
  return { creator_id: creatorId, ...row };
}
