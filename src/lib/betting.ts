import { createId } from "./ids";
import { getEffectiveMultiplier, isValidStake, requiredPickCount, resolvePicks } from "./odds";
import type { Bet, DraftBet, Player, Room } from "./types";

export type BetError =
  | "betting-closed"
  | "no-player"
  | "already-placed"
  | "no-pick"
  | "incomplete-pick"
  | "duplicate-pick"
  | "unknown-pick"
  | "invalid-amount"
  | "insufficient-balance";

export function getPlayer(room: Room, playerId: string | undefined): Player | undefined {
  return playerId ? room.players.find((player) => player.id === playerId) : undefined;
}

export function getPlayerBets(room: Room, playerId: string) {
  return room.currentRace.bets.filter((bet) => bet.playerId === playerId);
}

/** Coins already committed to unsettled tickets in the current race. */
export function getReservedAmount(room: Room, playerId: string) {
  if (room.currentRace.status === "settled") return 0;
  return getPlayerBets(room, playerId)
    .filter((bet) => isValidStake(bet.amount))
    .reduce((sum, bet) => sum + bet.amount, 0);
}

/** Balance minus coins reserved by open tickets. Never negative. */
export function getAvailableBalance(room: Room, playerId: string) {
  const player = getPlayer(room, playerId);
  if (!player) return 0;
  return Math.max(0, player.balance - getReservedAmount(room, playerId));
}

export function getDraftMultiplier(room: Room, draft: Pick<DraftBet, "type" | "contestantIds">) {
  const picks = resolvePicks(room, draft.contestantIds);
  if (picks.length !== requiredPickCount(draft.type)) return 0;
  return getEffectiveMultiplier(room, draft.type, picks);
}

export function getPotentialPayout(room: Room, draft: Pick<DraftBet, "type" | "contestantIds" | "amount">) {
  const multiplier = getDraftMultiplier(room, draft);
  return isValidStake(draft.amount) ? Math.floor(draft.amount * multiplier) : 0;
}

/**
 * Participants may hold one self-placed ticket per race (the database key is their player id).
 * The host can enter any number of proxy tickets for people without a phone.
 */
export function hasSelfBet(room: Room, playerId: string) {
  return room.currentRace.bets.some((bet) => bet.playerId === playerId && bet.placedBy === "self");
}

export function validateBet(room: Room, draft: DraftBet): BetError | null {
  if (room.currentRace.status !== "betting") return "betting-closed";
  if (!getPlayer(room, draft.playerId)) return "no-player";
  if (draft.placedBy === "self" && room.currentRace.bets.some((bet) => bet.playerId === draft.playerId)) {
    return "already-placed";
  }
  if (!draft.contestantIds.length) return "no-pick";
  if (draft.contestantIds.length !== requiredPickCount(draft.type)) return "incomplete-pick";
  if (new Set(draft.contestantIds).size !== draft.contestantIds.length) return "duplicate-pick";
  if (resolvePicks(room, draft.contestantIds).length !== draft.contestantIds.length) return "unknown-pick";
  if (!isValidStake(draft.amount)) return "invalid-amount";
  if (!room.settings.allowDebt && draft.amount > getAvailableBalance(room, draft.playerId)) {
    return "insufficient-balance";
  }
  return null;
}

export function createBet(draft: DraftBet, now = Date.now()): Bet {
  const bet: Bet = {
    // A participant's own ticket is keyed by their player id so the database rules can
    // enforce "one self bet per race" without a server.
    id: draft.placedBy === "self" ? draft.playerId : createId("bet"),
    playerId: draft.playerId,
    contestantId: draft.contestantIds[0],
    contestantIds: [...draft.contestantIds],
    type: draft.type,
    amount: draft.amount,
    placedBy: draft.placedBy,
    createdAt: now,
  };
  if (draft.uid) bet.uid = draft.uid;
  return bet;
}

export function addBet(room: Room, bet: Bet, now = Date.now()): Room {
  return {
    ...room,
    currentRace: { ...room.currentRace, bets: [...room.currentRace.bets, bet] },
    updatedAt: now,
  };
}
