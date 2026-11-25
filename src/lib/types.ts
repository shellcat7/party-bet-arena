export type BetType = "win" | "place" | "exacta" | "trifecta";

/**
 * Race lifecycle: `betting` → `closed` (no new bets) → `settled` (payouts applied).
 * Realtime Database rules only accept participant bets while the race is `betting`,
 * so closing the race freezes the pool before the host computes payouts.
 */
export type RaceStatus = "betting" | "closed" | "settled";

/** Stored on the room for backwards compatibility; display theme is now a per-device preference. */
export type ThemeName = "arena" | "neon";
export type LanguageName = "ja" | "en" | "zh" | "ko" | "es" | "fr" | "de" | "it" | "uk";
export type AppRole = "host" | "player";

export type RoomSettings = {
  maxPlayers: number;
  maxContestants: number;
  autoOdds: boolean;
  marketOdds: boolean;
  allowDebt: boolean;
  maxRaces: number;
  specialBonus: number;
};

/** A bettor: someone who predicts results and holds play coins. */
export type Player = {
  id: string;
  uid?: string;
  name: string;
  balance: number;
  /** True when the host places bets on this person's behalf (no phone). */
  isOffline: boolean;
  accent: string;
  emoji: string;
  /** Keeps display order stable: the database returns keyed records sorted by key, not insertion. */
  joinedAt?: number;
};

/** A racer: a person or CPU who competes in each race. */
export type Contestant = {
  id: string;
  name: string;
  odds: number;
  accent: string;
  icon: string;
  cpuLevel: number;
  isCpu: boolean;
  /** Post position; the database returns keyed records sorted by key, not insertion. */
  order?: number;
};

export type Bet = {
  id: string;
  uid?: string;
  playerId: string;
  contestantId: string;
  contestantIds: string[];
  type: BetType;
  amount: number;
  /** Never trusted: settlement always recomputes the multiplier. */
  multiplier?: number;
  placedBy: "self" | "host";
  createdAt: number;
};

export type Race = {
  id: string;
  /** 1-based race number within the room. */
  number: number;
  /** Legacy display title ("第1レース"); kept so older clients keep rendering. */
  title: string;
  status: RaceStatus;
  startedAt: number;
  endsAt: number;
  bets: Bet[];
  resultIds: string[];
  settledAt?: number;
};

export type RacePayout = {
  playerId: string;
  stake: number;
  payout: number;
  delta: number;
  balanceAfter: number;
  hits: number;
};

export type RaceContestantSnapshot = Pick<
  Contestant,
  "id" | "name" | "odds" | "accent" | "icon" | "cpuLevel" | "isCpu"
>;

export type RaceBetResult = {
  id: string;
  playerId: string;
  contestantIds: string[];
  type: BetType;
  amount: number;
  multiplier: number;
  payout: number;
  delta: number;
  hit: boolean;
  /** Refunded without effect: malformed, or a ticket type the final field made impossible to lose. */
  voided?: boolean;
  placedBy: "self" | "host";
  createdAt: number;
};

export type RaceHistoryEntry = {
  raceId: string;
  raceNumber: number;
  raceTitle: string;
  settledAt: number;
  resultIds: string[];
  contestants: RaceContestantSnapshot[];
  bets: RaceBetResult[];
  payouts: RacePayout[];
};

export type Room = {
  id: string;
  schemaVersion: 2;
  hostUid?: string;
  /** Shown on the invitation so guests know who is running the room. */
  hostName?: string;
  name: string;
  isDemo: boolean;
  joinCode: string;
  theme: ThemeName;
  startingBalance: number;
  settings: RoomSettings;
  players: Player[];
  contestants: Contestant[];
  currentRace: Race;
  raceHistory: RaceHistoryEntry[];
  createdAt: number;
  updatedAt: number;
};

export type DraftBet = {
  uid?: string;
  playerId: string;
  contestantIds: string[];
  type: BetType;
  amount: number;
  placedBy: "self" | "host";
};
