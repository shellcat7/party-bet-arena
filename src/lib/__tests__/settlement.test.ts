import { describe, expect, it } from "vitest";
import { addBet, createBet } from "../betting";
import {
  advanceRace,
  balanceSeries,
  closeBetting,
  gameHighlights,
  isBetHit,
  isCompleteResult,
  isGameOver,
  previewSettlement,
  rankMovement,
  rankPlayers,
  reopenBetting,
  settleRace,
  settleRoom,
  startNextRace,
} from "../settlement";
import type { BetType, Room } from "../types";
import { player, testRoom } from "./fixtures";

const order = ["C", "A", "B", "D"];

function withBet(room: Room, playerId: string, type: BetType, picks: string[], amount: number) {
  return addBet(room, createBet({ playerId, contestantIds: picks, type, amount, placedBy: "host" }));
}

describe("isBetHit", () => {
  it.each([
    ["win", ["C"], true],
    ["win", ["A"], false],
    ["place", ["B"], true],
    ["place", ["D"], false],
    ["exacta", ["C", "A"], true],
    ["exacta", ["A", "C"], false],
    ["trifecta", ["C", "A", "B"], true],
    ["trifecta", ["C", "B", "A"], false],
    ["trifecta", ["C", "A"], false],
  ] as const)("%s %j → %s", (type, picks, expected) => {
    expect(isBetHit(type, [...picks], order)).toBe(expected);
  });

  it("misses when the pick is not in the result", () => {
    expect(isBetHit("win", ["Z"], order)).toBe(false);
    expect(isBetHit("win", [], order)).toBe(false);
  });
});

describe("settleRoom", () => {
  it("deducts every stake and credits floor(stake × multiplier) for hits", () => {
    let room = withBet(testRoom(), "alice", "win", ["C"], 100); // 4.0x → 400
    room = withBet(room, "bob", "win", ["A"], 150); // miss
    const settled = settleRoom(room, order, 5_000);
    expect(settled.players.find((p) => p.id === "alice")?.balance).toBe(1300);
    expect(settled.players.find((p) => p.id === "bob")?.balance).toBe(850);
    expect(settled.currentRace).toMatchObject({ status: "settled", resultIds: order, settledAt: 5_000 });

    const entry = settled.raceHistory.at(-1)!;
    expect(entry.raceNumber).toBe(1);
    expect(entry.payouts).toEqual([
      { playerId: "alice", stake: 100, payout: 400, delta: 300, balanceAfter: 1300, hits: 1 },
      { playerId: "bob", stake: 150, payout: 0, delta: -150, balanceAfter: 850, hits: 0 },
    ]);
    expect(entry.bets.map((bet) => bet.hit)).toEqual([true, false]);
  });

  it("ignores a multiplier written by the client", () => {
    const room = withBet(testRoom(), "alice", "win", ["C"], 100);
    room.currentRace.bets[0].multiplier = 999_999;
    expect(settleRoom(room, order).players[0].balance).toBe(1300);
  });

  it("records malformed tickets without moving any coins", () => {
    const room = withBet(testRoom(), "alice", "win", ["C"], 100);
    room.currentRace.bets[0].amount = -50;
    const settled = settleRoom(room, order);
    expect(settled.players[0].balance).toBe(1000);
    expect(settled.raceHistory[0].bets[0]).toMatchObject({ hit: false, payout: 0, multiplier: 0 });
  });

  it("floors balances at zero unless debt is allowed", () => {
    const poor = (allowDebt: boolean) => {
      const room = testRoom({ allowDebt });
      room.players = [player("alice", 50)];
      return withBet(room, "alice", "win", ["D"], 200);
    };
    expect(settleRoom(poor(false), order).players[0].balance).toBe(0);
    expect(settleRoom(poor(true), order).players[0].balance).toBe(-150);
  });

  it("snapshots racers so later edits do not rewrite history", () => {
    const settled = settleRoom(testRoom(), order);
    const renamed = { ...settled, contestants: settled.contestants.map((c) => ({ ...c, name: "changed" })) };
    expect(renamed.raceHistory[0].contestants[0].name).toBe("Racer A");
  });

  it("can be previewed without mutating the room", () => {
    const room = withBet(testRoom(), "alice", "win", ["C"], 100);
    const before = structuredClone(room);
    expect(previewSettlement(room, order)[0].delta).toBe(300);
    expect(room).toEqual(before);
  });
});

describe("race lifecycle", () => {
  it("validates complete results", () => {
    const room = testRoom();
    expect(isCompleteResult(room, order)).toBe(true);
    expect(isCompleteResult(room, ["C", "A", "B"])).toBe(false);
    expect(isCompleteResult(room, ["C", "C", "B", "D"])).toBe(false);
    expect(isCompleteResult(room, ["C", "A", "B", "Z"])).toBe(false);
  });

  it("starts the next race with a clean slate and stops at the final race", () => {
    const settled = settleRoom(withBet(testRoom({ maxRaces: 2 }), "alice", "win", ["C"], 100), order);
    expect(isGameOver(settled)).toBe(false);
    const next = startNextRace(settled);
    expect(next.currentRace).toMatchObject({ number: 2, status: "betting", bets: [], resultIds: [] });
    expect(next.currentRace.id).not.toBe(settled.currentRace.id);
    expect(isGameOver(settleRoom(next, order))).toBe(true);
  });
});

describe("rankings", () => {
  it("uses competition ranking for ties", () => {
    const ranks = rankPlayers([player("a", 500), player("b", 900), player("c", 500), player("d", 100)]);
    expect(ranks.map(({ player: p, rank }) => `${p.id}${rank}`)).toEqual(["b1", "a2", "c2", "d4"]);
  });

  it("reports rank movement since the previous race", () => {
    let room = withBet(testRoom(), "alice", "win", ["C"], 100);
    room = startNextRace(settleRoom(room, order)); // alice leads
    room = withBet(room, "bob", "win", ["D"], 200);
    room = settleRoom(room, ["D", "C", "B", "A"]); // bob overtakes
    const movement = rankMovement(room);
    expect(movement.get("bob")).toBe(1);
    expect(movement.get("alice")).toBe(-1);
  });

  it("builds a balance series per player", () => {
    let room = withBet(testRoom(), "alice", "win", ["C"], 100);
    room = startNextRace(settleRoom(room, order));
    room = settleRoom(room, order);
    expect(balanceSeries(room, "alice")).toEqual([1000, 1300, 1300]);
  });

  it("finds highlights for the final screen", () => {
    let room = withBet(testRoom(), "alice", "win", ["C"], 100);
    room = withBet(room, "bob", "exacta", ["C", "A"], 100);
    room = settleRoom(room, order);
    const highlights = gameHighlights(room);
    expect(highlights.biggestWin?.playerId).toBe("bob");
    expect(highlights.favouriteWinner).toMatchObject({ contestantId: "C", wins: 1 });
    expect(highlights.sharpshooter?.hits).toBe(1);
  });
});

describe("guarded transitions", () => {
  it("only move forward from the state the caller saw", () => {
    const room = testRoom();
    const raceId = room.currentRace.id;
    const closed = closeBetting(room, raceId)!;
    expect(closed.currentRace.status).toBe("closed");
    expect(closeBetting(closed, raceId)).toBeNull();
    expect(reopenBetting(closed, raceId)?.currentRace.status).toBe("betting");
    expect(reopenBetting(room, raceId)).toBeNull();
    expect(closeBetting(room, "another-race")).toBeNull();
  });

  it("settle once: a second tab can't pay out the same race twice", () => {
    const room = withBet(testRoom(), "alice", "win", ["C"], 100);
    const raceId = room.currentRace.id;
    const settled = settleRace(room, raceId, order)!;
    expect(settled.players[0].balance).toBe(1300);
    expect(settleRace(settled, raceId, order)).toBeNull();
    expect(reopenBetting(settled, raceId)).toBeNull();
    expect(settleRace(room, raceId, ["C", "A"])).toBeNull();
  });

  it("start the next race only once, and never past the final race", () => {
    const settled = settleRoom(testRoom({ maxRaces: 2 }), order);
    const next = advanceRace(settled, settled.currentRace.id)!;
    expect(next.currentRace.number).toBe(2);
    expect(advanceRace(next, settled.currentRace.id)).toBeNull();
    const last = settleRoom(next, order);
    expect(advanceRace(last, last.currentRace.id)).toBeNull();
  });
});

describe("ticket types the field makes impossible to lose", () => {
  it("are refunded at settlement", () => {
    const room = testRoom();
    const small = withBet(
      { ...room, contestants: room.contestants.slice(0, 3) },
      "alice",
      "place",
      ["A"],
      500,
    );
    const settled = settleRoom(small, ["C", "B", "A"]);
    expect(settled.players[0].balance).toBe(1000);
    expect(settled.raceHistory[0].bets[0]).toMatchObject({ voided: true, payout: 0, delta: 0 });
  });
});
