import { ProviderRateLimited } from "./provider.ts";
import type { ProviderError } from "./provider.ts";

export type RetryPolicy = {
  maxAttempts: number; // chamadas ao provedor por página, a primeira inclusa
  maxRetryAfterMs: number; // teto de espera aceito num 429
  backoffMs: number[]; // espera antes da retentativa n; a última repete
};

export const DEFAULT_POLICY: RetryPolicy = { maxAttempts: 4, maxRetryAfterMs: 60_000, backoffMs: [500, 1000, 2000] };

export type Decision = { stop: false; waitMs: number } | { stop: true; code: string; message: string };

// attempt é o número da chamada que acabou de falhar, começando em 1.
export function decide(error: ProviderError, attempt: number, policy: RetryPolicy): Decision {
  const asked = error instanceof ProviderRateLimited ? error.retryAfterMs : undefined;
  if (asked !== undefined && asked > policy.maxRetryAfterMs) {
    return {
      stop: true,
      code: "retry_after_exceeds_cap",
      message: `O provedor pediu ${asked} ms de espera e o teto é ${policy.maxRetryAfterMs} ms.`,
    };
  }
  if (attempt >= policy.maxAttempts) {
    return {
      stop: true,
      code: "attempts_exhausted",
      message: `O provedor falhou ${attempt} vezes seguidas: ${error.message}.`,
    };
  }
  return { stop: false, waitMs: asked ?? policy.backoffMs[Math.min(attempt - 1, policy.backoffMs.length - 1)]! };
}
