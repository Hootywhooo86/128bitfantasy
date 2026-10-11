import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/connections', () => ({ getConnection: vi.fn(), saveConnection: vi.fn() }));
vi.mock('@/lib/storage/kv', () => ({ getString: vi.fn(), setString: vi.fn(), removeItem: vi.fn() }));
vi.mock('react-native-url-polyfill/auto', () => ({}));

const { linkToken } = await import('./client');

describe('pasted sign-in links', () => {
  it('pulls the token out of a default Supabase email link', () => {
    const url = 'https://wvflp.supabase.co/auth/v1/verify?token=abc123def&type=magiclink&redirect_to=http://localhost:3000';
    expect(linkToken(url)).toEqual({ tokenHash: 'abc123def', type: 'magiclink' });
    expect(linkToken(`  ${url.replace('magiclink', 'signup')}\n`)).toEqual({ tokenHash: 'abc123def', type: 'signup' });
  });

  it('leaves a plain code alone', () => {
    expect(linkToken('123456')).toBeNull();
  });
});
