import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64url, challengeFor, makeVerifier, sha256 } from './pkce';

describe('pkce', () => {
  it('matches the RFC 7636 example', () => {
    // RFC 7636 appendix B.
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('agrees with node for empty, short and multi-block input', () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'y'.repeat(64), 'z'.repeat(200)]) {
      expect(Buffer.from(sha256(s)).toString('hex')).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });

  it('encodes base64url without padding', () => {
    expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('makes 64-char verifiers from the allowed alphabet', () => {
    const v = makeVerifier((n) => Uint8Array.from({ length: n }, (_, i) => i * 7));
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });
});
