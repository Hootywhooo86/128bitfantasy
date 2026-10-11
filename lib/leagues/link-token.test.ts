import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/connections', () => ({ getConnection: vi.fn(), saveConnection: vi.fn() }));
vi.mock('@/lib/storage/kv', () => ({ getString: vi.fn(), setString: vi.fn(), removeItem: vi.fn() }));
vi.mock('react-native-url-polyfill/auto', () => ({}));

const { readAuthLink } = await import('./client');

const verify = 'https://wvflp.supabase.co/auth/v1/verify?token=abc123def&type=magiclink&redirect_to=http://localhost:3000';

describe('sign-in links, pasted or opened', () => {
  it('the email link itself, not yet used', () => {
    expect(readAuthLink(verify)).toEqual({ kind: 'token', tokenHash: 'abc123def', type: 'magiclink' });
    expect(readAuthLink(`  ${verify.replace('magiclink', 'signup')}\n`)).toMatchObject({ type: 'signup' });
  });

  it('the link wrapped by Gmail’s redirect', () => {
    const wrapped = `https://www.google.com/url?q=${encodeURIComponent(verify)}&sa=D`;
    expect(readAuthLink(wrapped)).toMatchObject({ kind: 'token', tokenHash: 'abc123def' });
  });

  it('the page it opened: localhost or this app, with the session in the address', () => {
    const landed = 'http://localhost:3000/#access_token=eyJ.a.b&expires_in=3600&refresh_token=r3fr35h&token_type=bearer&type=magiclink';
    expect(readAuthLink(landed)).toEqual({ kind: 'session', accessToken: 'eyJ.a.b', refreshToken: 'r3fr35h' });
    expect(readAuthLink(landed.replace('http://localhost:3000/', 'bitfantasy://auth'))).toMatchObject({ kind: 'session' });
  });

  it('a link that was already used', () => {
    const used = 'http://localhost:3000/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    expect(readAuthLink(used)).toMatchObject({ kind: 'error', message: expect.stringContaining('already used') });
  });

  it('a plain code is not a link', () => {
    expect(readAuthLink('123456')).toBeNull();
  });
});
