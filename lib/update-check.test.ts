import { describe, expect, it } from 'vitest';
import { RELEASES_PAGE, compareTags, decide, failureFor, newestRelease } from './update-check';

describe('ordering release tags', () => {
  it('orders this repo’s alpha tags numerically, not as strings', () => {
    expect(compareTags('v0.1.0-alpha.27', 'v0.1.0-alpha.9')).toBeGreaterThan(0);
    expect(compareTags('v0.1.0-alpha.27', 'v0.1.0-alpha.27')).toBe(0);
  });

  it('puts a final release after its prereleases and before the next version', () => {
    expect(compareTags('v0.1.0', 'v0.1.0-alpha.99')).toBeGreaterThan(0);
    expect(compareTags('v0.1.1-alpha.1', 'v0.1.0')).toBeGreaterThan(0);
    expect(compareTags('v0.2.0', 'v0.10.0')).toBeLessThan(0);
  });

  it('refuses to order a tag it cannot read', () => {
    expect(compareTags('nightly', 'v0.1.0')).toBeNull();
  });
});

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/x/y/releases/tag/${tag}`,
  assets: [{ name: `128bitfantasy-${tag}.apk`, browser_download_url: `https://dl/${tag}.apk` }],
  ...extra,
});

describe('picking the newest release', () => {
  it('uses tag order, not the order GitHub listed them in', () => {
    const r = newestRelease([rel('v0.1.0-alpha.9'), rel('v0.1.0-alpha.27'), rel('v0.1.0-alpha.26')]);
    expect(r?.tag).toBe('v0.1.0-alpha.27');
    expect(r?.apkUrl).toBe('https://dl/v0.1.0-alpha.27.apk');
  });

  it('skips drafts', () => {
    expect(newestRelease([rel('v0.2.0', { draft: true }), rel('v0.1.0')])?.tag).toBe('v0.1.0');
  });

  it('has nothing to offer when there are no releases', () => {
    expect(newestRelease([])).toBeNull();
  });
});

describe('deciding whether to offer an update', () => {
  const latest = { tag: 'v0.1.0-alpha.28', pageUrl: 'p', apkUrl: 'a', publishedAt: null };

  it('offers a newer release', () => {
    expect(decide('v0.1.0-alpha.27', latest)).toMatchObject({ status: 'available', current: 'v0.1.0-alpha.27' });
  });

  it('says current when the installed build is the newest, or newer', () => {
    expect(decide('v0.1.0-alpha.28', latest)).toEqual({ status: 'current', tag: 'v0.1.0-alpha.28' });
    expect(decide('v0.1.0-alpha.30', latest)).toEqual({ status: 'current', tag: 'v0.1.0-alpha.30' });
  });

  it('does not guess for a build that does not know its own tag', () => {
    expect(decide(null, latest)).toEqual({ status: 'unknown-build', latest });
  });
});

describe('when GitHub will not answer', () => {
  it('reads a 404 as releases hidden from the app, with the page to open instead', () => {
    expect(failureFor(404)).toEqual({ status: 'hidden', pageUrl: RELEASES_PAGE });
  });

  it('says rate limiting for 403 and never shows a bare status code', () => {
    const r403 = failureFor(403);
    expect(r403.status === 'failed' && r403.message).toMatch(/rate-limiting/);
    const r500 = failureFor(500);
    expect(r500.status === 'failed' && r500.message).not.toMatch(/answered/);
  });
});
