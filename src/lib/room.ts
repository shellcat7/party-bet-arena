import { addBet, createBet } from "./betting";
import {
  DEMO_JOIN_CODE,
  DEMO_ROOM_ID,
  LIMITS,
  nextPlayerColor,
  pickAccent,
  pickEmoji,
  PLAYER_COLORS,
} from "./constants";
import { createId, createJoinCode, createRoomId } from "./ids";
import { calculateAutoOdds, clampOdds, clampRating, isBetTypeAvailable } from "./odds";
import { raceLabel, settleRoom, startNextRace } from "./settlement";
import type {
  Bet,
  Contestant,
  LanguageName,
  Player,
  Race,
  RaceHistoryEntry,
  Room,
  RoomSettings,
} from "./types";

export type RoomCreateInput = {
  name: string;
  maxRaces: number;
  startingBalance: number;
  maxPlayers: number;
  contestantCount: number;
  autoOdds: boolean;
  marketOdds: boolean;
  allowDebt: boolean;
};

export const defaultCreateInput: RoomCreateInput = {
  name: "",
  maxRaces: 10,
  startingBalance: 1000,
  maxPlayers: 8,
  contestantCount: 4,
  autoOdds: true,
  marketOdds: true,
  allowDebt: false,
};

const clampInt = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;

export const clampRaceCount = (value: number) => clampInt(value, 1, LIMITS.maxRaces, 10);
export const clampBettorLimit = (value: number) => clampInt(value, 1, LIMITS.maxBettors, LIMITS.maxBettors);
export const clampContestantLimit = (value: number) =>
  clampInt(value, LIMITS.minContestants, LIMITS.maxContestants, LIMITS.maxContestants);
export const clampBalance = (value: number) => clampInt(value, 0, LIMITS.maxStartingBalance, 1000);

function createRace(number: number, now: number): Race {
  return {
    id: createId("race"),
    number,
    title: raceLabel(number),
    status: "betting",
    startedAt: now,
    endsAt: now,
    bets: [],
    resultIds: [],
  };
}

function defaultContestants(count: number): Contestant[] {
  const contestants = Array.from({ length: count }, (_, index): Contestant => {
    const isCpu = index > 0;
    return {
      id: createId("racer"),
      name: isCpu ? `CPU${index}` : "Player",
      odds: 2,
      accent: pickAccent(index),
      icon: ["👑", "🤖", "⚡", "🍀", "🚀", "🎯", "💎", "⭐"][index % 8],
      cpuLevel: isCpu ? Math.max(1, 9 - index + 1) : 8,
      isCpu,
      order: index,
    };
  });
  return calculateAutoOdds(contestants);
}

export function createRoom(input: RoomCreateInput, hostUid?: string, now = Date.now()): Room {
  const contestantCount = clampContestantLimit(input.contestantCount);
  const contestants = defaultContestants(contestantCount);
  const room: Room = {
    id: createRoomId(),
    schemaVersion: 2,
    name: input.name.trim().slice(0, LIMITS.maxRoomNameLength),
    isDemo: false,
    joinCode: createJoinCode(),
    theme: "arena",
    startingBalance: clampBalance(input.startingBalance),
    settings: {
      maxPlayers: clampBettorLimit(input.maxPlayers),
      maxContestants: LIMITS.maxContestants,
      autoOdds: input.autoOdds,
      marketOdds: input.marketOdds,
      allowDebt: input.allowDebt,
      maxRaces: clampRaceCount(input.maxRaces),
      specialBonus: 100,
    },
    players: [],
    contestants: input.autoOdds ? contestants : contestants.map((item) => ({ ...item, odds: 2 })),
    currentRace: createRace(1, now),
    raceHistory: [],
    createdAt: now,
    updatedAt: now,
  };
  if (hostUid) room.hostUid = hostUid;
  return room;
}

const demoCopy = {
  ja: {
    room: "週末ゲーム大会（デモ）",
    players: ["ゆうた", "たくみ", "あやか", "けんと"],
    racers: ["レッド", "ブルー", "イエロー", "グリーン"],
  },
  en: {
    room: "Weekend Game Night (demo)",
    players: ["Alex", "Sam", "Mia", "Ken"],
    racers: ["Red", "Blue", "Yellow", "Green"],
  },
} satisfies Record<LanguageName, { room: string; players: string[]; racers: string[] }>;

/**
 * A self-contained room for trying the app without Firebase or other devices.
 * Two races are already settled so rankings, history and charts have something to show.
 */
export function createDemoRoom(language: LanguageName = "ja", now = Date.now()): Room {
  const copy = demoCopy[language];
  const players: Player[] = copy.players.map((name, index) => ({
    id: `demo-player-${index + 1}`,
    name,
    balance: 1000,
    isOffline: index === 2,
    accent: PLAYER_COLORS[index],
    emoji: ["🎮", "😎", "🌟", "🚗"][index],
    joinedAt: now - 45 * 60_000 + index,
  }));
  const contestants = calculateAutoOdds(
    copy.racers.map((name, index): Contestant => ({
      id: `demo-racer-${index + 1}`,
      name,
      odds: 2,
      accent: pickAccent(index),
      icon: ["👑", "🤖", "⚡", "🍀"][index],
      cpuLevel: [8, 9, 7, 5][index],
      isCpu: index > 0,
      order: index,
    })),
  );
  const [red, blue, yellow, green] = contestants.map((contestant) => contestant.id);
  const minutesAgo = (minutes: number) => now - minutes * 60_000;

  let room: Room = {
    id: DEMO_ROOM_ID,
    schemaVersion: 2,
    name: copy.room,
    isDemo: true,
    joinCode: DEMO_JOIN_CODE,
    theme: "arena",
    startingBalance: 1000,
    settings: {
      maxPlayers: LIMITS.maxBettors,
      maxContestants: LIMITS.maxContestants,
      autoOdds: true,
      marketOdds: true,
      allowDebt: false,
      maxRaces: 5,
      specialBonus: 100,
    },
    players,
    contestants,
    currentRace: { ...createRace(1, minutesAgo(40)), id: "demo-race-1" },
    raceHistory: [],
    createdAt: minutesAgo(45),
    updatedAt: minutesAgo(40),
  };

  const script: Array<{
    tickets: Array<[playerIndex: number, type: Bet["type"], picks: string[], amount: number]>;
    result: string[];
    at: number;
  }> = [
    {
      tickets: [
        [0, "win", [blue], 200],
        [1, "place", [green], 150],
        [2, "exacta", [blue, red], 100],
        [3, "win", [yellow], 300],
      ],
      result: [blue, red, yellow, green],
      at: 30,
    },
    {
      tickets: [
        [0, "trifecta", [red, blue, yellow], 100],
        [1, "win", [green], 200],
        [2, "place", [red], 250],
        [3, "win", [blue], 400],
      ],
      result: [green, red, blue, yellow],
      at: 15,
    },
  ];

  script.forEach((race, raceIndex) => {
    race.tickets.forEach(([playerIndex, type, picks, amount], ticketIndex) => {
      const bet = createBet(
        {
          playerId: players[playerIndex].id,
          contestantIds: picks,
          type,
          amount,
          placedBy: playerIndex === 2 ? "host" : "self",
        },
        minutesAgo(race.at + 5 - ticketIndex),
      );
      room = addBet(room, { ...bet, id: `demo-bet-${raceIndex + 1}-${ticketIndex + 1}` });
    });
    room = settleRoom(
      { ...room, currentRace: { ...room.currentRace, status: "closed" } },
      race.result,
      minutesAgo(race.at),
    );
    room = startNextRace(room, minutesAgo(race.at - 1));
    room = { ...room, currentRace: { ...room.currentRace, id: `demo-race-${raceIndex + 2}` } };
  });

  const openTickets: Array<[number, Bet["type"], string[], number]> = [
    [0, "win", [red], 200],
    [3, "exacta", [blue, green], 100],
  ];
  openTickets.forEach(([playerIndex, type, picks, amount], index) => {
    const bet = createBet(
      { playerId: players[playerIndex].id, contestantIds: picks, type, amount, placedBy: "self" },
      minutesAgo(5 - index),
    );
    room = addBet(room, bet);
  });

  return { ...room, updatedAt: now };
}

/* ------------------------------------------------------------------------------------------------
 * Pure room mutations. Each returns a new Room; the controller decides how to persist it.
 * --------------------------------------------------------------------------------------------- */

const touch = (room: Room, now = Date.now()): Room => ({ ...room, updatedAt: now });

export function renameRoom(room: Room, name: string): Room {
  return touch({ ...room, name: name.slice(0, LIMITS.maxRoomNameLength) });
}

export type SettingsPatch = Partial<RoomSettings> & { startingBalance?: number };

/** Settings that change what a ticket pays; frozen once betting closes. */
const PAYOUT_SETTINGS = ["autoOdds", "marketOdds", "allowDebt"] as const;

const isBettingOpen = (room: Room) => room.currentRace.status === "betting";

export function updateSettings(room: Room, patch: SettingsPatch): Room {
  const { startingBalance, ...settingsPatch } = patch;
  if (!isBettingOpen(room)) for (const key of PAYOUT_SETTINGS) delete settingsPatch[key];
  const settings: RoomSettings = { ...room.settings, ...settingsPatch };
  settings.maxRaces = Math.max(clampRaceCount(settings.maxRaces), room.currentRace.number);
  settings.maxPlayers = Math.max(clampBettorLimit(settings.maxPlayers), Math.min(room.players.length, 8));
  settings.maxContestants = clampContestantLimit(settings.maxContestants);
  settings.specialBonus = clampInt(settings.specialBonus, 0, LIMITS.maxStake, 100);
  const next: Room = { ...room, settings };
  if (startingBalance !== undefined) next.startingBalance = clampBalance(startingBalance);
  if (settingsPatch.autoOdds === true && !room.settings.autoOdds) {
    next.contestants = calculateAutoOdds(room.contestants);
  }
  return touch(next);
}

export type NewPlayerInput = { name: string; emoji: string; isOffline: boolean; uid?: string; id?: string };

export function canAddPlayer(room: Room) {
  return room.players.length < room.settings.maxPlayers;
}

export function buildPlayer(room: Room, input: NewPlayerInput, now = Date.now()): Player {
  const player: Player = {
    id: input.id ?? createId("player"),
    name: input.name.trim().slice(0, LIMITS.maxNameLength),
    balance: room.startingBalance,
    isOffline: input.isOffline,
    accent: nextPlayerColor(room.players.map((item) => item.accent)),
    emoji: input.emoji || pickEmoji(room.players.length),
    joinedAt: now,
  };
  if (input.uid) player.uid = input.uid;
  return player;
}

export function addPlayer(room: Room, player: Player): Room {
  return touch({ ...room, players: [...room.players, player] });
}

export function updatePlayer(
  room: Room,
  playerId: string,
  patch: Partial<Pick<Player, "name" | "emoji" | "isOffline">>,
) {
  return touch({
    ...room,
    players: room.players.map((player) =>
      player.id === playerId
        ? { ...player, ...patch, name: (patch.name ?? player.name).slice(0, LIMITS.maxNameLength) }
        : player,
    ),
  });
}

/** Removes a bettor and their open tickets. Settled history is kept for the record. */
export function removePlayer(room: Room, playerId: string): Room {
  return touch({
    ...room,
    players: room.players.filter((player) => player.id !== playerId),
    currentRace: {
      ...room.currentRace,
      bets: room.currentRace.bets.filter((bet) => bet.playerId !== playerId),
    },
  });
}

/** Host-only correction for a mistaken ticket while betting is still open. */
export function removeBet(room: Room, betId: string): Room {
  if (room.currentRace.status !== "betting") return room;
  return touch({
    ...room,
    currentRace: { ...room.currentRace, bets: room.currentRace.bets.filter((bet) => bet.id !== betId) },
  });
}

export function grantBonus(room: Room, playerId: string, amount: number): Room {
  const value = clampInt(amount, 0, LIMITS.maxStake, 0);
  return touch({
    ...room,
    players: room.players.map((player) =>
      player.id === playerId ? { ...player, balance: player.balance + value } : player,
    ),
    settings: { ...room.settings, specialBonus: value },
  });
}

export type NewContestantInput = {
  name: string;
  icon: string;
  isCpu: boolean;
  cpuLevel: number;
  odds: number;
};

export function canAddContestant(room: Room) {
  return room.contestants.length < LIMITS.maxContestants && room.currentRace.status === "betting";
}

export function addContestant(room: Room, input: NewContestantInput): Room {
  const index = room.contestants.length;
  const contestant: Contestant = {
    id: createId("racer"),
    name:
      input.name.trim().slice(0, LIMITS.maxNameLength) ||
      (input.isCpu ? `CPU${index}` : `Player ${index + 1}`),
    odds: clampOdds(input.odds),
    accent: pickAccent(index),
    icon: input.icon,
    cpuLevel: clampRating(input.cpuLevel),
    isCpu: input.isCpu,
    order: Math.max(-1, ...room.contestants.map((item, position) => item.order ?? position)) + 1,
  };
  const contestants = [...room.contestants, contestant];
  return touch({
    ...room,
    contestants: room.settings.autoOdds ? calculateAutoOdds(contestants) : contestants,
  });
}

export function canRemoveContestant(room: Room) {
  return room.contestants.length > LIMITS.minContestants && room.currentRace.status === "betting";
}

/** Removing a racer voids every open ticket that includes them. */
export function removeContestant(room: Room, contestantId: string): Room {
  if (!canRemoveContestant(room)) return room;
  const contestants = room.contestants.filter((contestant) => contestant.id !== contestantId);
  return touch({
    ...room,
    contestants: room.settings.autoOdds ? calculateAutoOdds(contestants) : contestants,
    currentRace: {
      ...room.currentRace,
      // Void tickets on the removed racer, and tickets the smaller field makes impossible to lose.
      bets: room.currentRace.bets.filter(
        (bet) =>
          !(bet.contestantIds ?? [bet.contestantId]).includes(contestantId) &&
          isBetTypeAvailable(bet.type, contestants.length),
      ),
      resultIds: room.currentRace.resultIds.filter((id) => id !== contestantId),
    },
  });
}

export type ContestantPatch = Partial<Pick<Contestant, "name" | "icon" | "cpuLevel" | "isCpu">>;

export function updateContestant(room: Room, contestantId: string, patch: ContestantPatch): Room {
  const contestants = room.contestants.map((contestant) =>
    contestant.id === contestantId
      ? {
          ...contestant,
          ...patch,
          name: (patch.name ?? contestant.name).slice(0, LIMITS.maxNameLength),
          cpuLevel: clampRating(patch.cpuLevel ?? contestant.cpuLevel),
        }
      : contestant,
  );
  const affectsOdds = patch.cpuLevel !== undefined || patch.isCpu !== undefined;
  if (affectsOdds && !isBettingOpen(room)) return room;
  return touch({
    ...room,
    contestants: affectsOdds && room.settings.autoOdds ? calculateAutoOdds(contestants) : contestants,
  });
}

/** Manually editing odds switches the room to manual odds so the value sticks. */
export function setContestantOdds(room: Room, contestantId: string, odds: number): Room {
  if (!isBettingOpen(room)) return room;
  return touch({
    ...room,
    settings: { ...room.settings, autoOdds: false },
    contestants: room.contestants.map((contestant) =>
      contestant.id === contestantId ? { ...contestant, odds: clampOdds(odds) } : contestant,
    ),
  });
}

export function recalculateOdds(room: Room): Room {
  if (!isBettingOpen(room)) return room;
  return touch({
    ...room,
    settings: { ...room.settings, autoOdds: true },
    contestants: calculateAutoOdds(room.contestants),
  });
}

/* ------------------------------------------------------------------------------------------------
 * Normalisation of data read from localStorage or the Realtime Database.
 * --------------------------------------------------------------------------------------------- */

export class LegacyRoomError extends Error {
  constructor() {
    super("Unsupported legacy room schema");
    this.name = "LegacyRoomError";
  }
}

/** The Realtime Database stores arrays as keyed objects and drops empty collections. */
function toList<T extends { id: string }>(value: unknown): T[] {
  if (Array.isArray(value)) return value.filter(Boolean) as T[];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, Partial<T>>).map(
      ([id, item]) => ({ ...item, id: item.id ?? id }) as T,
    );
  }
  return [];
}

function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null) as T[];
  if (value && typeof value === "object") return Object.values(value as Record<string, T>);
  return [];
}

const finiteOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function parseRaceNumber(title: unknown, fallback: number) {
  const match = typeof title === "string" ? title.match(/\d+/) : null;
  return match ? Number(match[0]) : fallback;
}

/** Stable sort by an optional numeric key; records without one keep their relative order. */
function sortByKey<T>(items: T[], key: (item: T) => number | undefined) {
  return items
    .map((item, index) => ({ item, index, value: key(item) }))
    .sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity) || a.index - b.index)
    .map(({ item }) => item);
}

const legacyIcons: Record<string, string> = { sparkle: "👑", wave: "🤖", bolt: "⚡", leaf: "🍀" };

/**
 * Accepts loosely shaped data and returns a fully populated Room.
 * Live rooms never inherit demo data: an empty collection stays empty.
 */
export function normalizeRoom(input: unknown): Room {
  const raw = (input ?? {}) as Partial<Room> & Record<string, unknown>;
  const isDemo = raw.id === DEMO_ROOM_ID;
  if (!isDemo && raw.schemaVersion !== 2) throw new LegacyRoomError();

  const now = Date.now();
  const rawSettings = (raw.settings ?? {}) as Partial<RoomSettings>;
  const rawRace = (raw.currentRace ?? {}) as Partial<Race> & Record<string, unknown>;
  const history = toArray<Partial<RaceHistoryEntry>>(raw.raceHistory).map((entry, index) => ({
    raceId: String(entry.raceId ?? `race-history-${index}`),
    raceNumber: finiteOr(entry.raceNumber, parseRaceNumber(entry.raceTitle, index + 1)),
    raceTitle: String(entry.raceTitle ?? raceLabel(index + 1)),
    settledAt: finiteOr(entry.settledAt, now),
    resultIds: toArray<string>(entry.resultIds),
    contestants: toArray<RaceHistoryEntry["contestants"][number]>(entry.contestants),
    bets: toArray<RaceHistoryEntry["bets"][number]>(entry.bets).map((bet) => ({
      ...bet,
      contestantIds: toArray<string>(bet.contestantIds),
      amount: finiteOr(bet.amount, 0),
      multiplier: finiteOr(bet.multiplier, 0),
      payout: finiteOr(bet.payout, 0),
      delta: finiteOr(bet.delta, 0),
      hit: Boolean(bet.hit),
    })),
    payouts: toArray<RaceHistoryEntry["payouts"][number]>(entry.payouts).map((payout) => ({
      ...payout,
      stake: finiteOr(payout.stake, 0),
      payout: finiteOr(payout.payout, 0),
      delta: finiteOr(payout.delta, 0),
      balanceAfter: finiteOr(payout.balanceAfter, 0),
      hits: finiteOr(payout.hits, 0),
    })),
  }));

  const raceNumber = finiteOr(rawRace.number, parseRaceNumber(rawRace.title, history.length + 1));
  const status: Race["status"] =
    rawRace.status === "closed" || rawRace.status === "settled" ? rawRace.status : "betting";

  const players = sortByKey(
    toList<Player & { skillRating?: unknown }>(raw.players),
    (player) => player.joinedAt,
  ).map((player, index) => {
    const { skillRating: _legacy, ...clean } = player;
    return {
      ...clean,
      name: String(clean.name ?? ""),
      balance: finiteOr(clean.balance, 0),
      isOffline: Boolean(clean.isOffline),
      accent: clean.accent || PLAYER_COLORS[index % PLAYER_COLORS.length],
      emoji: clean.emoji || pickEmoji(index),
    };
  });

  const contestants = sortByKey(
    toList<Contestant & { strengthRating?: unknown }>(raw.contestants),
    (item) => item.order,
  ).map((contestant, index) => {
    const { strengthRating: _legacy, ...clean } = contestant;
    return {
      ...clean,
      name: String(clean.name ?? ""),
      odds: finiteOr(clean.odds, 2),
      accent: clean.accent || pickAccent(index),
      icon: legacyIcons[clean.icon] ?? (clean.icon || "🏁"),
      cpuLevel: clampRating(finiteOr(clean.cpuLevel, Math.max(1, 9 - index))),
      isCpu: clean.isCpu ?? index > 0,
    };
  });

  const room: Room = {
    id: String(raw.id ?? ""),
    schemaVersion: 2,
    name: String(raw.name ?? ""),
    isDemo,
    joinCode: String(raw.joinCode ?? ""),
    theme: raw.theme === "neon" ? "neon" : "arena",
    startingBalance: finiteOr(raw.startingBalance, 1000),
    settings: {
      maxPlayers: clampBettorLimit(finiteOr(rawSettings.maxPlayers, LIMITS.maxBettors)),
      maxContestants: clampContestantLimit(finiteOr(rawSettings.maxContestants, LIMITS.maxContestants)),
      autoOdds: rawSettings.autoOdds ?? true,
      marketOdds: rawSettings.marketOdds ?? false,
      allowDebt: rawSettings.allowDebt ?? false,
      maxRaces: Math.max(clampRaceCount(finiteOr(rawSettings.maxRaces, 10)), raceNumber),
      specialBonus: Math.max(0, Math.floor(finiteOr(rawSettings.specialBonus, 100))),
    },
    players,
    contestants,
    currentRace: {
      id: String(rawRace.id ?? createId("race")),
      number: raceNumber,
      title: typeof rawRace.title === "string" ? rawRace.title : raceLabel(raceNumber),
      status,
      startedAt: finiteOr(rawRace.startedAt, now),
      endsAt: finiteOr(rawRace.endsAt, finiteOr(rawRace.startedAt, now)),
      bets: toList<Bet>(rawRace.bets).map((bet) => ({
        ...bet,
        contestantIds: toArray<string>(bet.contestantIds).length
          ? toArray<string>(bet.contestantIds)
          : [bet.contestantId],
      })),
      resultIds: toArray<string>(rawRace.resultIds),
      ...(typeof rawRace.settledAt === "number" ? { settledAt: rawRace.settledAt } : {}),
    },
    raceHistory: history,
    createdAt: finiteOr(raw.createdAt, now),
    updatedAt: finiteOr(raw.updatedAt, now),
  };
  if (typeof raw.hostUid === "string") room.hostUid = raw.hostUid;
  return room;
}
