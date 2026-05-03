import type { Provider, ProviderId } from '../../shared/ai';
import { fakeProvider } from './providers/fake';
import { googleProvider } from './providers/google';
import { nvidiaProvider } from './providers/nvidia';
import { openaiProvider } from './providers/openai';

const providers = new Map<ProviderId, Provider>([
  ['openai', openaiProvider],
  ['nvidia', nvidiaProvider],
  ['google', googleProvider],
]);

/**
 * Lookup a provider by id. Returns null when the provider is recognized in the
 * shared union but not yet implemented in this build (Anthropic / Google /
 * custom — Phase 2 follow-up chunks; `custom` covers any OpenAI-compatible
 * endpoint including self-hosted Ollama via /v1 shim).
 *
 * When `AHWP_E2E_FAKE_AI=1` is set in the main process env, the openai and
 * nvidia slots are swapped with a deterministic fake (see providers/fake.ts).
 * No network is involved in that mode.
 */
export function getProvider(id: ProviderId): Provider | null {
  if (
    process.env.AHWP_E2E_FAKE_AI === '1' &&
    (id === 'openai' || id === 'nvidia')
  ) {
    return fakeProvider;
  }
  return providers.get(id) ?? null;
}
