import type { Bet, Contestant, Player, Room } from "./types";

/** Shape stored in the Realtime Database: keyed maps instead of arrays for concurrent writes. */
export type RoomPayload = Omit<Room, "players" | "contestants" | "currentRace"> & {
  players: Record<string, Player>;
  contestants: Record<string, Contestant>;
  currentRace: Omit<Room["currentRace"], "bets"> & { bets: Record<string, Bet> };
};

/** The Realtime Database rejects `undefined`; drop those keys recursively. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)]),
    ) as T;
  }
  return value;
}

const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((item) => [item.id, item])) as Record<string, T>;

export function toRoomPayload(room: Room): RoomPayload {
  return stripUndefined({
    ...room,
    players: byId(room.players),
    contestants: byId(room.contestants),
    currentRace: { ...room.currentRace, bets: byId(room.currentRace.bets) },
  });
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as object).filter((key) => (a as Record<string, unknown>)[key] !== undefined);
  const bKeys = Object.keys(b as object).filter((key) => (b as Record<string, unknown>)[key] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

export type RoomPatch = Record<string, unknown>;

function diffKeyed(
  prefix: string,
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  patch: RoomPatch,
) {
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (!deepEqual(prev[key], next[key])) patch[`${prefix}/${key}`] = next[key] ?? null;
  }
}

/**
 * Computes a minimal multi-location update for `update(ref(db, "rooms/<id>"), patch)`.
 *
 * Writing the whole room with `set()` would silently erase anything another device wrote in the
 * meantime (for example a participant's bet arriving while the host renames the room). By only
 * touching the paths that actually changed, concurrent writes to sibling keys survive.
 *
 * - players and bets are diffed per record, so one person's change never rewrites another's;
 * - a new race (different id) replaces `currentRace` wholesale, which is intended;
 * - other top-level values are replaced when they differ.
 */
export function buildRoomPatch(prevRoom: Room, nextRoom: Room): RoomPatch {
  const prev = toRoomPayload(prevRoom) as unknown as Record<string, unknown>;
  const next = toRoomPayload(nextRoom) as unknown as Record<string, unknown>;
  const patch: RoomPatch = {};

  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (key === "updatedAt") continue;
    if (key === "players") {
      diffKeyed(
        "players",
        prev.players as Record<string, unknown>,
        next.players as Record<string, unknown>,
        patch,
      );
      continue;
    }
    if (key === "currentRace") {
      const prevRace = prev.currentRace as Record<string, unknown>;
      const nextRace = next.currentRace as Record<string, unknown>;
      if (prevRace.id !== nextRace.id) {
        patch.currentRace = nextRace;
        continue;
      }
      for (const raceKey of new Set([...Object.keys(prevRace), ...Object.keys(nextRace)])) {
        if (raceKey === "bets") {
          diffKeyed(
            "currentRace/bets",
            prevRace.bets as Record<string, unknown>,
            nextRace.bets as Record<string, unknown>,
            patch,
          );
        } else if (!deepEqual(prevRace[raceKey], nextRace[raceKey])) {
          patch[`currentRace/${raceKey}`] = nextRace[raceKey] ?? null;
        }
      }
      continue;
    }
    if (!deepEqual(prev[key], next[key])) patch[key] = next[key] ?? null;
  }

  if (Object.keys(patch).length) patch.updatedAt = nextRoom.updatedAt;
  return patch;
}
