import { describe, expect, it } from 'vitest';
import { describeNetworkFailure } from './net-errors';

/** The exact text that reached the phone. */
const REPORTED =
  "fetch failed: Call to function 'NativeRequest.start' has been rejected.\n" +
  '→ Caused by: java.lang.IllegalArgumentException: Unexpected char 0x0a at 44 in Authorization value';

describe('describeNetworkFailure', () => {
  it('turns the reported crash into something actionable', () => {
    const out = describeNetworkFailure(new Error(REPORTED), 'your food estimate');
    expect(out).toContain('line break');
    expect(out).toContain('Settings');
    // None of the platform noise survives.
    expect(out).not.toContain('NativeRequest');
    expect(out).not.toContain('java.lang');
    expect(out).not.toContain('0x0a');
  });

  it('names being offline as being offline, and reassures about cached data', () => {
    const out = describeNetworkFailure(new Error('Network request failed'), 'the lookup');
    expect(out).toContain('No connection');
    expect(out).toContain('on the phone');
  });

  it('recognises a name that will not resolve', () => {
    expect(describeNetworkFailure(new Error('Unable to resolve host "api.example.com"'))).toContain(
      'No connection'
    );
  });

  it('recognises a certificate problem', () => {
    expect(describeNetworkFailure(new Error('Trust anchor for certification path not found'))).toContain(
      'secure connection'
    );
  });

  it('keeps an error it does not recognise, rather than replacing it with a platitude', () => {
    // A mysterious error the user can search for beats a friendly one that
    // says nothing at all.
    const odd = 'Provider returned 418 I am a teapot';
    expect(describeNetworkFailure(new Error(odd))).toBe(odd);
    expect(describeNetworkFailure(odd)).toBe(odd);
  });

  it('uses what it was told the request was for', () => {
    expect(describeNetworkFailure(new Error(REPORTED), 'your recipe scan')).toContain(
      'your recipe scan'
    );
  });
});
