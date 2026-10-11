import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { page, scripted, snap } from "../src/fake-provider.ts";
import type { Step } from "../src/fake-provider.ts";
import { seed } from "../src/seed.ts";

const T0 = "2026-10-10T12:00:00.000Z";
const POLICY = { maxAttempts: 3, maxRetryAfterMs: 60_000, backoffMs: [500, 1000] };
const JANELA = { from: "2026-10-01T00:00:00Z", to: "2026-10-10T00:00:00Z" };

// O sleep injetado avança o relógio controlado: a espera vira tempo medido, sem esperar de verdade.
function setup(steps: Step[]) {
  let current = new Date(T0);
  const sleeps: number[] = [];
  const provider = scripted(steps);
  const db = openDatabase(":memory:");
  seed(db);
  const app = createApp(db, {
    provider,
    policy: POLICY,
    now: () => current,
    sleep: async (ms) => {
      sleeps.push(ms);
      current = new Date(current.getTime() + ms);
    },
  });
  return { app, provider, sleeps, db, advance: (ms: number) => (current = new Date(current.getTime() + ms)) };
}
type App = ReturnType<typeof setup>["app"];

const IG = "con_ana_instagram";
const TT = "con_ana_tiktok";

const post = (app: App, path: string, body?: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function sync(app: App, id = IG, janela: { from: string; to: string } = JANELA) {
  const res = await post(app, `/connections/${id}/sync`, janela);
  return { status: res.status, run: await res.json() };
}
const posts = async (app: App, id = IG) => (await (await app.request(`/connections/${id}/posts`)).json()).posts;
const totals = async (app: App) => (await app.request("/creators/crt_ana/totals")).json();

describe("idempotência", () => {
  it("ignora o mesmo snapshot repetido na mesma resposta", async () => {
    const s = snap("p1", "2026-10-02T10:00:00Z", 100, 7);
    const { app } = setup([page([s, s])]);
    const { run } = await sync(app);
    expect(run.status).toBe("succeeded");
    expect(await totals(app)).toMatchObject({ posts: 1, views: 100, likes: 7 });
    expect((await posts(app))[0].snapshots).toBe(1);
  });

  it("não conta o post de novo quando a janela seguinte reencontra o mesmo snapshot", async () => {
    const s = snap("p1", "2026-10-02T10:00:00Z", 100);
    const { app } = setup([page([s]), page([s])]);
    await sync(app, IG, { from: "2026-10-01T00:00:00Z", to: "2026-10-05T00:00:00Z" });
    await sync(app, IG, { from: "2026-10-02T00:00:00Z", to: "2026-10-08T00:00:00Z" });
    expect(await totals(app)).toMatchObject({ posts: 1, views: 100 });
    expect((await posts(app))[0].snapshots).toBe(1);
  });

  it("usa o snapshot mais recente como total, sem somar os acumulados", async () => {
    const { app } = setup([
      page([snap("p1", "2026-10-02T10:00:00Z", 100)]),
      page([snap("p1", "2026-10-02T10:00:00Z", 100), snap("p1", "2026-10-04T10:00:00Z", 160)]),
    ]);
    await sync(app, IG, { from: "2026-10-01T00:00:00Z", to: "2026-10-03T00:00:00Z" });
    await sync(app, IG, { from: "2026-10-02T00:00:00Z", to: "2026-10-06T00:00:00Z" });
    expect(await totals(app)).toMatchObject({ posts: 1, views: 160 });
    expect((await posts(app))[0]).toMatchObject({ views: 160, snapshots: 2, captured_at: "2026-10-04T10:00:00.000Z" });
  });

  it("não deixa um snapshot antigo que chega depois derrubar o total", async () => {
    const { app } = setup([
      page([snap("p1", "2026-10-04T10:00:00Z", 160)]),
      page([snap("p1", "2026-10-02T10:00:00Z", 100)]),
    ]);
    await sync(app);
    await sync(app);
    expect(await totals(app)).toMatchObject({ views: 160 });
  });

  it("duas sincronizações simultâneas com janelas sobrepostas contam o post uma vez", async () => {
    const s = snap("p1", "2026-10-03T10:00:00Z", 100);
    const { app } = setup([page([s]), page([s])]);
    const [a, b] = await Promise.all([
      sync(app, IG, { from: "2026-10-01T00:00:00Z", to: "2026-10-05T00:00:00Z" }),
      sync(app, IG, { from: "2026-10-02T00:00:00Z", to: "2026-10-06T00:00:00Z" }),
    ]);
    expect([a.run.status, b.run.status]).toEqual(["succeeded", "succeeded"]);
    expect(await totals(app)).toMatchObject({ posts: 1, views: 100 });
  });

  it("soma o último snapshot de cada post, entre plataformas do mesmo criador", async () => {
    const { app } = setup([
      page([snap("p1", "2026-10-02T10:00:00Z", 100), snap("p2", "2026-10-02T10:00:00Z", 50)]),
      page([snap("p1", "2026-10-02T10:00:00Z", 30)]),
    ]);
    await sync(app, IG);
    await sync(app, TT);
    expect(await totals(app)).toMatchObject({ posts: 3, views: 180 });
  });

  it("busca a página seguinte pelo cursor", async () => {
    const { app, provider } = setup([
      page([snap("p1", "2026-10-02T10:00:00Z", 100)], "c2"),
      page([snap("p2", "2026-10-02T10:00:00Z", 40)]),
    ]);
    const { run } = await sync(app);
    expect(run).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(provider.calls.map((c) => c.request.cursor)).toEqual([undefined, "c2"]);
    expect(await totals(app)).toMatchObject({ posts: 2, views: 140 });
  });
});

describe("falha transitória", () => {
  it("tenta de novo depois de timeout, com backoff, e termina", async () => {
    const { app, sleeps } = setup([
      "timeout",
      { status: 503 },
      page([snap("p1", "2026-10-02T10:00:00Z", 100)]),
    ]);
    const { status, run } = await sync(app);
    expect(status).toBe(201);
    expect(run).toMatchObject({ status: "succeeded", attempts: 3, error_code: null });
    expect(sleeps).toEqual([500, 1000]);
    expect(await totals(app)).toMatchObject({ views: 100 });
  });

  it("para no teto de tentativas quando o provedor sempre dá timeout", async () => {
    const { app, provider, sleeps } = setup(["timeout", "timeout", "timeout"]);
    const { run } = await sync(app);
    expect(run).toMatchObject({ status: "failed", attempts: 3, error_code: "attempts_exhausted" });
    expect(run.last_error).toBe("O provedor falhou 3 vezes seguidas: o provedor não respondeu a tempo.");
    expect(provider.calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("para no teto de tentativas quando o provedor sempre dá 5xx", async () => {
    const { app, provider } = setup([{ status: 500 }, { status: 502 }, { status: 503 }]);
    const { run } = await sync(app);
    expect(run).toMatchObject({ status: "failed", attempts: 3, error_code: "attempts_exhausted" });
    expect(provider.calls).toHaveLength(3);
  });

  it("não busca de novo a página que já deu certo ao tentar a seguinte", async () => {
    const { app, provider } = setup([
      page([snap("p1", "2026-10-02T10:00:00Z", 100)], "c2"),
      "timeout",
      page([snap("p2", "2026-10-02T10:00:00Z", 40)]),
    ]);
    const { run } = await sync(app);
    expect(run).toMatchObject({ status: "succeeded", attempts: 3 });
    expect(provider.calls.map((c) => c.request.cursor)).toEqual([undefined, "c2", "c2"]);
  });

  it("guarda o que veio antes da falha e a próxima sincronização completa sem duplicar", async () => {
    const p1 = snap("p1", "2026-10-02T10:00:00Z", 100);
    const { app } = setup([
      page([p1], "c2"),
      "timeout",
      "timeout",
      "timeout",
      page([p1], "c2"),
      page([snap("p2", "2026-10-02T10:00:00Z", 40)]),
    ]);
    expect((await sync(app)).run.status).toBe("failed");
    expect(await totals(app)).toMatchObject({ posts: 1, views: 100 });
    expect((await sync(app)).run.status).toBe("succeeded");
    expect(await totals(app)).toMatchObject({ posts: 2, views: 140 });
  });
});

describe("limite de taxa (429)", () => {
  it("espera exatamente o Retry-After e registra o instante da busca depois da espera", async () => {
    const { app, sleeps, provider } = setup([
      { status: 429, headers: { "retry-after": "30" } },
      page([snap("p1", "2026-10-02T10:00:00Z", 100)]),
    ]);
    const { run } = await sync(app);
    expect(sleeps).toEqual([30_000]);
    expect(provider.calls).toHaveLength(2);
    expect(run).toMatchObject({
      status: "succeeded",
      attempts: 2,
      started_at: "2026-10-10T12:00:00.000Z",
      finished_at: "2026-10-10T12:00:30.000Z",
    });
    expect((await posts(app))[0].fetched_at).toBe("2026-10-10T12:00:30.000Z");
  });

  it("aceita Retry-After igual ao teto", async () => {
    const { app, sleeps } = setup([
      { status: 429, headers: { "retry-after": "60" } },
      page([snap("p1", "2026-10-02T10:00:00Z", 100)]),
    ]);
    expect((await sync(app)).run.status).toBe("succeeded");
    expect(sleeps).toEqual([60_000]);
  });

  it("não espera menos nem tenta de novo quando o Retry-After passa do teto", async () => {
    const { app, sleeps, provider } = setup([{ status: 429, headers: { "retry-after": "61" } }]);
    const { run } = await sync(app);
    expect(run).toMatchObject({ status: "failed", attempts: 1, error_code: "retry_after_exceeds_cap" });
    expect(run.last_error).toBe("O provedor pediu 61000 ms de espera e o teto é 60000 ms.");
    expect(sleeps).toEqual([]);
    expect(provider.calls).toHaveLength(1);
  });

  it("respeita o teto de tentativas mesmo com 429 repetido", async () => {
    const r429: Step = { status: 429, headers: { "retry-after": "10" } };
    const { app, sleeps, provider } = setup([r429, r429, r429]);
    const { run } = await sync(app);
    expect(run).toMatchObject({ status: "failed", attempts: 3, error_code: "attempts_exhausted" });
    expect(sleeps).toEqual([10_000, 10_000]);
    expect(provider.calls).toHaveLength(3);
  });

  it("usa o backoff quando o 429 vem sem Retry-After", async () => {
    const { app, sleeps } = setup([{ status: 429 }, page([snap("p1", "2026-10-02T10:00:00Z", 100)])]);
    expect((await sync(app)).run.status).toBe("succeeded");
    expect(sleeps).toEqual([500]);
  });
});

describe("quando a métrica foi buscada", () => {
  it("separa captured_at do provedor de fetched_at do serviço e lista as execuções", async () => {
    const { app, advance } = setup([
      page([snap("p1", "2026-10-02T10:00:00Z", 100)]),
      page([snap("p1", "2026-10-02T10:00:00Z", 100)]),
    ]);
    await sync(app);
    advance(3_600_000);
    await sync(app);
    expect((await posts(app))[0]).toMatchObject({
      captured_at: "2026-10-02T10:00:00.000Z",
      fetched_at: "2026-10-10T12:00:00.000Z",
    });
    const { sync_runs } = await (await app.request(`/connections/${IG}/sync-runs`)).json();
    expect(sync_runs.map((r: { started_at: string; window_from: string }) => [r.started_at, r.window_from])).toEqual([
      ["2026-10-10T12:00:00.000Z", "2026-10-01T00:00:00.000Z"],
      ["2026-10-10T13:00:00.000Z", "2026-10-01T00:00:00.000Z"],
    ]);
    expect((await totals(app)).last_fetched_at).toBe("2026-10-10T12:00:00.000Z");
  });
});

describe("validação na borda", () => {
  it("cria conexão sem devolver o token", async () => {
    const { app } = setup([]);
    const res = await post(app, "/connections", { creator_id: "crt_bruno", platform: "youtube", token: "segredo" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: expect.stringMatching(/^con_/), creator_id: "crt_bruno", platform: "youtube" });
  });

  it("recusa plataforma desconhecida", async () => {
    const { app } = setup([]);
    const res = await post(app, "/connections", { creator_id: "crt_bruno", platform: "orkut", token: "t" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "A plataforma deve ser uma de: instagram, tiktok, youtube, x.",
      code: "platform_invalid",
    });
  });

  it("recusa janela sem from, com data inválida ou invertida", async () => {
    const { app } = setup([]);
    const codes = [];
    for (const body of [{ to: JANELA.to }, { from: "ontem", to: JANELA.to }, { from: JANELA.to, to: JANELA.from }]) {
      const res = await post(app, `/connections/${IG}/sync`, body);
      expect(res.status).toBe(422);
      codes.push((await res.json()).code);
    }
    expect(codes).toEqual(["from_required", "from_invalid", "window_invalid"]);
  });

  it("responde 404 para conexão inexistente", async () => {
    const { app } = setup([]);
    const res = await post(app, "/connections/con_nada/sync", JANELA);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Conexão não encontrada.", code: "connection_not_found" });
  });
});
