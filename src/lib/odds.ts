import { LIMITS } from "./constants";
import type { Bet, BetType, Contestant, Room } from "./types";

export const BET_TYPES: BetType[] = ["win", "place", "exacta", "trifecta"];

export function requiredPickCount(type: BetType) {
  if (type === "exacta") return 2;
  if (type === "trifecta") return 3;
  return 1;
}

export function getBetPickIds(bet: Pick<Bet, "contestantId"> & Partial<Pick<Bet, "contestantIds">>) {
  return bet.contestantIds?.length ? bet.contestantIds : [bet.contestantId];
}

export function clampRating(value: number) {
  if (!Number.isFinite(value)) return 5;
  return Math.max(LIMITS.minRating, Math.min(LIMITS.maxRating, Math.floor(value)));
}

export function clampOdds(value: number) {
  if (!Number.isFinite(value)) return LIMITS.minOdds;
  return Math.max(LIMITS.minOdds, Math.min(LIMITS.maxOdds, Number(value.toFixed(2))));
}

/**
 * Turns CPU levels / strength ratings into playable decimal odds.
 *
 * Each racer gets a softmax-style weight `exp((level - 5) * 0.36)`. The implied win probability
 * gives "fair" odds, which are then compressed toward 1.0 so that long shots stay fun but don't
 * bankrupt the table in one race. The ceiling scales with field size.
 */
export function calculateAutoOdds(contestants: Contestant[]): Contestant[] {
  const weights = contestants.map((contestant) =>
    Math.exp((clampRating(contestant.cpuLevel || 5) - 5) * 0.36),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const maxOdds = Math.min(20, Math.max(8, contestants.length * 3.2));

  return contestants.map((contestant, index) => {
    const winProbability = weights[index] / totalWeight;
    const fairOdds = 1 / Math.max(0.001, winProbability);
    const playableOdds = 1 + (fairOdds - 1) * 0.32;
    const odds = Math.max(1.05, Math.min(maxOdds, Number(playableOdds.toFixed(2))));
    return { ...contestant, odds };
  });
}

function contestantWeight(contestant: Contestant) {
  return 1 / Math.max(1.05, contestant.odds);
}

/**
 * Plackett–Luce probability that `order` finishes in exactly that sequence, using
 * the inverse odds of each racer as its strength.
 */
export function orderedProbability(order: Contestant[], field: Contestant[]) {
  if (!order.length) return 0;
  const fieldIds = new Set(field.map((contestant) => contestant.id));
  if (order.some((contestant) => !fieldIds.has(contestant.id))) return 0;

  let remainingWeight = field.reduce((sum, contestant) => sum + contestantWeight(contestant), 0);
  let probability = 1;
  for (const contestant of order) {
    const weight = contestantWeight(contestant);
    if (remainingWeight <= 0 || weight <= 0) return 0;
    probability *= weight / remainingWeight;
    remainingWeight -= weight;
  }
  return probability;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, itemIndex) => itemIndex !== index)).map((rest) => [item, ...rest]),
  );
}

/**
 * For exacta/trifecta tickets, an "upset order" (weaker racer ahead) is less likely than the
 * favoured order of the same racers. This factor nudges the multiplier up or down relative to
 * the average ordering, clamped so it never dominates the base product of odds.
 */
function orderAdjustment(order: Contestant[], field: Contestant[]) {
  if (order.length < 2) return 1;
  const currentProbability = orderedProbability(order, field);
  if (!currentProbability) return 1;

  const orders = permutations(order);
  const averageProbability =
    orders.reduce((sum, permutation) => sum + orderedProbability(permutation, field), 0) / orders.length;
  if (!averageProbability) return 1;
  return Math.max(0.58, Math.min(1.85, Math.pow(averageProbability / currentProbability, 0.85)));
}

/** Fixed-odds multiplier derived only from the racers' odds. */
export function baseMultiplier(type: BetType, picks: Contestant[], field: Contestant[] = picks) {
  if (!picks.length) return 0;
  if (type === "win") return picks[0].odds;
  if (type === "place") return Math.max(1.1, Number((picks[0].odds * 0.52).toFixed(2)));

  const oddsProduct = picks.reduce((product, contestant) => product * contestant.odds, 1);
  if (type === "exacta") {
    return Math.max(1.3, Number((oddsProduct * 0.72 * orderAdjustment(picks, field)).toFixed(2)));
  }
  return Math.max(1.6, Number((oddsProduct * 0.88 * orderAdjustment(picks, field)).toFixed(2)));
}

function outcomeKey(type: BetType, contestantIds: string[]) {
  if (type === "win" || type === "place") return contestantIds[0] ?? "";
  return contestantIds.slice(0, requiredPickCount(type)).join(">");
}

const multiplierCeiling: Record<BetType, number> = { win: 30, place: 20, exacta: 50, trifecta: 80 };

function clampMultiplier(type: BetType, multiplier: number) {
  return Math.max(1.05, Math.min(multiplierCeiling[type], Number(multiplier.toFixed(2))));
}

export function isValidStake(amount: unknown): amount is number {
  return (
    typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 && amount <= LIMITS.maxStake
  );
}

/**
 * Multiplier actually paid for a ticket.
 *
 * With market odds enabled the multiplier behaves like a pari-mutuel pool: the more coins
 * placed on the same outcome, the lower it gets. A virtual pool seeded from the fixed odds keeps
 * the very first bets from producing absurd numbers. Because it depends on the final pool, the
 * value shown while betting is an estimate; settlement recomputes it from the closed pool.
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
  const virtualPool = Math.max(240, room.contestants.length * 90);
  const payoutRate = 0.92;
  const virtualOutcomeStake = (virtualPool * payoutRate) / base;
  const marketMultiplier = ((pool + virtualPool) * payoutRate) / (outcomeStake + virtualOutcomeStake);
  return clampMultiplier(type, marketMultiplier);
}

export function resolvePicks(room: Room, contestantIds: string[]) {
  return contestantIds
    .map((id) => room.contestants.find((contestant) => contestant.id === id))
    .filter((contestant): contestant is Contestant => Boolean(contestant));
}
