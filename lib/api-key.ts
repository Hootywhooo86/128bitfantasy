/**
 * Cleaning up a pasted API key.
 *
 * A key pasted from a browser, a password manager or a chat message routinely
 * arrives with company: a trailing newline, a zero-width character from a web
 * page, a line of surrounding text the selection caught.
 *
 * Trimming the ends is not enough, and this is not theoretical — a real paste
 * produced `Unexpected char 0x0a at 44 in Authorization value`, an interior
 * newline sitting immediately after a complete 37-character token with more
 * text behind it. trim() cannot see that, the key went into the header
 * unchanged, and Android's HTTP stack rejected the request with a Java
 * exception the user had no way to act on.
 *
 * No API key contains whitespace. So anything that is not a printable,
 * non-space character is paste damage and comes off.
 *
 * Pure: raw paste in, usable key out.
 */

/**
 * The key, with the damage removed.
 *
 * Takes the first line that has anything on it — a multi-line paste is a
 * selection that caught too much, and the key is the part that looks like a
 * key — then removes every space and control character from within it.
 *
 * Returns null when nothing usable is left, rather than an empty string that
 * would read as "a key" everywhere downstream.
 */
export function sanitizeApiKey(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const line = raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;

  // Every Unicode space, every control character, and the zero-width
  // characters a copied web page leaves behind.
  const cleaned = line.replace(/[\s\u0000-\u001f\u007f​-‍﻿]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Why this key cannot be sent, in one sentence, or null when it is fine.
 *
 * Checked before it reaches a header so the failure is something the user can
 * act on. The alternative is what happened: a java.lang.IllegalArgumentException
 * surfaced verbatim, naming a byte offset into a string the user never saw.
 *
 * Never quotes the key back. An error message is not a place to print a secret.
 */
export function describeKeyProblem(key: string | null | undefined): string | null {
  if (!key) return 'No API key is set.';

  // Anything left here survived sanitizeApiKey, so it is structural.
  if (/[\s\u0000-\u001f\u007f]/.test(key)) {
    return 'The saved key contains a space or a line break. Paste it again — select only the key itself.';
  }
  // eslint-disable-next-line no-control-regex
  if (!/^[\x21-\x7e]+$/.test(key)) {
    return 'The saved key contains characters that cannot be sent in a request header. Paste it again.';
  }
  if (key.length < 8) {
    return 'The saved key is too short to be a real key. Paste it again.';
  }
  return null;
}

/**
 * The same treatment for a pasted endpoint address.
 *
 * A custom base URL is typed or pasted like a key and reaches the network
 * layer the same way — a newline in it produces the identical native rejection,
 * on the URL instead of the header. A URL never contains whitespace either.
 */
export function sanitizeBaseUrl(raw: string | null | undefined): string {
  return sanitizeApiKey(raw) ?? '';
}

/**
 * Why a custom AI address cannot work from a phone, in one sentence, or null
 * when it can. Empty is fine: it means "use the provider's own address".
 *
 * Two traps. Android refuses plain http:// in a release build, and the key
 * would travel unencrypted if it did not. And "localhost" on a phone is the
 * phone itself — not the computer running Ollama.
 */
export function baseUrlProblem(raw: string | null | undefined): string | null {
  const url = sanitizeBaseUrl(raw);
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'That address is not a web address. It should start with https://';
  }
  if (parsed.protocol !== 'https:') {
    return 'Use an https:// address. Android blocks plain http://, and your key would be sent unencrypted.';
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return '"localhost" on a phone means the phone itself, not your computer. Use the https:// address your server is reachable at.';
  }
  return null;
}
