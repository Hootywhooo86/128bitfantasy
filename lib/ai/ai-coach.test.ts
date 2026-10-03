import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDERS,
  VISION_PROVIDERS,
  getProviderMeta,
  isAiProviderId,
  providerSupportsVision,
  visionSupport,
  MODEL_DEPENDENT_VISION,
  type AiProviderId,
} from './ai-coach';

describe('AI providers', () => {
  it('offers Hugging Face', () => {
    const hf = AI_PROVIDERS.find((p) => p.id === 'huggingface');
    expect(hf).toBeDefined();
    expect(hf!.defaultBaseUrl).toBe('https://router.huggingface.co/v1');
    // Its router speaks the OpenAI API, so the user should not have to supply
    // a base URL to use it.
    expect(hf!.needsBaseUrl).toBe(false);
  });

  it('gives every provider a label, a default model and a hint', () => {
    for (const p of AI_PROVIDERS) {
      expect(p.label.length, p.id).toBeGreaterThan(0);
      expect(p.defaultModel.length, p.id).toBeGreaterThan(0);
      expect(p.hint.length, p.id).toBeGreaterThan(0);
    }
  });

  it('gives a base URL to every provider that does not ask the user for one', () => {
    // Anthropic and Gemini use their own paths, so null is correct there; any
    // other provider with neither a default nor needsBaseUrl could not be
    // called at all.
    for (const p of AI_PROVIDERS) {
      if (p.needsBaseUrl) continue;
      if (p.id === 'anthropic' || p.id === 'gemini') continue;
      expect(p.defaultBaseUrl, p.id).toBeTruthy();
    }
  });

  it('has unique ids', () => {
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('recognises its own ids and nothing else', () => {
    for (const p of AI_PROVIDERS) expect(isAiProviderId(p.id)).toBe(true);
    expect(isAiProviderId('huggingface')).toBe(true);
    expect(isAiProviderId('not-a-provider')).toBe(false);
    expect(isAiProviderId('')).toBe(false);
  });

  it('falls back to a real provider for an unknown id', () => {
    expect(getProviderMeta('nope' as AiProviderId).id).toBe(AI_PROVIDERS[0].id);
  });
});

describe('vision support', () => {
  it('knows which providers can always look at a photo', () => {
    for (const id of ['anthropic', 'openai', 'gemini'] as AiProviderId[]) {
      expect(visionSupport(id)).toBe('yes');
      // The model's own capability is irrelevant for these — every model they
      // serve takes images, so a stale flag must not veto it.
      expect(visionSupport(id, false)).toBe('yes');
      expect(providerSupportsVision(id)).toBe(true);
    }
  });

  it('does not claim vision for providers that route to arbitrary models', () => {
    // A photo sent to one of these is silently dropped, and the model is then
    // asked to describe something it never received. The UI has to be able to
    // say "this provider cannot read photos" instead.
    expect(visionSupport('openrouter')).toBe('no');
    expect(visionSupport('custom')).toBe('no');
    expect(providerSupportsVision('openrouter')).toBe(false);
    expect(providerSupportsVision('custom')).toBe(false);
  });

  it('lets the model decide on Hugging Face', () => {
    // Its router serves ~140 models and about a third take images. Calling the
    // whole provider blind locked the user out of a capability they had.
    expect(visionSupport('huggingface', true)).toBe('yes');
    expect(providerSupportsVision('huggingface', true)).toBe(true);

    expect(visionSupport('huggingface', false)).toBe('model-cannot');
    expect(providerSupportsVision('huggingface', false)).toBe(false);
  });

  it('attempts a hand-typed model rather than refusing it', () => {
    // Nothing is known about a model id the user typed. Refusing would be the
    // same mistake in the other direction, and the provider's own error is a
    // better answer than our guess.
    expect(visionSupport('huggingface', null)).toBe('unknown');
    expect(visionSupport('huggingface')).toBe('unknown');
    expect(providerSupportsVision('huggingface', null)).toBe(true);
  });

  it('never reports model-dependent for a provider that cannot see at all', () => {
    expect(visionSupport('openrouter', true)).toBe('no');
    expect(providerSupportsVision('openrouter', true)).toBe(false);
  });

  it('names only real providers as vision-capable', () => {
    const ids = new Set(AI_PROVIDERS.map((p) => p.id));
    for (const id of VISION_PROVIDERS) expect(ids.has(id)).toBe(true);
    for (const id of MODEL_DEPENDENT_VISION) expect(ids.has(id)).toBe(true);
  });
});
