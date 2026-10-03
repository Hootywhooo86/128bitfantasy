/**
 * Design tokens — the 128bit family look, matched to 128BIT FIT's.
 *
 * Monochrome on black, pixel type for labels, Inter for body. The accent is
 * the user's pick (lib/accent.ts, silver by default, like the whistle) and is
 * read live through the getters below. Win / loss / injury colours are fixed
 * and never follow the accent.
 */
import { accentVersion, currentAccent, currentOnAccent } from './accent';

export const colors = {
  bg: '#000000',
  surface: '#0d0d0d',
  surfaceAlt: '#171717',
  track: '#212121',
  border: '#242424',
  borderBright: '#3a3a3a',
  text: '#ffffff',
  textMuted: '#8c8c8c',
  textDim: '#575757',
  /** User-picked. Buttons, highlights, the active chip — never data. */
  get accent(): string {
    return currentAccent();
  },
  /** Text drawn on the accent: black or white, whichever reads. */
  get onAccent(): string {
    return currentOnAccent();
  },
  /** The whistle's gunmetal. */
  gunmetal: '#262a32',
  win: '#4ade80',
  loss: '#ff4d6d',
  /** Questionable / doubtful. */
  warn: '#ffd95e',
  danger: '#ff4d6d',
};

export const fonts = {
  /** Section labels and headers only. Never body text. */
  pixel: 'Silkscreen_400Regular',
  pixelBold: 'Silkscreen_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
};

export const spacing = { xs: 4, sm: 8, md: 14, lg: 20, xl: 28 };

export const radius = { sm: 6, md: 9, lg: 12, pill: 20 };

/** Keeps lines readable in landscape and on unfolded screens. */
export const CONTENT_MAX_WIDTH = 640;

/** Injury tag colour: red for out-type statuses, yellow for maybes. */
export function injuryColor(status: string): string {
  return /^(o|out|ir|injur|pup|sus|nfi|dl|il)/i.test(status) ? colors.loss : colors.warn;
}

/**
 * Styles that read the accent, rebuilt when it changes.
 *
 * `StyleSheet.create` runs once at import, so `{ color: colors.accent }` would
 * keep the launch colour forever. This defers the factory to first use and
 * rebuilds on the first use after a change — 128BIT FIT's approach.
 */
export function themedStyles<T extends object>(factory: () => T): T {
  let built: T | null = null;
  let builtFor = -1;
  const current = (): T => {
    if (!built || builtFor !== accentVersion()) {
      built = factory();
      builtFor = accentVersion();
    }
    return built;
  };
  return new Proxy({} as T, {
    get: (_t, key) => current()[key as keyof T],
    has: (_t, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_t, key) => {
      const d = Object.getOwnPropertyDescriptor(current(), key);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}
