import { LIMITS } from "./constants";
import { createId } from "./ids";
import {
  getBetPickIds,
  getEffectiveMultiplier,
  isBetTypeAvailable,
  isValidStake,
  requiredPickCount,
  resolvePicks,
} from "./odds";
import type { BetType, Player, RaceBetResult, RaceHistoryEntry, RacePayout, RaceStatus, Room } from "./types";

export function isBetHit(type: BetType, contestantIds: string[], resultIds: string[]) {
  if (!contestantIds.length) return false;
  const position = resultIds.indexOf(contestantIds[0]);
  if (position < 0) return false;
  if (type === "win") return position === 0;
  if (type === "place") return position <= 2;
  const needed = requiredPickCount(type);
  if (contestantIds.length < needed) return false;
  return contestantIds.slice(0, needed).every((id, index) => resultIds[index] === id);
}

export function raceLabel(number: number) {
  return `第${number}レース`;
}

/** A result is complete when every racer has a unique finishing position. */
export function isCompleteResult(room: Room, resultIds: string[]) {
  if (resultIds.length !== room.contestants.length) return false;
  const ids = new Set(room.contestants.map((contestant) => contestant.id));
  return new Set(resultIds).size === resultIds.length && resultIds.every((id) => ids.has(id));
}

export function setRaceStatus(room: Room, status: RaceStatus, now = Date.now()): Room {
  return { ...room, currentRace: { ...room.currentRace, status }, updatedAt: now };
}

/**
 * Applies a finishing order to the current race.
 *
 * Every stake is deducted and winning tickets are credited `floor(stake × multiplier)`.
 * The multiplier is recomputed here from the closed pool; any value stored on a ticket is
 * ignored so a participant cannot inflate their own payout. Malformed tickets are recorded
 * with a zero result rather than aborting the whole settlement.
 */
export function settleRoom(room: Room, resultIds: string[], now = Date.now()): Room {
  const betResults: RaceBetResult[] = [];
  const payouts: RacePayout[] = [];

  const players = room.players.map((player) => {
    const summary: RacePayout = {
      playerId: player.id,
      stake: 0,
      payout: 0,
      delta: 0,
      balanceAfter: player.balance,
      hits: 0,
    };
    let balance = player.balance;

    for (const bet of room.currentRace.bets.filter((item) => item.playerId === player.id)) {
      const pickIds = getBetPickIds(bet);
      const picks = resolvePicks(room, pickIds);
      const base = {
        id: bet.id,
        playerId: bet.playerId,
        contestantIds: pickIds,
        type: bet.type,
        amount: bet.amount,
        placedBy: bet.placedBy,
        createdAt: bet.createdAt,
      };

      if (
        !isValidStake(bet.amount) ||
        picks.length !== requiredPickCount(bet.type) ||
        !isBetTypeAvailable(bet.type, room.contestants.length)
      ) {
        betResults.push({ ...base, multiplier: 0, payout: 0, delta: 0, hit: false, voided: true });
        continue;
      }

      const multiplier = getEffectiveMultiplier(room, bet.type, picks);
      const hit = isBetHit(bet.type, pickIds, resultIds);
      const payout = hit ? Math.floor(bet.amount * multiplier) : 0;
      summary.stake += bet.amount;
      summary.payout += payout;
      summary.hits += hit ? 1 : 0;
      balance = balance - bet.amount + payout;
      if (!room.settings.allowDebt) balance = Math.max(0, balance);
      betResults.push({ ...base, multiplier, payout, delta: payout - bet.amount, hit });
    }

    summary.delta = balance - player.balance;
    summary.balanceAfter = balance;
    payouts.push(summary);
    return { ...player, balance };
  });

  const entry: RaceHistoryEntry = {
    raceId: room.currentRace.id,
    raceNumber: room.currentRace.number,
    raceTitle: room.currentRace.title,
    settledAt: now,
    resultIds: [...resultIds],
    contestants: room.contestants.map(({ id, name, odds, accent, icon, cpuLevel, isCpu }) => ({
      id,
      name,
      odds,
      accent,
      icon,
      cpuLevel,
      isCpu,
    })),
    bets: betResults.sort((a, b) => a.createdAt - b.createdAt),
    payouts,
  };

  return {
    ...room,
    players,
    raceHistory: [...room.raceHistory.filter((item) => item.raceId !== room.currentRace.id), entry].slice(
      -LIMITS.maxRaces,
    ),
    currentRace: { ...room.currentRace, status: "settled", resultIds: [...resultIds], settledAt: now },
    updatedAt: now,
  };
}

/** Payout rows the host would apply, without committing anything. */
export function previewSettlement(room: Room, resultIds: string[]) {
  return settleRoom(room, resultIds).raceHistory.at(-1)?.payouts ?? [];
}

export function isFinalRace(room: Room) {
  return room.currentRace.number >= room.settings.maxRaces;
}

export function isGameOver(room: Room) {
  return room.currentRace.status === "settled" && isFinalRace(room);
}

/*
 * Guarded transitions. Each returns null when the room is no longer in the state the caller saw
 * (another device or tab got there first), so online rooms can run them inside a database
 * transaction and abort instead of overwriting newer data.
 */

export function closeBetting(room: Room, raceId: string, now = Date.now()): Room | null {
  if (room.currentRace.id !== raceId || room.currentRace.status !== "betting") return null;
  return setRaceStatus(room, "closed", now);
}

export function reopenBetting(room: Room, raceId: string, now = Date.now()): Room | null {
  if (room.currentRace.id !== raceId || room.currentRace.status !== "closed") return null;
  return setRaceStatus(room, "betting", now);
}

/** Closes (if needed) and settles in one step, from exactly the pool the server holds. */
export function settleRace(room: Room, raceId: string, resultIds: string[], now = Date.now()): Room | null {
  if (room.currentRace.id !== raceId || room.currentRace.status === "settled") return null;
  if (!isCompleteResult(room, resultIds)) return null;
  return settleRoom(setRaceStatus(room, "closed", now), resultIds, now);
}

export function advanceRace(room: Room, raceId: string, now = Date.now()): Room | null {
  if (room.currentRace.id !== raceId || room.currentRace.status !== "settled" || isFinalRace(room))
    return null;
  return startNextRace(room, now);
}

export function startNextRace(room: Room, now = Date.now()): Room {
  const number = Math.min(room.settings.maxRaces, room.currentRace.number + 1);
  return {
    ...room,
    currentRace: {
      id: createId("race"),
      number,
      title: raceLabel(number),
      status: "betting",
      startedAt: now,
      endsAt: now,
      bets: [],
      resultIds: [],
    },
    updatedAt: now,
  };
}

export type RankedPlayer = { player: Player; rank: number };

/** Standard competition ranking ("1224"): tied balances share a rank. */
export function rankPlayers(players: Player[]): RankedPlayer[] {
  const sorted = [...players].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  let previousBalance: number | undefined;
  let previousRank = 0;
  return sorted.map((player, index) => {
    const rank = player.balance === previousBalance ? previousRank : index + 1;
    previousBalance = player.balance;
    previousRank = rank;
    return { player, rank };
  });
}

/**
 * Rank movement since the previous settled race (positive = climbed).
 * Players who had no row in that race are compared against the starting balance.
 */
export function rankMovement(room: Room): Map<string, number> {
  const movement = new Map<string, number>();
  if (room.raceHistory.length < 2) return movement;
  const previous = room.raceHistory.at(-2)!;
  const previousBalances = room.players.map((player) => ({
    ...player,
    balance: previous.payouts.find((row) => row.playerId === player.id)?.balanceAfter ?? room.startingBalance,
  }));
  const before = new Map(rankPlayers(previousBalances).map(({ player, rank }) => [player.id, rank]));
  for (const { player, rank } of rankPlayers(room.players)) {
    movement.set(player.id, (before.get(player.id) ?? rank) - rank);
  }
  return movement;
}

/** Balance after each settled race, starting from the room's starting balance. */
export function balanceSeries(room: Room, playerId: string) {
  const series = [room.startingBalance];
  for (const entry of room.raceHistory) {
    const row = entry.payouts.find((payout) => payout.playerId === playerId);
    series.push(row ? row.balanceAfter : series[series.length - 1]);
  }
  return series;
}

export type GameHighlights = {
  biggestWin?: { playerId: string; raceNumber: number; payout: number; type: BetType; multiplier: number };
  sharpshooter?: { playerId: string; hits: number; tickets: number };
  favouriteWinner?: { contestantId: string; name: string; icon: string; wins: number };
};

/** Fun facts for the final results screen. */
export function gameHighlights(room: Room): GameHighlights {
  const highlights: GameHighlights = {};
  const hitsByPlayer = new Map<string, { hits: number; tickets: number }>();
  const winsByContestant = new Map<string, { name: string; icon: string; wins: number }>();

  for (const entry of room.raceHistory) {
    for (const bet of entry.bets) {
      const stats = hitsByPlayer.get(bet.playerId) ?? { hits: 0, tickets: 0 };
      stats.tickets += 1;
      stats.hits += bet.hit ? 1 : 0;
      hitsByPlayer.set(bet.playerId, stats);
      if (bet.hit && bet.payout > (highlights.biggestWin?.payout ?? 0)) {
        highlights.biggestWin = {
          playerId: bet.playerId,
          raceNumber: entry.raceNumber,
          payout: bet.payout,
          type: bet.type,
          multiplier: bet.multiplier,
        };
      }
    }
    const winnerId = entry.resultIds[0];
    const winner = entry.contestants.find((contestant) => contestant.id === winnerId);
    if (winner) {
      const stats = winsByContestant.get(winner.id) ?? { name: winner.name, icon: winner.icon, wins: 0 };
      stats.wins += 1;
      winsByContestant.set(winner.id, stats);
    }
  }

  for (const [playerId, stats] of hitsByPlayer) {
    const best = highlights.sharpshooter;
    if (
      stats.hits > 0 &&
      (!best ||
        stats.hits > best.hits ||
        (stats.hits === best.hits && stats.hits / stats.tickets > best.hits / best.tickets))
    ) {
      highlights.sharpshooter = { playerId, ...stats };
    }
  }
  for (const [contestantId, stats] of winsByContestant) {
    if (!highlights.favouriteWinner || stats.wins > highlights.favouriteWinner.wins) {
      highlights.favouriteWinner = { contestantId, ...stats };
    }
  }
  return highlights;
}
