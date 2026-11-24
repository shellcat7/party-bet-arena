import { describe, expect, it } from "vitest";
import { addBet, createBet } from "../betting";
import {
  baseMultiplier,
  calculateAutoOdds,
  clampOdds,
  clampRating,
  getEffectiveMultiplier,
  orderedProbability,
  requiredPickCount,
} from "../odds";
import { testRoom } from "./fixtures";

describe("calculateAutoOdds", () => {
  it("gives stronger racers shorter odds", () => {
    const room = testRoom();
    const racers = room.contestants.map((contestant, index) => ({
      ...contestant,
      cpuLevel: [9, 7, 5, 3][index],
    }));
    const odds = calculateAutoOdds(racers).map((contestant) => contestant.odds);
    expect(odds).toEqual([...odds].sort((a, b) => a - b));
    expect(new Set(odds).size).toBe(odds.length);
  });

  it("gives equal racers equal odds and keeps every value playable", () => {
    const room = testRoom();
    const racers = calculateAutoOdds(room.contestants.map((contestant) => ({ ...contestant, cpuLevel: 5 })));
    expect(new Set(racers.map((contestant) => contestant.odds)).size).toBe(1);
    for (const contestant of calculateAutoOdds(
      room.contestants.map((c, i) => ({ ...c, cpuLevel: i === 0 ? 11 : 1 })),
    )) {
      expect(contestant.odds).toBeGreaterThanOrEqual(1.05);
      expect(contestant.odds).toBeLessThanOrEqual(20);
    }
  });
});

describe("baseMultiplier", () => {
  const room = testRoom();
  const [a, b, c] = room.contestants;

  it("pays the racer's odds for a win and ~52% of them for a place", () => {
    expect(baseMultiplier("win", [c])).toBe(4);
    expect(baseMultiplier("place", [c])).toBe(2.08);
    expect(baseMultiplier("place", [a])).toBe(1.1);
  });

  it("prices an upset exacta higher than the favoured order of the same racers", () => {
    const favoured = baseMultiplier("exacta", [a, c], room.contestants);
    const upset = baseMultiplier("exacta", [c, a], room.contestants);
    expect(upset).toBeGreaterThan(favoured);
  });

  it("prices trifectas above exactas", () => {
    expect(baseMultiplier("trifecta", [a, b, c], room.contestants)).toBeGreaterThan(
      baseMultiplier("exacta", [a, b], room.contestants),
    );
  });

  it("returns 0 when nothing is picked", () => {
    expect(baseMultiplier("win", [])).toBe(0);
  });
});

describe("orderedProbability", () => {
  it("sums to 1 over every possible winner", () => {
    const room = testRoom();
    const total = room.contestants.reduce(
      (sum, contestant) => sum + orderedProbability([contestant], room.contestants),
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });

  it("is 0 for racers outside the field", () => {
    const room = testRoom();
    expect(orderedProbability([{ ...room.contestants[0], id: "ghost" }], room.contestants)).toBe(0);
  });
});

describe("getEffectiveMultiplier with market odds", () => {
  it("falls back to fixed odds when the pool is empty", () => {
    const room = testRoom({ marketOdds: true });
    expect(getEffectiveMultiplier(room, "win", [room.contestants[2]])).toBe(4);
  });

  it("shortens popular outcomes and lengthens ignored ones", () => {
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

  it("never exceeds the per-type ceiling", () => {
    let room = testRoom({ marketOdds: true });
    room = addBet(
      room,
      createBet({
        playerId: "alice",
        contestantIds: ["A"],
        type: "win",
        amount: 1_000_000,
        placedBy: "host",
      }),
    );
    expect(getEffectiveMultiplier(room, "win", [room.contestants[3]])).toBeLessThanOrEqual(30);
  });
});

describe("helpers", () => {
  it("knows how many picks each ticket needs", () => {
    expect([
      requiredPickCount("win"),
      requiredPickCount("place"),
      requiredPickCount("exacta"),
      requiredPickCount("trifecta"),
    ]).toEqual([1, 1, 2, 3]);
  });

  it("clamps ratings and odds into the supported range", () => {
    expect(clampRating(0)).toBe(1);
    expect(clampRating(42)).toBe(11);
    expect(clampRating(Number.NaN)).toBe(5);
    expect(clampOdds(0.5)).toBe(1.01);
    expect(clampOdds(2.345)).toBe(2.35);
    expect(clampOdds(1000)).toBe(99);
  });
});
