import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'x')),
  token TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id),
  external_post_id TEXT NOT NULL,
  UNIQUE (connection_id, external_post_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id),
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  last_error TEXT,
  CHECK (window_from < window_to),
  CHECK ((status = 'running') = (finished_at IS NULL)),
  CHECK ((status = 'failed') = (error_code IS NOT NULL AND last_error IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  post_id INTEGER NOT NULL REFERENCES posts(id),
  captured_at TEXT NOT NULL,
  views INTEGER NOT NULL CHECK (views >= 0),
  likes INTEGER NOT NULL CHECK (likes >= 0),
  comments INTEGER NOT NULL CHECK (comments >= 0),
  shares INTEGER NOT NULL CHECK (shares >= 0),
  fetched_at TEXT NOT NULL,
  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),
  PRIMARY KEY (post_id, captured_at)
);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
