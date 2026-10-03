/**
 * Turning a transport failure into a sentence someone can act on.
 *
 * What reached the user before this:
 *
 *   fetch failed: Call to function 'NativeRequest.start' has been rejected.
 *   Caused by: java.lang.IllegalArgumentException:
 *   Unexpected char 0x0a at 44 in Authorization value
 *
 * That is accurate and completely useless. It names a byte offset into a
 * string the user has never seen, in a language they are not writing, about a
 * header they did not know existed. The house rule is one honest sentence, and
 * "fetch failed" pasted through from the platform is not one.
 *
 * The rule throughout: say what to do about it. Where the cause is genuinely
 * unknown the original text is kept rather than replaced with something vague,
 * because a mysterious error the user can search for beats a friendly one they
 * cannot.
 *
 * Pure: an error in, a sentence out.
 */

/**
 * Android's HTTP stack rejects a request before sending it when a header value
 * or the URL contains a character that cannot go in one — almost always a
 * newline that came in on a paste.
 */
const NATIVE_REJECTED = /NativeRequest\.start|IllegalArgumentException|Unexpected char/i;

/** No route to the host: aeroplane mode, no signal, a stadium concourse. */
const OFFLINE = /network request failed|unable to resolve host|no address associated|econnrefused|enotfound|failed to connect|network is unreachable/i;

const TLS = /certificate|ssl|tls handshake|trust anchor/i;

export function describeNetworkFailure(error: unknown, what = 'that request'): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (NATIVE_REJECTED.test(raw)) {
    // The offset is meaningless to the user, but which field is not — and it
    // is nearly always the key, because that is the value people paste.
    return (
      `Your phone refused to send ${what}: something in the API key or the endpoint address ` +
      `has a line break or a space in it. Open Settings → AI and paste the key again, ` +
      `selecting only the key itself.`
    );
  }

  if (OFFLINE.test(raw)) {
    return `No connection, so ${what} could not be sent. Your last synced leagues are still on the phone.`;
  }

  if (TLS.test(raw)) {
    return `The secure connection for ${what} could not be established. If you are on a network that inspects traffic, try another one.`;
  }

  // Unknown: keep the original. A mysterious error the user can search for
  // beats a friendly one that says nothing.
  return raw;
}
