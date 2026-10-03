/**
 * Which AI the coach uses: provider, model, base URL, and the key.
 *
 * Same providers and defaults as 128BIT FIT. The key sits in the keystore;
 * the rest in plain settings.
 */
import { sanitizeApiKey, sanitizeBaseUrl } from '@/lib/api-key';
import { getString, setString } from '@/lib/storage/kv';
import { deleteSecret, getSecret, setSecret } from '@/lib/storage/secure';
import { getProviderMeta, isAiProviderId, type AiProviderId } from './ai-coach';

const KEY_SECRET = 'bitfantasy_ai_api_key';
const KEY_PROVIDER = 'ai_provider';
const KEY_MODEL = 'ai_model';
const KEY_BASE_URL = 'ai_base_url';

export type AiSettings = {
  provider: AiProviderId;
  model: string;
  baseUrl: string;
  hasKey: boolean;
};

export async function getAiSettings(): Promise<AiSettings> {
  const [p, m, b, k] = await Promise.all([
    getString(KEY_PROVIDER),
    getString(KEY_MODEL),
    getString(KEY_BASE_URL),
    getSecret(KEY_SECRET),
  ]);
  const provider: AiProviderId = p && isAiProviderId(p) ? p : 'anthropic';
  const meta = getProviderMeta(provider);
  return {
    provider,
    model: m?.trim() || meta.defaultModel,
    baseUrl: sanitizeBaseUrl(b) || meta.defaultBaseUrl || '',
    hasKey: !!sanitizeApiKey(k),
  };
}

/**
 * Returns a warning when the key could only be held in memory (web), so the
 * screen can say so. Throws on anything else.
 */
export async function updateAiSettings(patch: {
  provider?: AiProviderId;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<string | null> {
  if (patch.provider) {
    await setString(KEY_PROVIDER, patch.provider);
    // A model name from one provider means nothing to another.
    if (patch.model == null) await setString(KEY_MODEL, '');
    if (patch.baseUrl == null) await setString(KEY_BASE_URL, '');
  }
  if (patch.model != null) await setString(KEY_MODEL, patch.model.trim());
  if (patch.baseUrl != null) await setString(KEY_BASE_URL, sanitizeBaseUrl(patch.baseUrl));
  if (patch.apiKey !== undefined) {
    const k = sanitizeApiKey(patch.apiKey);
    if (!k) {
      await deleteSecret(KEY_SECRET);
      return null;
    }
    try {
      await setSecret(KEY_SECRET, k);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  return null;
}

export async function getAiRuntime(): Promise<AiSettings & { apiKey: string | null }> {
  const [s, k] = await Promise.all([getAiSettings(), getSecret(KEY_SECRET)]);
  return { ...s, apiKey: sanitizeApiKey(k) };
}
