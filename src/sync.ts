import type { DatabaseSync } from "node:sqlite";
import { saveSnapshots } from "./metrics.ts";
import { ProviderError } from "./provider.ts";
import type { Credentials, FetchRequest, MetricsProvider, Page } from "./provider.ts";
import { decide } from "./retry.ts";
import type { RetryPolicy } from "./retry.ts";

export type Connection = Credentials & { id: string };
export type SyncContext = {
  db: DatabaseSync;
  provider: MetricsProvider;
  policy: RetryPolicy;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

class SyncStopped extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

// Uma página, com retentativa. A cada falha tipada, decide() diz quanto esperar ou que parou.
async function fetchPage(ctx: SyncContext, conn: Connection, request: FetchRequest, calls: { n: number }): Promise<Page> {
  for (let attempt = 1; ; attempt++) {
    calls.n++;
    try {
      return await ctx.provider.fetchPage(conn, request);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      const decision = decide(err, attempt, ctx.policy);
      if (decision.stop) throw new SyncStopped(decision.code, decision.message);
      await ctx.sleep(decision.waitMs);
    }
  }
}

// Páginas já gravadas ficam gravadas se uma seguinte falhar. Gravar é idempotente, então
// a próxima sincronização refaz o trecho sem duplicar.
export async function runSync(ctx: SyncContext, conn: Connection, from: string, to: string, runId: string) {
  const { db } = ctx;
  db.prepare(
    "INSERT INTO sync_runs (id, connection_id, window_from, window_to, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')",
  ).run(runId, conn.id, from, to, ctx.now().toISOString());
  const calls = { n: 0 };
  const finish = db.prepare(
    "UPDATE sync_runs SET status = ?, finished_at = ?, attempts = ?, error_code = ?, last_error = ? WHERE id = ?",
  );
  try {
    let cursor: string | undefined;
    do {
      const page = await fetchPage(ctx, conn, { from, to, cursor }, calls);
      saveSnapshots(db, conn.id, runId, page.items, ctx.now().toISOString());
      cursor = page.nextCursor;
    } while (cursor);
    finish.run("succeeded", ctx.now().toISOString(), calls.n, null, null, runId);
  } catch (err) {
    const stop = err instanceof SyncStopped ? err : new SyncStopped("internal_error", "Erro interno.");
    finish.run("failed", ctx.now().toISOString(), calls.n, stop.code, stop.message, runId);
    if (!(err instanceof SyncStopped)) throw err;
  }
  return { ...db.prepare("SELECT * FROM sync_runs WHERE id = ?").get(runId)! };
}
