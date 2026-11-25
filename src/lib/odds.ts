import { LIMITS } from "./constants";
import type { Bet, BetType, Contestant, Room } from "./types";

/*
 * Odds model
 * ----------
 * Every ticket type is priced from one probability model so that no type is systematically a
 * better or worse deal than another:
 *
 * 1. Each racer has a strength. With automatic odds it comes from the racer's level; with manual
 *    odds it is implied by the win odds the host entered (strength ∝ 1 / odds).
 * 2. Finishing orders follow the Plackett–Luce model: the winner is drawn in proportion to
 *    strength, then second place from the remaining racers, and so on.
 * 3. A ticket pays `payout rate ÷ probability of the ticket hitting`, rounded down to 0.1.
 *
 * The payout rate (the share of stakes returned on average) is PAYOUT_RATE for automatic odds.
 * For manual odds it is whatever the host's win odds imply, so place and exotic tickets stay
 * consistent with the win market the host set.
 */

export const BET_TYPES: BetType[] = ["win", "place", "exacta", "trifecta"];

/** Share of stakes returned to bettors on average with automatic odds (a 10% "house" take). */
export const PAYOUT_RATE = 0.9;

/** Lowest computed multiplier: 1.0 returns the stake, as a race card shows for a heavy favourite. */
const MIN_MULTIPLIER = 1.0;
const MAX_MULTIPLIER: Record<BetType, number> = {
  win: LIMITS.maxOdds,
  place: 30,
  exacta: 300,
  trifecta: 1000,
};

export function requiredPickCount(type: BetType) {
  if (type === "exacta") return 2;
  if (type === "trifecta") return 3;
  return 1;
}

/**
 * A ticket type only makes sense when the field is big enough: with three or fewer racers a
 * "place" (top three) ticket could never lose, and a trifecta needs three finishers.
 */
export function isBetTypeAvailable(type: BetType, racerCount: number) {
  if (type === "place") return racerCount >= 4;
  if (type === "trifecta") return racerCount >= 3;
  return racerCount >= 2;
}

export function getBetPickIds(bet: Pick<Bet, "contestantId"> & Partial<Pick<Bet, "contestantIds">>) {
  return bet.contestantIds?.length ? bet.contestantIds : [bet.contestantId];
}

export function clampRating(value: number) {
  if (!Number.isFinite(value)) return 5;
  return Math.max(LIMITS.minRating, Math.min(LIMITS.maxRating, Math.floor(value)));
}

/** Odds are quoted to one decimal place and rounded down, as on a race card. */
export function roundOdds(value: number, type: BetType = "win") {
  if (!Number.isFinite(value)) return MIN_MULTIPLIER;
  const rounded = Math.floor(value * 10 + 1e-9) / 10;
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER[type], rounded));
}

/** Manually entered win odds: one decimal, within the supported range. */
export function clampOdds(value: number) {
  if (!Number.isFinite(value)) return LIMITS.minOdds;
  return Math.max(LIMITS.minOdds, Math.min(LIMITS.maxOdds, Math.round(value * 10) / 10));
}

export function formatOdds(value: number) {
  return value.toFixed(1);
}

/** Relative strength for a level from 1 to 11; each level is about 1.43× stronger than the last. */
export function levelStrength(level: number) {
  return Math.exp((clampRating(level || 5) - 5) * 0.36);
}

/** Win odds from levels: payout rate ÷ win probability. */
export function calculateAutoOdds(contestants: Contestant[]): Contestant[] {
  const strengths = contestants.map((contestant) => levelStrength(contestant.cpuLevel));
  const total = strengths.reduce((sum, value) => sum + value, 0) || 1;
  return contestants.map((contestant, index) => ({
    ...contestant,
    odds: roundOdds(PAYOUT_RATE / (strengths[index] / total)),
  }));
}

/** Strength implied by win odds. */
function strength(contestant: Contestant) {
  return 1 / Math.max(1, contestant.odds);
}

/**
 * Payout rate implied by a set of win odds (1 / Σ 1/odds), kept within a sensible range so that
 * unusual manual odds can't make place or exotic tickets a guaranteed profit.
 */
export function impliedPayoutRate(field: Contestant[]) {
  const book = field.reduce((sum, contestant) => sum + strength(contestant), 0);
  if (book <= 0) return PAYOUT_RATE;
  return Math.max(0.5, Math.min(0.95, 1 / book));
}

/** Plackett–Luce probability that `order` fills the first positions exactly in that order. */
export function orderedProbability(order: Contestant[], field: Contestant[]) {
  if (!order.length) return 0;
  const fieldIds = new Set(field.map((contestant) => contestant.id));
  if (order.some((contestant) => !fieldIds.has(contestant.id))) return 0;

  let remaining = field.reduce((sum, contestant) => sum + strength(contestant), 0);
  let probability = 1;
  for (const contestant of order) {
    const value = strength(contestant);
    if (remaining <= 0) return 0;
    probability *= value / remaining;
    remaining -= value;
  }
  return probability;
}

/** Probability that `target` finishes within the first `places` positions. */
export function topProbability(target: Contestant, field: Contestant[], places: number) {
  const depth = Math.min(places, field.length);
  const walk = (prefix: Contestant[], remaining: Contestant[]): number => {
    if (prefix.length === depth) return 0;
    return remaining.reduce((sum, next) => {
      const order = [...prefix, next];
      if (next.id === target.id) return sum + orderedProbability(order, field);
      return (
        sum +
        walk(
          order,
          remaining.filter((item) => item.id !== next.id),
        )
      );
    }, 0);
  };
  return walk([], field);
}

/** Probability that a ticket hits, under the model. */
export function ticketProbability(type: BetType, picks: Contestant[], field: Contestant[]) {
  if (picks.length !== requiredPickCount(type)) return 0;
  if (type === "place") return topProbability(picks[0], field, 3);
  return orderedProbability(picks, field);
}

/** Fixed multiplier for a ticket, before any pool-based adjustment. */
export function baseMultiplier(type: BetType, picks: Contestant[], field: Contestant[] = picks) {
  if (picks.length !== requiredPickCount(type)) return 0;
  if (type === "win") return picks[0].odds;
  const probability = ticketProbability(type, picks, field);
  if (probability <= 0) return 0;
  return roundOdds(impliedPayoutRate(field) / probability, type);
}

function outcomeKey(type: BetType, contestantIds: string[]) {
  if (type === "win" || type === "place") return contestantIds[0] ?? "";
  return contestantIds.slice(0, requiredPickCount(type)).join(">");
}

export function isValidStake(amount: unknown): amount is number {
  return (
    typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 && amount <= LIMITS.maxStake
  );
}

/**
 * Multiplier actually paid for a ticket.
 *
 * With pool-based odds the multiplier behaves like a pari-mutuel pool: the more points placed on
 * the same outcome, the lower it gets. A virtual pool priced at the model's odds keeps the first
 * few bets from producing extreme numbers. Because it depends on the final pool, the value shown
 * while betting is an estimate; settlement recomputes it from the closed pool.
 */
export function getEffectiveMultiplier(room: Room, type: BetType, picks: Contestant[]) {
  const base = baseMultiplier(type, picks, room.contestants);
  if (!base || !room.settings.marketOdds) return base;

  const targetKey = outcomeKey(
    type,
    picks.map((contestant) => contestant.id),
  );
  const typeBets = room.currentRace.bets.filter((bet) => bet.type === type && isValidStake(bet.amount));
  const pool = typeBets.reduce((sum, bet) => sum + bet.amount, 0);
  if (pool <= 0) return base;

  const outcomeStake = typeBets
    .filter((bet) => outcomeKey(type, getBetPickIds(bet)) === targetKey)
    .reduce((sum, bet) => sum + bet.amount, 0);
  const rate = impliedPayoutRate(room.contestants);
  const virtualPool = Math.max(240, room.contestants.length * 90);
  const virtualOutcomeStake = (virtualPool * rate) / base;
  return roundOdds(((pool + virtualPool) * rate) / (outcomeStake + virtualOutcomeStake), type);
}

export function resolvePicks(room: Room, contestantIds: string[]) {
  return contestantIds
    .map((id) => room.contestants.find((contestant) => contestant.id === id))
    .filter((contestant): contestant is Contestant => Boolean(contestant));
}
