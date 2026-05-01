import type { Provider, ProviderId } from '../../shared/ai';
import { openaiProvider } from './providers/openai';

const providers = new Map<ProviderId, Provider>([['openai', openaiProvider]]);

/**
 * Lookup a provider by id. Returns null when the provider is recognized in the
 * shared union but not yet implemented in this build (Anthropic / Google /
 * NVIDIA NIM / Ollama / custom — Phase 2 follow-up chunks).
 */
export function getProvider(id: ProviderId): Provider | null {
  return providers.get(id) ?? null;
}
