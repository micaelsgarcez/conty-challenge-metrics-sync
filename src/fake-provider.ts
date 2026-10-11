import { errorFromHttp, ProviderTimeout } from "./provider.ts";
import type { Credentials, FetchRequest, MetricsProvider, Page, SnapshotItem } from "./provider.ts";

// O que o provedor falso "devolve" numa chamada: HTTP cru ou timeout.
export type Step = "timeout" | { status: 200; body: Page } | { status: number; headers?: Record<string, string> };
export type Call = { n: number; credentials: Credentials; request: FetchRequest };

export class FakeProvider implements MetricsProvider {
  readonly calls: Call[] = [];

  constructor(private respond: (call: Call) => Step) {}

  async fetchPage(credentials: Credentials, request: FetchRequest): Promise<Page> {
    const call = { n: this.calls.length + 1, credentials, request };
    this.calls.push(call);
    const step = this.respond(call);
    if (step === "timeout") throw new ProviderTimeout("o provedor não respondeu a tempo");
    if (step.status === 200) return (step as { body: Page }).body;
    throw errorFromHttp(step.status, (step as { headers?: Record<string, string> }).headers);
  }
}

// Fila de respostas: cada chamada consome uma. Chamar além do roteiro derruba o teste.
export function scripted(steps: Step[]): FakeProvider {
  const queue = [...steps];
  return new FakeProvider((call) => {
    const step = queue.shift();
    if (!step) throw new Error(`chamada ${call.n} além do roteiro do provedor falso`);
    return step;
  });
}

export function page(items: SnapshotItem[], nextCursor?: string): Step {
  return { status: 200, body: nextCursor ? { items, nextCursor } : { items } };
}

export function snap(id: string, captured_at: string, views: number, likes = 0): SnapshotItem {
  return { external_post_id: id, captured_at, views, likes, comments: 0, shares: 0 };
}

// Provedor da demo (npm start). O token escolhe o cenário, para mostrar as falhas pela API.
const CAPTURES = ["2026-10-01T12:00:00.000Z", "2026-10-03T12:00:00.000Z"];

export function demoProvider(): FakeProvider {
  const seen = new Map<string, number>();
  return new FakeProvider(({ credentials, request }) => {
    const n = (seen.get(credentials.token) ?? 0) + 1;
    seen.set(credentials.token, n);
    if (credentials.token === "tok_429" && n === 1) return { status: 429, headers: { "retry-after": "2" } };
    if (credentials.token === "tok_429_longo") return { status: 429, headers: { "retry-after": "120" } };
    if (credentials.token === "tok_503") return { status: 503 };
    if (credentials.token === "tok_timeout") return "timeout";
    const items = ["post_1", "post_2"].flatMap((post, i) =>
      CAPTURES.map((at, k) => snap(`${credentials.platform}_${post}`, at, (i + 1) * 1000 * (k + 1), 10 * (k + 1))),
    );
    return page(items.filter((s) => s.captured_at >= request.from && s.captured_at < request.to));
  });
}
