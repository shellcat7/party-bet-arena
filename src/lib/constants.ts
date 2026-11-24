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
export const ACCENTS = [
  "#ff4c69",
  "#3568ff",
  "#f2c114",
  "#25bf45",
  "#9d7cff",
  "#ff8f3f",
  "#14b8c4",
  "#e255c8",
];

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
