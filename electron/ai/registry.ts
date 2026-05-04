import { getProviderMeta } from '../../shared/ai';
import type { Provider, ProviderId } from '../../shared/ai';
import { fakeProvider } from './providers/fake';
import { googleProvider } from './providers/google';
import { nvidiaProvider } from './providers/nvidia';
import { openaiProvider } from './providers/openai';

/**
 * Phase 3 chunk 44 — `custom` (OpenAI-호환) provider.
 *
 * Self-hosted Ollama (`http://localhost:11434/v1`), vLLM, LM Studio, on-prem
 * LLM gateway 등 OpenAI `/v1/chat/completions` 호환 endpoint 를 한 슬롯에
 * 통합. baseUrl 은 `userData/provider-config.json` 의 custom 키에 저장.
 *
 * 어댑터 자체는 OpenAI 와 동일 — meta 만 swap (id='custom', label, requiresBaseUrl).
 * 이렇게 하면 `Provider.meta.id` 검증 로직 (e.g. 'OpenAI ' 접두사 에러
 * 메시지) 가 'Custom' 으로 자연스럽게 바뀜.
 */
const customProvider: Provider = {
  ...openaiProvider,
  meta: getProviderMeta('custom'),
};

const providers = new Map<ProviderId, Provider>([
  ['openai', openaiProvider],
  ['nvidia', nvidiaProvider],
  ['google', googleProvider],
  ['custom', customProvider],
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
