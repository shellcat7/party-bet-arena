import { LegacyRoomError, normalizeRoom } from "./room";
import type { AppRole, LanguageName, Room } from "./types";

/**
 * Everything the app keeps on the device. Values are versioned by key name and parsed
 * defensively: storage can be full, disabled (private browsing) or edited by hand.
 */
const KEYS = {
  legacyRoom: "party-bet-arena:room",
  roomPrefix: "party-bet-arena:room:",
  session: "party-bet-arena:session",
  preferences: "party-bet-arena:preferences",
  summaries: "party-bet-arena:room-summaries",
  deleted: "party-bet-arena:deleted-room-ids",
} as const;

function read(key: string) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Quota exceeded or storage disabled: the app keeps working from memory.
  }
}

function remove(key: string) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // ignore
  }
}

function readJson<T>(key: string): T | undefined {
  const stored = read(key);
  if (!stored) return undefined;
  try {
    return JSON.parse(stored) as T;
  } catch {
    return undefined;
  }
}

/* ----------------------------------------------------------------------------- preferences */

const SUPPORTED_LANGUAGES: LanguageName[] = ["ja", "en", "zh", "ko", "es", "fr", "de", "it", "uk"];

export type ThemePreference = "system" | "light" | "dark";
export type Preferences = { language: LanguageName; theme: ThemePreference };

function detectLanguage(): LanguageName {
  for (const tag of globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? "ja"]) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED_LANGUAGES.includes(base as LanguageName)) return base as LanguageName;
  }
  return "en";
}

export function loadPreferences(): Preferences {
  const stored = readJson<Partial<Preferences>>(KEYS.preferences);
  const legacy = readJson<{ language?: string }>(KEYS.session);
  const language = stored?.language ?? legacy?.language;
  return {
    language: SUPPORTED_LANGUAGES.includes(language as LanguageName) ? (language as LanguageName) : detectLanguage(),
    theme: stored?.theme === "light" || stored?.theme === "dark" ? stored.theme : "system",
  };
}

export function savePreferences(preferences: Preferences) {
  write(KEYS.preferences, JSON.stringify(preferences));
}

/* --------------------------------------------------------------------------------- session */

/** Which room this device last had open, and in which role. */
export type Session = { roomId: string; role: AppRole; playerId?: string };

export function loadSession(): Session | undefined {
  const stored = readJson<Partial<Session>>(KEYS.session);
  if (!stored?.roomId) return undefined;
  return {
    roomId: stored.roomId,
    role: stored.role === "player" ? "player" : "host",
    ...(stored.playerId ? { playerId: stored.playerId } : {}),
  };
}

export function saveSession(session: Session | undefined) {
  if (session) write(KEYS.session, JSON.stringify(session));
  else remove(KEYS.session);
}

/* ---------------------------------------------------------------------------- room records */

/**
 * Full room snapshots are kept for rooms that live only on this device (demo / no Firebase)
 * and, temporarily, for online rooms whose latest change has not been confirmed by the server.
 */
export function saveRoomSnapshot(room: Room) {
  write(KEYS.roomPrefix + room.id, JSON.stringify(room));
}

export function loadRoomSnapshot(roomId: string): Room | undefined {
  migrateLegacySnapshot();
  const stored = readJson<unknown>(KEYS.roomPrefix + roomId);
  if (!stored) return undefined;
  try {
    return normalizeRoom(stored);
  } catch {
    return undefined;
  }
}

/** Removes a cached copy once the server has confirmed a version at least as new. */
export function clearRoomSnapshot(roomId: string, confirmedUpdatedAt?: number) {
  const cached = readJson<Partial<Room>>(KEYS.roomPrefix + roomId);
  if (!cached) return;
  if (confirmedUpdatedAt !== undefined && (cached.updatedAt ?? Infinity) > confirmedUpdatedAt) return;
  remove(KEYS.roomPrefix + roomId);
}

/**
 * Older builds kept a single full-room record. Current-schema rooms are moved to the keyed
 * store; legacy-schema records are left untouched in case they hold unsynced data.
 */
function migrateLegacySnapshot() {
  const stored = readJson<unknown>(KEYS.legacyRoom);
  if (!stored) return;
  try {
    const room = normalizeRoom(stored);
    if (!read(KEYS.roomPrefix + room.id)) saveRoomSnapshot(room);
    remove(KEYS.legacyRoom);
  } catch (error) {
    if (!(error instanceof LegacyRoomError)) remove(KEYS.legacyRoom);
  }
}

/* ------------------------------------------------------------------------------- summaries */

/** Lightweight list for the launcher. Never contains invitation codes or balances. */
export type RoomSummary = {
  id: string;
  schemaVersion: 2;
  name: string;
  role: AppRole;
  isLocal: boolean;
  currentRaceNumber: number;
  maxRaces: number;
  status: Room["currentRace"]["status"];
  updatedAt: number;
};

export function loadRoomSummaries(): RoomSummary[] {
  const parsed = readJson<Array<Partial<RoomSummary>>>(KEYS.summaries);
  if (!Array.isArray(parsed)) return [];
  const deleted = new Set(loadDeletedRoomIds());
  const summaries = parsed
    .filter((item): item is RoomSummary =>
      Boolean(
        item && item.id && item.name !== undefined && item.schemaVersion === 2 && !deleted.has(item.id),
      ),
    )
    .map(({ id, schemaVersion, name, role, isLocal, currentRaceNumber, maxRaces, status, updatedAt }) => ({
      id,
      schemaVersion,
      name,
      role: role === "player" ? ("player" as const) : ("host" as const),
      isLocal: Boolean(isLocal),
      currentRaceNumber: Number(currentRaceNumber) || 1,
      maxRaces: Number(maxRaces) || 1,
      status: status ?? "betting",
      updatedAt: Number(updatedAt) || 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  write(KEYS.summaries, JSON.stringify(summaries));
  return summaries;
}

export function rememberRoom(room: Room, role: AppRole, isLocal: boolean): RoomSummary[] {
  if (room.isDemo) return loadRoomSummaries();
  restoreRoom(room.id);
  const summary: RoomSummary = {
    id: room.id,
    schemaVersion: 2,
    name: room.name.trim() || room.id,
    role,
    isLocal,
    currentRaceNumber: room.currentRace.number,
    maxRaces: room.settings.maxRaces,
    status: room.currentRace.status,
    updatedAt: room.updatedAt,
  };
  const next = [summary, ...loadRoomSummaries().filter((item) => item.id !== room.id)].slice(0, 12);
  write(KEYS.summaries, JSON.stringify(next));
  return next;
}

export function forgetRoom(roomId: string): RoomSummary[] {
  const deleted = [roomId, ...loadDeletedRoomIds().filter((id) => id !== roomId)].slice(0, 40);
  write(KEYS.deleted, JSON.stringify(deleted));
  remove(KEYS.roomPrefix + roomId);
  const session = loadSession();
  if (session?.roomId === roomId) saveSession(undefined);
  return loadRoomSummaries();
}

function restoreRoom(roomId: string) {
  const deleted = loadDeletedRoomIds();
  if (deleted.includes(roomId)) write(KEYS.deleted, JSON.stringify(deleted.filter((id) => id !== roomId)));
}

export function isRoomForgotten(roomId: string) {
  return loadDeletedRoomIds().includes(roomId);
}

function loadDeletedRoomIds(): string[] {
  const parsed = readJson<unknown[]>(KEYS.deleted);
  return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
}
