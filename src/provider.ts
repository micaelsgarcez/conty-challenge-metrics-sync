export const PLATFORMS = ["instagram", "tiktok", "youtube", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];

// Contadores acumulados do post no instante captured_at, como o provedor os informa.
export type SnapshotItem = {
  external_post_id: string;
  captured_at: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
};

export type Page = { items: SnapshotItem[]; nextCursor?: string };
export type FetchRequest = { from: string; to: string; cursor?: string };
export type Credentials = { platform: Platform; token: string };

export interface MetricsProvider {
  fetchPage(credentials: Credentials, request: FetchRequest): Promise<Page>;
}

// Os únicos erros que o sync conhece. Nada de status HTTP ou formato de provedor passa daqui.
export class ProviderError extends Error {}
export class ProviderTimeout extends ProviderError {}
export class ProviderTransient extends ProviderError {}
export class ProviderRateLimited extends ProviderError {
  constructor(readonly retryAfterMs?: number) {
    super("rate limited");
  }
}

// Tradução da resposta HTTP do provedor para erro tipado. Retry-After em segundos.
export function errorFromHttp(status: number, headers: Record<string, string> = {}): ProviderError {
  if (status === 429) {
    const seconds = Number(headers["retry-after"]);
    return new ProviderRateLimited(Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined);
  }
  return new ProviderTransient(`provedor respondeu ${status}`);
}
