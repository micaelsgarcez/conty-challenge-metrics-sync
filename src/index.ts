import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { demoProvider } from "./fake-provider.ts";
import { seed } from "./seed.ts";

const dbPath = process.env.DB_PATH ?? "data/metricas.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });
const port = Number(process.env.PORT ?? 3004);

const db = openDatabase(dbPath);
seed(db);

serve({ fetch: createApp(db, { provider: demoProvider() }).fetch, port }, (info) => {
  console.log(`métricas das redes em http://127.0.0.1:${info.port}`);
});
