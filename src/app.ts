import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { Context } from "hono";
import { creatorTotals, listPosts } from "./metrics.ts";
import { PLATFORMS } from "./provider.ts";
import type { MetricsProvider, Platform } from "./provider.ts";
import { DEFAULT_POLICY } from "./retry.ts";
import type { RetryPolicy } from "./retry.ts";
import { runSync } from "./sync.ts";
import type { Connection } from "./sync.ts";

type Body = Record<string, unknown>;
type Deps = {
  provider: MetricsProvider;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  policy?: RetryPolicy;
};

class ApiError extends Error {
  constructor(readonly status: 404 | 422, readonly code: string, message: string) {
    super(message);
  }
}

async function readBody(c: Context): Promise<Body> {
  const body: unknown = await c.req.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(422, "invalid_body", "O corpo deve ser um objeto JSON válido.");
  }
  return body as Body;
}

function text(body: Body, field: string, code: string, message: string): string {
  const value = body[field];
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new ApiError(422, code, message);
}

function instant(body: Body, field: "from" | "to"): string {
  const value = text(body, field, `${field}_required`, `O campo ${field} é obrigatório.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(422, `${field}_invalid`, `O campo ${field} deve ser um instante ISO 8601.`);
  }
  return date.toISOString();
}

export function createApp(db: DatabaseSync, deps: Deps) {
  const { provider, now = () => new Date(), policy = DEFAULT_POLICY } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.message, code: err.code }, err.status);
    console.error(err);
    return c.json({ error: "Erro interno.", code: "internal_error" }, 500);
  });

  const findConnection = (id: string) => {
    const conn = db.prepare("SELECT * FROM connections WHERE id = ?").get(id);
    if (!conn) throw new ApiError(404, "connection_not_found", "Conexão não encontrada.");
    return conn as unknown as Connection & { creator_id: string };
  };
  // O token fica no banco e nunca volta numa resposta.
  const publicConnection = ({ id, creator_id, platform }: Connection & { creator_id: string }) => ({ id, creator_id, platform });

  app.post("/connections", async (c) => {
    const body = await readBody(c);
    const creatorId = text(body, "creator_id", "creator_id_required", "O criador é obrigatório.");
    const platform = body.platform;
    if (!PLATFORMS.includes(platform as Platform)) {
      throw new ApiError(422, "platform_invalid", `A plataforma deve ser uma de: ${PLATFORMS.join(", ")}.`);
    }
    const token = text(body, "token", "token_required", "O token é obrigatório.");
    const id = `con_${randomUUID()}`;
    db.prepare("INSERT INTO connections VALUES (?, ?, ?, ?, ?)").run(id, creatorId, platform as string, token, now().toISOString());
    return c.json(publicConnection(findConnection(id)), 201);
  });

  app.post("/connections/:id/sync", async (c) => {
    const body = await readBody(c);
    const from = instant(body, "from");
    const to = instant(body, "to");
    if (from >= to) throw new ApiError(422, "window_invalid", "A janela precisa ter from antes de to.");
    const conn = findConnection(c.req.param("id"));
    const run = await runSync({ db, provider, now, sleep, policy }, conn, from, to, `run_${randomUUID()}`);
    return c.json(run, 201);
  });

  app.get("/connections/:id/sync-runs", (c) => {
    const conn = findConnection(c.req.param("id"));
    const runs = db.prepare("SELECT * FROM sync_runs WHERE connection_id = ? ORDER BY started_at, id").all(conn.id);
    return c.json({ sync_runs: runs.map((r) => ({ ...r })) });
  });

  app.get("/connections/:id/posts", (c) => c.json({ posts: listPosts(db, findConnection(c.req.param("id")).id) }));

  app.get("/creators/:id/totals", (c) => c.json(creatorTotals(db, c.req.param("id"))));

  return app;
}
