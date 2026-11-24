import { describe, expect, it } from "vitest";
import { addBet, createBet } from "../betting";
import {
  baseMultiplier,
  calculateAutoOdds,
  clampOdds,
  clampRating,
  getEffectiveMultiplier,
  impliedPayoutRate,
  isBetTypeAvailable,
  orderedProbability,
  PAYOUT_RATE,
  requiredPickCount,
  roundOdds,
  ticketProbability,
  topProbability,
} from "../odds";
import type { BetType, Contestant } from "../types";
import { testRoom } from "./fixtures";

const racer = (index: number, level: number): Contestant => ({
  id: `r${index}`,
  name: `r${index}`,
  odds: 2,
  accent: "#000",
  icon: "x",
  cpuLevel: level,
  isCpu: true,
});

const fields = [
  [5, 5],
  [5, 5, 5, 5],
  [9, 7, 5, 3],
  [8, 9, 7, 5],
  [11, 1, 1, 1],
  [6, 6, 5, 5, 4, 4],
  [11, 9, 7, 5, 4, 3, 2, 1],
].map((levels) => calculateAutoOdds(levels.map((level, index) => racer(index, level))));

function* tickets(field: Contestant[]): Generator<[BetType, Contestant[]]> {
  for (const a of field) {
    yield ["win", [a]];
    if (isBetTypeAvailable("place", field.length)) yield ["place", [a]];
    for (const b of field) {
      if (b === a) continue;
      yield ["exacta", [a, b]];
      if (field.length < 3) continue;
      for (const c of field) if (c !== a && c !== b) yield ["trifecta", [a, b, c]];
    }
  }
}

describe("probability model", () => {
  it.each(fields.map((field) => [field.length, field] as const))(
    "is a proper distribution (%i racers)",
    (_, field) => {
      const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
      expect(sum(field.map((racer) => orderedProbability([racer], field)))).toBeCloseTo(1, 9);
      expect(sum(field.map((racer) => topProbability(racer, field, 3)))).toBeCloseTo(
        Math.min(3, field.length),
        9,
      );
      const exactas = field.flatMap((a) =>
        field.filter((b) => b !== a).map((b) => orderedProbability([a, b], field)),
      );
      expect(sum(exactas)).toBeCloseTo(1, 9);
    },
  );

  it("rates stronger racers as more likely to win", () => {
    const odds = fields[2].map((racer) => racer.odds);
    expect(odds).toEqual([...odds].sort((a, b) => a - b));
  });

  it("is 0 for racers outside the field", () => {
    expect(orderedProbability([{ ...fields[1][0], id: "ghost" }], fields[1])).toBe(0);
  });
});

describe("pricing", () => {
  it("returns about the same share of stakes for every ticket type, and never more than the stake", () => {
    for (const field of fields) {
      for (const [type, picks] of tickets(field)) {
        const multiplier = baseMultiplier(type, picks, field);
        const expectedReturn = multiplier * ticketProbability(type, picks, field);
        // No ticket is ever a long-run profit for the bettor.
        expect(expectedReturn, `${type} ${picks.map((p) => p.id)}`).toBeLessThan(1);
        // Away from the floor (1.0) and the caps, every ticket returns 80–95%. It is at most the
        // 90% target unless a heavy favourite's win odds sit on the 1.0 floor, which raises the
        // implied rate; impliedPayoutRate caps that at 95%.
        const capped =
          multiplier <= 1 || multiplier >= { win: 99, place: 30, exacta: 300, trifecta: 1000 }[type];
        if (!capped) {
          expect(expectedReturn).toBeLessThanOrEqual(0.95 + 1e-9);
          expect(expectedReturn).toBeGreaterThan(0.8);
        }
      }
    }
  });

  it("pays an upset order more than the favoured order of the same racers", () => {
    const [strong, , weak] = fields[2];
    expect(baseMultiplier("exacta", [weak, strong], fields[2])).toBeGreaterThan(
      baseMultiplier("exacta", [strong, weak], fields[2]),
    );
  });

  it("returns at most the 90% target in an ordinary field", () => {
    for (const [type, picks] of tickets(fields[2])) {
      const multiplier = baseMultiplier(type, picks, fields[2]);
      // A near-certain place ticket sits on the 1.0 floor (stake returned) and is excluded.
      if (multiplier <= 1) continue;
      expect(multiplier * ticketProbability(type, picks, fields[2])).toBeLessThanOrEqual(PAYOUT_RATE + 1e-9);
    }
  });

  it("prices four equal racers like a fair race card with a 10% take", () => {
    const field = fields[1];
    expect(field.map((racer) => racer.odds)).toEqual([3.6, 3.6, 3.6, 3.6]);
    expect(baseMultiplier("place", [field[0]], field)).toBe(1.2);
    expect(baseMultiplier("exacta", [field[0], field[1]], field)).toBe(10.8);
    expect(baseMultiplier("trifecta", [field[0], field[1], field[2]], field)).toBe(21.6);
  });

  it("uses the payout rate implied by manual win odds", () => {
    const room = testRoom(); // manual odds 1.5 / 2 / 4 / 8
    expect(impliedPayoutRate(room.contestants)).toBeCloseTo(1 / (1 / 1.5 + 1 / 2 + 1 / 4 + 1 / 8), 9);
    expect(baseMultiplier("win", [room.contestants[2]])).toBe(4);
  });

  it("keeps generous manual odds from turning exotic tickets into a sure profit", () => {
    const field = fields[1].map((racer) => ({ ...racer, odds: 10 }));
    expect(impliedPayoutRate(field)).toBe(0.95);
  });

  it("returns 0 for an incomplete ticket", () => {
    expect(baseMultiplier("exacta", [fields[1][0]], fields[1])).toBe(0);
  });
});

describe("pool-based odds", () => {
  it("fall back to fixed odds when the pool is empty", () => {
    const room = testRoom({ marketOdds: true });
    expect(getEffectiveMultiplier(room, "win", [room.contestants[2]])).toBe(4);
  });

  it("shorten popular outcomes and lengthen ignored ones", () => {
    let room = testRoom({ marketOdds: true });
    const [a, , c] = room.contestants;
    for (let index = 0; index < 5; index += 1) {
      room = addBet(
        room,
        createBet({ playerId: "alice", contestantIds: [a.id], type: "win", amount: 200, placedBy: "host" }),
      );
    }
    expect(getEffectiveMultiplier(room, "win", [a])).toBeLessThan(1.5);
    expect(getEffectiveMultiplier(room, "win", [c])).toBeGreaterThan(4);
  });
});

describe("helpers", () => {
  it("knows how many picks each ticket needs", () => {
    expect((["win", "place", "exacta", "trifecta"] as const).map(requiredPickCount)).toEqual([1, 1, 2, 3]);
  });

  it("rounds odds down to one decimal and clamps them", () => {
    expect(roundOdds(3.69)).toBe(3.6);
    expect(roundOdds(0.4)).toBe(1);
    expect(roundOdds(5000, "trifecta")).toBe(1000);
    expect(clampOdds(0.5)).toBe(1.1);
    expect(clampOdds(2.35)).toBe(2.4);
    expect(clampOdds(1000)).toBe(99);
    expect(clampRating(0)).toBe(1);
    expect(clampRating(42)).toBe(11);
    expect(clampRating(Number.NaN)).toBe(5);
  });
});
