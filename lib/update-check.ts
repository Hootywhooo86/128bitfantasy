/**
 * Is there a newer APK on GitHub Releases than the one installed?
 *
 * The app is sideloaded, so nothing tells it about new builds. The release
 * workflow bakes its tag in as EXPO_PUBLIC_RELEASE_TAG; this compares that
 * with the newest published release. A build without the tag — a dev build,
 * or one made before the workflow set it — cannot know where it stands and
 * says so rather than guessing.
 *
 * Only ever runs when the user asks. No background calls, no analytics: one
 * unauthenticated GET to a public API.
 */
import { LOOKUP_TIMEOUT_MS, fetchWithTimeout } from './net';
import { describeNetworkFailure } from './net-errors';

const RELEASES_URL = 'https://api.github.com/repos/Hootywhooo86/128bitfantasy/releases?per_page=10';

/** The releases page, for when the app cannot read the list itself. */
export const RELEASES_PAGE = 'https://github.com/Hootywhooo86/128bitfantasy/releases/latest';

export type Release = {
  tag: string;
  pageUrl: string;
  /** Direct link to the .apk asset, when the release has one. */
  apkUrl: string | null;
  publishedAt: string | null;
};

export type UpdateCheck =
  | { status: 'current'; tag: string }
  | { status: 'available'; current: string; latest: Release }
  | { status: 'unknown-build'; latest: Release }
  /**
   * GitHub answered 404: the releases exist but not to an anonymous request,
   * which is what a private repository looks like from outside. A browser
   * signed in to GitHub can still see them.
   */
  | { status: 'hidden'; pageUrl: string }
  | { status: 'failed'; message: string };

/** What a failed HTTP answer means for the user, in words rather than a status code. */
export function failureFor(status: number): UpdateCheck {
  if (status === 404) return { status: 'hidden', pageUrl: RELEASES_PAGE };
  if (status === 403) {
    return { status: 'failed', message: 'GitHub is rate-limiting update checks from this network. Try again in an hour.' };
  }
  return { status: 'failed', message: `GitHub could not answer just now (HTTP ${status}). Try again later.` };
}

export function installedReleaseTag(): string | null {
  const tag = process.env.EXPO_PUBLIC_RELEASE_TAG;
  return tag && tag.trim() ? tag.trim() : null;
}

type Parsed = { core: [number, number, number]; pre: string | null; preNum: number | null };

function parseTag(tag: string): Parsed | null {
  const m = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+?)\.?(\d+)?)?$/);
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ?? null,
    preNum: m[5] != null ? Number(m[5]) : null,
  };
}

/**
 * Semver-ish ordering for this repo's tags: `v0.1.0-alpha.27` < `v0.1.0-alpha.28`
 * < `v0.1.0` < `v0.1.1-alpha.1`. Returns null when either tag is not one it
 * can read, so the caller never reports an update it cannot justify.
 */
export function compareTags(a: string, b: string): number | null {
  const pa = parseTag(a);
  const pb = parseTag(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }
  // A final release outranks any prerelease of the same version.
  if (pa.pre == null || pb.pre == null) return (pa.pre == null ? 1 : 0) - (pb.pre == null ? 1 : 0);
  if (pa.pre !== pb.pre) return pa.pre < pb.pre ? -1 : 1;
  return (pa.preNum ?? 0) - (pb.preNum ?? 0);
}

type ApiRelease = {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
  published_at?: string | null;
  assets?: { name?: string; browser_download_url?: string }[];
};

/** The newest release that can be installed, by tag order rather than list order. */
export function newestRelease(list: ApiRelease[]): Release | null {
  const usable = list.filter((r) => !r.draft && r.tag_name && r.html_url);
  if (usable.length === 0) return null;
  const best = usable.reduce((a, b) => ((compareTags(b.tag_name!, a.tag_name!) ?? 0) > 0 ? b : a));
  const apk = best.assets?.find((x) => x.name?.toLowerCase().endsWith('.apk') && x.browser_download_url);
  return {
    tag: best.tag_name!,
    pageUrl: best.html_url!,
    apkUrl: apk?.browser_download_url ?? null,
    publishedAt: best.published_at ?? null,
  };
}

export function decide(installed: string | null, latest: Release): UpdateCheck {
  if (!installed) return { status: 'unknown-build', latest };
  const cmp = compareTags(latest.tag, installed);
  if (cmp == null) {
    return installed === latest.tag
      ? { status: 'current', tag: installed }
      : { status: 'available', current: installed, latest };
  }
  return cmp > 0 ? { status: 'available', current: installed, latest } : { status: 'current', tag: installed };
}

export async function checkForUpdate(signal?: AbortSignal): Promise<UpdateCheck> {
  try {
    const res = await fetchWithTimeout(
      RELEASES_URL,
      { headers: { Accept: 'application/vnd.github+json' }, signal },
      { timeoutMs: LOOKUP_TIMEOUT_MS * 2, label: 'Update check' }
    );
    if (!res.ok) return failureFor(res.status);
    const latest = newestRelease((await res.json()) as ApiRelease[]);
    if (!latest) return { status: 'failed', message: 'No releases are published yet.' };
    return decide(installedReleaseTag(), latest);
  } catch (e) {
    return { status: 'failed', message: describeNetworkFailure(e, 'the update check') };
  }
}
