/** Product limits shared by the UI, the domain logic and the Realtime Database rules. */
export const LIMITS = {
  maxBettors: 8,
  maxContestants: 8,
  minContestants: 2,
  maxRaces: 20,
  minRating: 1,
  maxRating: 11,
  maxStake: 1_000_000_000,
  maxStartingBalance: 1_000_000_000,
  maxNameLength: 40,
  maxRoomNameLength: 40,
  minOdds: 1.1,
  maxOdds: 99,
} as const;

export const DEMO_ROOM_ID = "DEMO42";
export const DEMO_JOIN_CODE = "2468";

/**
 * Bettor colours double as chart series colours, so they follow a categorical order validated
 * for colour-vision deficiency (adjacent ΔE ≥ 8) in both themes. Dark-mode steps live in CSS.
 */
export const PLAYER_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
];

/** First palette slot not already used, so colours stay unique as people join and leave. */
export function nextPlayerColor(used: string[]) {
  return (
    PLAYER_COLORS.find((color) => !used.includes(color)) ?? PLAYER_COLORS[used.length % PLAYER_COLORS.length]
  );
}

/** Racer "gate" colours, like the coloured post positions at a race track. */
/**
 * Gate colours (枠色) as used in horse racing: 1 white, 2 black, 3 red, 4 blue, 5 yellow, 6 green,
 * 7 orange, 8 pink. A racer's colour follows its lane number, so the colours carry meaning rather
 * than being a decorative rainbow; past eight they repeat.
 */
export const FRAME_COLORS = [
  "#f6f5f0",
  "#1c1d21",
  "#d8352a",
  "#1d5fc0",
  "#f6c500",
  "#14894a",
  "#ee8017",
  "#f096b4",
];

export function frameColor(lane: number) {
  const index = Math.max(1, Math.floor(lane) || 1) - 1;
  return FRAME_COLORS[index % FRAME_COLORS.length];
}

/**
 * Avatar colours: one muted family (similar lightness and chroma in OKLCH) so that several
 * on screen at once stay calm. White text reads on all of them except amber, which takes dark ink.
 */
export const ACCENTS = [
  "#b4514e",
  "#4572b4",
  "#e1b761",
  "#428557",
  "#7966ae",
  "#ad5f30",
  "#2e828b",
  "#a4587d",
];

/** Saved rooms still carry the earlier, saturated colours; they are shown in the new family. */
const LEGACY_ACCENTS: Record<string, string> = {
  "#ff4c69": "#b4514e",
  "#3568ff": "#4572b4",
  "#f2c114": "#e1b761",
  "#25bf45": "#428557",
  "#9d7cff": "#7966ae",
  "#ff8f3f": "#ad5f30",
  "#14b8c4": "#2e828b",
  "#e255c8": "#a4587d",
};

export function displayAccent(accent: string) {
  return LEGACY_ACCENTS[accent.toLowerCase()] ?? accent;
}

/** Text colour for a label on an accent: white, or dark ink on light accents. */
export function accentInk(accent: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(accent.trim());
  if (!match) return "#ffffff";
  const channel = (offset: number) => {
    const value = parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.36 ? "#15171b" : "#ffffff";
}

export const EMOJI_CHOICES = [
  "😀",
  "😎",
  "🥳",
  "🎮",
  "🎲",
  "🎯",
  "🏆",
  "👑",
  "🔥",
  "⚡",
  "🌟",
  "⭐",
  "🍀",
  "🌈",
  "🍭",
  "🎤",
  "🎧",
  "🚗",
  "🏎️",
  "🚀",
  "🛡️",
  "💎",
  "🤖",
  "🍄",
];

export function pickAccent(index: number) {
  return ACCENTS[((index % ACCENTS.length) + ACCENTS.length) % ACCENTS.length];
}

export function pickEmoji(index: number) {
  return EMOJI_CHOICES[((index % EMOJI_CHOICES.length) + EMOJI_CHOICES.length) % EMOJI_CHOICES.length];
}
