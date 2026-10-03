import React, { useEffect, useState } from 'react';
import { Button, Card, CardHead, Chips, Field, Label, Note, Screen } from '@/components/ui';
import { AI_PROVIDERS, getProviderMeta, webSearchSupport, webSearchUnavailableReason, type AiProviderId } from '@/lib/ai/ai-coach';
import { getAiSettings, updateAiSettings } from '@/lib/ai/settings';
import { baseUrlProblem, describeKeyProblem, sanitizeApiKey } from '@/lib/api-key';

const SHORT: Record<AiProviderId, string> = {
  anthropic: 'CLAUDE',
  openai: 'OPENAI',
  gemini: 'GEMINI',
  openrouter: 'OPENROUTER',
  groq: 'GROQ',
  huggingface: 'HUGGING FACE',
  custom: 'CUSTOM',
};

/** Settings → AI. The same providers, defaults and BYO-key rules as 128BIT FIT. */
export default function Settings() {
  const [provider, setProvider] = useState<AiProviderId>('anthropic');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAiSettings().then((s) => {
      setProvider(s.provider);
      setModel(s.model);
      setBaseUrl(s.baseUrl);
      setHasKey(s.hasKey);
    });
  }, []);

  const meta = getProviderMeta(provider);
  const effectiveModel = model.trim() || meta.defaultModel;
  const searchable = webSearchSupport(provider, effectiveModel) === 'yes';

  function pickProvider(p: AiProviderId) {
    setProvider(p);
    setModel(getProviderMeta(p).defaultModel);
    setBaseUrl(getProviderMeta(p).defaultBaseUrl ?? '');
  }

  async function save() {
    setMsg(null);
    const cleaned = key ? sanitizeApiKey(key) : null;
    if (key && describeKeyProblem(cleaned)) return setMsg({ text: describeKeyProblem(cleaned)!, error: true });
    if (meta.needsBaseUrl && !baseUrl.trim()) return setMsg({ text: 'This provider needs a base URL.', error: true });
    const urlProblem = baseUrlProblem(baseUrl);
    if (urlProblem) return setMsg({ text: urlProblem, error: true });
    setBusy(true);
    try {
      const warn = await updateAiSettings({ provider, model: effectiveModel, baseUrl, ...(key ? { apiKey: key } : {}) });
      const s = await getAiSettings();
      setHasKey(s.hasKey);
      setKey('');
      setMsg({ text: warn ?? 'Saved.' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    await updateAiSettings({ apiKey: '' });
    setHasKey(false);
    setMsg({ text: 'Key removed.' });
  }

  return (
    <Screen section="Settings" back right="none">
      <Label>AI · COACHES CORNER</Label>
      <Card>
        <CardHead title="PROVIDER" note={hasKey ? 'Key saved' : 'No key'} />
        <Chips items={AI_PROVIDERS.map((p) => ({ id: p.id, label: SHORT[p.id] }))} value={provider} onChange={pickProvider} />
        <Note>{meta.hint}</Note>
        <Field label="MODEL" value={model} onChangeText={setModel} placeholder={meta.defaultModel} />
        {meta.needsBaseUrl || provider === 'custom' ? (
          <Field label="BASE URL" value={baseUrl} onChangeText={setBaseUrl} placeholder="https://…/v1" keyboardType="url" />
        ) : null}
        <Field
          label="API KEY"
          value={key}
          onChangeText={setKey}
          secureTextEntry
          placeholder={hasKey ? '•••••••• (saved — paste to replace)' : 'paste your key'}
          hint="Stored in this phone's keystore and sent only to the provider you picked. Never to us."
        />
        {searchable ? (
          <Note>Web search: on. Coaches Corner checks injuries and news before every call.</Note>
        ) : (
          <Note tone="error">{webSearchUnavailableReason(provider, effectiveModel)} Coaches Corner will still answer, from roster data alone.</Note>
        )}
        {msg ? <Note tone={msg.error ? 'error' : 'muted'}>{msg.text}</Note> : null}
        <Button label="SAVE" onPress={save} busy={busy} />
        {hasKey ? <Button label="REMOVE KEY" kind="danger" onPress={clearKey} /> : null}
      </Card>

      <Label>ABOUT</Label>
      <Note>
        128BIT FANTASY is part of the 128bit family. Read-only: it never changes a lineup or makes a move. Advice only — for
        the game, not for betting.
      </Note>
    </Screen>
  );
}
