/**
 * Design tokens — the 128bit family look, matched to 128BIT FIT's.
 *
 * Monochrome on black, pixel type for labels, Inter for body. Colour means
 * something: the accent is the whistle's teal (actions, the active tab,
 * Coaches Corner); win / loss / injury get their own fixed colours and never
 * the accent.
 */
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
  /** The whistle's teal. Buttons, highlights, the active tab — never data. */
  accent: '#26d3c3',
  onAccent: '#0f1f45',
  /** The whistle's navy outline. */
  navy: '#0f1f45',
  win: '#26d3c3',
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
