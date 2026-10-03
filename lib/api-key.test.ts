import { describe, expect, it } from 'vitest';
import { baseUrlProblem, describeKeyProblem, sanitizeApiKey } from './api-key';

const TOKEN = 'hf_abcdefghijklmnopqrstuvwxyz01234567';

describe('sanitizeApiKey', () => {
  it('leaves a clean key alone', () => {
    expect(sanitizeApiKey(TOKEN)).toBe(TOKEN);
    expect(TOKEN).toHaveLength(37);
  });

  it('strips a trailing newline', () => {
    expect(sanitizeApiKey(`${TOKEN}\n`)).toBe(TOKEN);
    expect(sanitizeApiKey(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it('takes the first line of a multi-line paste', () => {
    // The real failure: an interior newline that trim() cannot see, with more
    // text behind it, reaching the Authorization header unchanged.
    expect(sanitizeApiKey(`${TOKEN}\nSome other line the selection caught`)).toBe(TOKEN);
    expect(sanitizeApiKey(`${TOKEN}\r\nmore`)).toBe(TOKEN);
  });

  it('skips blank leading lines rather than returning nothing', () => {
    expect(sanitizeApiKey(`\n\n  \n${TOKEN}`)).toBe(TOKEN);
  });

  it('removes spaces and zero-width characters from inside the key', () => {
    // A copied web page leaves these behind and they are invisible in a field.
    expect(sanitizeApiKey('hf_abc def')).toBe('hf_abcdef');
    expect(sanitizeApiKey('hf_​abc﻿')).toBe('hf_abc');
    expect(sanitizeApiKey('hf_a\tb')).toBe('hf_ab');
  });

  it('returns null rather than an empty string', () => {
    // An empty string reads as "a key" everywhere downstream.
    expect(sanitizeApiKey('')).toBeNull();
    expect(sanitizeApiKey('   ')).toBeNull();
    expect(sanitizeApiKey('\n\n')).toBeNull();
    // The case that needs the guard: JavaScript's trim() does not treat a
    // zero-width space as whitespace, so this survives every earlier check and
    // only empties out once the interior strip has run.
    expect(sanitizeApiKey('\u200b\u200b')).toBeNull();
    expect(sanitizeApiKey('\ufeff')).toBeNull();
    expect(sanitizeApiKey(null)).toBeNull();
    expect(sanitizeApiKey(undefined)).toBeNull();
  });
});

describe('describeKeyProblem', () => {
  it('passes a clean key', () => {
    expect(describeKeyProblem(TOKEN)).toBeNull();
  });

  it('catches what would break the Authorization header', () => {
    // These are exactly the cases Android throws IllegalArgumentException for.
    expect(describeKeyProblem(`${TOKEN}\n`)).toContain('line break');
    expect(describeKeyProblem('hf_abc def12345')).toContain('space');
    expect(describeKeyProblem('hf_abcédefghij')).toContain('cannot be sent');
  });

  it('catches nothing at all, and something too short to be real', () => {
    expect(describeKeyProblem(null)).toContain('No API key');
    expect(describeKeyProblem('')).toContain('No API key');
    expect(describeKeyProblem('hf_abc')).toContain('too short');
  });

  it('never quotes the key back', () => {
    // An error message is not a place to print a secret.
    for (const bad of [`${TOKEN}\n`, 'hf_abc def12345', 'hf_abc']) {
      expect(describeKeyProblem(bad)).not.toContain('hf_');
    }
  });
});

describe('custom AI address', () => {
  it('accepts https and empty', () => {
    expect(baseUrlProblem('')).toBeNull();
    expect(baseUrlProblem('https://my-box.example.com/v1')).toBeNull();
  });

  it('refuses plain http, localhost and junk', () => {
    expect(baseUrlProblem('http://192.168.1.20:11434/v1')).toMatch(/https/);
    expect(baseUrlProblem('https://localhost:11434/v1')).toMatch(/phone itself/);
    expect(baseUrlProblem('not a url')).toMatch(/not a web address/);
  });
});
