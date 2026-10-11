import type { DatabaseSync } from "node:sqlite";

// O token escolhe o cenário do provedor da demo (veja demoProvider).
const CONNECTIONS = [
  ["con_ana_instagram", "crt_ana", "instagram", "tok_ok"],
  ["con_ana_tiktok", "crt_ana", "tiktok", "tok_429"],
  ["con_ana_youtube", "crt_ana", "youtube", "tok_429_longo"],
  ["con_ana_x", "crt_ana", "x", "tok_503"],
];

export function seed(db: DatabaseSync) {
  const stmt = db.prepare("INSERT OR IGNORE INTO connections VALUES (?, ?, ?, ?, '2026-10-01T00:00:00.000Z')");
  for (const c of CONNECTIONS) stmt.run(...c);
}
