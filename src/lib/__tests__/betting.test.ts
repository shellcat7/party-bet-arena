import { describe, expect, it } from "vitest";
import {
  addBet,
  createBet,
  getAvailableBalance,
  getPotentialPayout,
  getReservedAmount,
  hasSelfBet,
  validateBet,
} from "../betting";
import type { DraftBet } from "../types";
import { testRoom } from "./fixtures";

const draft = (overrides: Partial<DraftBet> = {}): DraftBet => ({
  playerId: "alice",
  contestantIds: ["C"],
  type: "win",
  amount: 100,
  placedBy: "self",
  ...overrides,
});

describe("validateBet", () => {
  it("accepts a well-formed ticket", () => {
    expect(validateBet(testRoom(), draft())).toBeNull();
  });

  it.each([
    [
      "betting-closed",
      (room = testRoom()) => ({ ...room, currentRace: { ...room.currentRace, status: "closed" as const } }),
      draft(),
    ],
    ["no-player", () => testRoom(), draft({ playerId: "nobody" })],
    ["no-pick", () => testRoom(), draft({ contestantIds: [] })],
    ["incomplete-pick", () => testRoom(), draft({ type: "exacta", contestantIds: ["A"] })],
    ["duplicate-pick", () => testRoom(), draft({ type: "exacta", contestantIds: ["A", "A"] })],
    ["unknown-pick", () => testRoom(), draft({ contestantIds: ["Z"] })],
    ["invalid-amount", () => testRoom(), draft({ amount: 0 })],
    ["invalid-amount", () => testRoom(), draft({ amount: 1.5 })],
    ["invalid-amount", () => testRoom(), draft({ amount: -10 })],
    ["insufficient-balance", () => testRoom(), draft({ amount: 1001 })],
  ] as const)("rejects with %s", (code, makeRoom, ticket) => {
    expect(validateBet(makeRoom(), ticket)).toBe(code);
  });

  it("allows only one self-placed ticket per race", () => {
    const room = addBet(testRoom(), createBet(draft()));
    expect(validateBet(room, draft())).toBe("already-placed");
    expect(hasSelfBet(room, "alice")).toBe(true);
  });

  it("lets the host enter several proxy tickets for the same person", () => {
    const room = addBet(testRoom(), createBet(draft({ placedBy: "host" })));
    expect(validateBet(room, draft({ placedBy: "host" }))).toBeNull();
  });

  it("allows betting past the balance only when debt is enabled", () => {
    expect(validateBet(testRoom({ allowDebt: true }), draft({ amount: 5000 }))).toBeNull();
  });
});

describe("balances", () => {
  it("reserves open stakes until the race settles", () => {
    let room = addBet(testRoom(), createBet(draft({ amount: 300, placedBy: "host" })));
    room = addBet(room, createBet(draft({ amount: 200, placedBy: "host" })));
    expect(getReservedAmount(room, "alice")).toBe(500);
    expect(getAvailableBalance(room, "alice")).toBe(500);
    expect(validateBet(room, draft({ amount: 600, placedBy: "host" }))).toBe("insufficient-balance");
    const settled = { ...room, currentRace: { ...room.currentRace, status: "settled" as const } };
    expect(getReservedAmount(settled, "alice")).toBe(0);
  });

  it("estimates the payout with the current multiplier", () => {
    expect(getPotentialPayout(testRoom(), { type: "win", contestantIds: ["C"], amount: 150 })).toBe(600);
    expect(getPotentialPayout(testRoom(), { type: "exacta", contestantIds: ["C"], amount: 150 })).toBe(0);
  });
});

describe("createBet", () => {
  it("keys self tickets by player id so the database can enforce one per race", () => {
    expect(createBet(draft()).id).toBe("alice");
    expect(createBet(draft({ placedBy: "host" })).id).not.toBe("alice");
  });

  it("never stores a client-side multiplier", () => {
    const bet = createBet({ ...draft(), multiplier: 999 } as DraftBet);
    expect(bet).not.toHaveProperty("multiplier");
    expect(bet).not.toHaveProperty("uid");
    expect(createBet(draft({ uid: "u1" })).uid).toBe("u1");
  });
});
