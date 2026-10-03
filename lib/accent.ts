/**
 * The user's accent colour — buttons, highlights, the active chip, Coaches
 * Corner. Same mechanism as 128BIT FIT's: a tiny store with no imports, read
 * live by the theme's getters.
 *
 * Win / loss / injury colours never come from here, and no preset is the
 * loss red, so "yours" can never read as "losing".
 */
import { useSyncExternalStore } from 'react';

export type AccentChoice = { name: string; hex: string };

export const ACCENTS: AccentChoice[] = [
  { name: 'SILVER', hex: '#c4cad3' },
  { name: 'TEAL', hex: '#26d3c3' },
  { name: 'TURF', hex: '#4ade80' },
  { name: 'GOLD', hex: '#e0b84a' },
  { name: 'AMBER', hex: '#ffcc3d' },
  { name: 'AZURE', hex: '#5aa9ff' },
  { name: 'ICE', hex: '#9fd8ff' },
  { name: 'VIOLET', hex: '#a78bfa' },
  { name: 'CORAL', hex: '#ff8552' },
  { name: 'ROSE', hex: '#ff8fc7' },
  { name: 'WHITE', hex: '#ffffff' },
];

export const DEFAULT_ACCENT = ACCENTS[0].hex;

const HEX = /^#[0-9a-f]{6}$/;

/** Any 6-digit hex is allowed — presets are a shortcut, not a limit. */
export function normalizeHex(v: string | null | undefined): string | null {
  if (!v) return null;
  let h = v.trim().toLowerCase();
  if (!h.startsWith('#')) h = `#${h}`;
  if (/^#[0-9a-f]{3}$/.test(h)) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return HEX.test(h) ? h : null;
}

export function accentName(hex: string): string {
  return ACCENTS.find((a) => a.hex === hex.toLowerCase())?.name ?? 'CUSTOM';
}

/** Black or white text on this colour, whichever reads. */
export function onAccentFor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#000000' : '#ffffff';
}

/** Too dark to see on the black background. */
export function tooDark(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 60;
}

let accent = DEFAULT_ACCENT;
let onAccent = onAccentFor(DEFAULT_ACCENT);
let version = 0;
const listeners = new Set<() => void>();

export const currentAccent = () => accent;
export const currentOnAccent = () => onAccent;
/** Bumped on every change, so cached styles know they are stale. */
export const accentVersion = () => version;

/** Applies a colour now. Persisting it is the caller's job (lib/storage/prefs). */
export function applyAccent(hex: string | null | undefined): void {
  const n = normalizeHex(hex);
  const next = n && !tooDark(n) ? n : DEFAULT_ACCENT;
  if (next === accent) return;
  accent = next;
  onAccent = onAccentFor(next);
  version++;
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAccent(): string {
  return useSyncExternalStore(subscribe, currentAccent, currentAccent);
}
