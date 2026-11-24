import { describe, expect, it } from "vitest";
import { addBet, createBet } from "../betting";
import { DEMO_ROOM_ID } from "../constants";
import { JOIN_CODE_PATTERN, ROOM_ID_PATTERN } from "../ids";
import {
  addContestant,
  createDemoRoom,
  createRoom,
  defaultCreateInput,
  LegacyRoomError,
  normalizeRoom,
  removeBet,
  removeContestant,
  removePlayer,
  setContestantOdds,
  updateContestant,
  updateSettings,
} from "../room";
import { toRoomPayload } from "../patch";
import { testRoom } from "./fixtures";

describe("createRoom", () => {
  it("issues long unguessable identifiers", () => {
    const first = createRoom({ ...defaultCreateInput, name: "a" });
    const second = createRoom({ ...defaultCreateInput, name: "b" });
    expect(first.id).toMatch(ROOM_ID_PATTERN);
    expect(first.joinCode).toMatch(JOIN_CODE_PATTERN);
    expect(first.id).not.toBe(second.id);
    expect(first.joinCode).not.toBe(second.joinCode);
  });

  it("clamps user input into supported limits", () => {
    const room = createRoom({
      ...defaultCreateInput,
      name: "  x".padEnd(100, "y"),
      maxRaces: 500,
      maxPlayers: 0,
      contestantCount: 50,
      startingBalance: -5,
    });
    expect(room.name.length).toBeLessThanOrEqual(40);
    expect(room.settings.maxRaces).toBe(20);
    expect(room.settings.maxPlayers).toBe(1);
    expect(room.contestants).toHaveLength(8);
    expect(room.startingBalance).toBe(0);
    expect(room.currentRace).toMatchObject({ number: 1, status: "betting" });
  });
});

describe("createDemoRoom", () => {
  it("contains a playable third race on top of two settled races", () => {
    const room = createDemoRoom("en");
    expect(room.id).toBe(DEMO_ROOM_ID);
    expect(room.isDemo).toBe(true);
    expect(room.raceHistory.map((entry) => entry.raceNumber)).toEqual([1, 2]);
    expect(room.currentRace).toMatchObject({ number: 3, status: "betting" });
    expect(room.currentRace.bets.length).toBeGreaterThan(0);
    for (const item of room.players) {
      expect(item.balance).toBe(
        room.raceHistory[1].payouts.find((row) => row.playerId === item.id)?.balanceAfter,
      );
    }
  });

  it("survives a round trip through storage normalisation", () => {
    const room = createDemoRoom("ja");
    expect(normalizeRoom(JSON.parse(JSON.stringify(room)))).toEqual(room);
  });
});

describe("normalizeRoom", () => {
  it("turns Realtime Database maps back into arrays", () => {
    const room = addBet(
      testRoom(),
      createBet({
        playerId: "alice",
        contestantIds: ["A", "B"],
        type: "exacta",
        amount: 10,
        placedBy: "self",
      }),
    );
    const payload = toRoomPayload(room);
    const fromDatabase = JSON.parse(JSON.stringify(payload));
    fromDatabase.currentRace.bets.alice.contestantIds = { 0: "A", 1: "B" };
    const restored = normalizeRoom(fromDatabase);
    expect(restored.players.map((item) => item.id)).toEqual(["alice", "bob"]);
    expect(restored.currentRace.bets[0].contestantIds).toEqual(["A", "B"]);
  });

  it("restores insertion order even though the database sorts records by key", () => {
    const room = createRoom({ ...defaultCreateInput, name: "order", contestantCount: 4 }, "host");
    const players = ["zeta", "alpha", "mid"].map((id, index) => ({
      id,
      uid: id,
      name: id,
      balance: 0,
      isOffline: false,
      accent: "#000",
      emoji: "x",
      joinedAt: 100 + index,
    }));
    const payload = JSON.parse(JSON.stringify(toRoomPayload({ ...room, players })));
    const sortedByKey = (record: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
    payload.players = sortedByKey(payload.players);
    payload.contestants = sortedByKey(payload.contestants);
    const restored = normalizeRoom(payload);
    expect(restored.players.map((item) => item.id)).toEqual(["zeta", "alpha", "mid"]);
    expect(restored.contestants.map((item) => item.name)).toEqual(room.contestants.map((item) => item.name));
  });

  it("keeps empty live collections empty instead of inheriting demo data", () => {
    const value = JSON.parse(JSON.stringify(createRoom({ ...defaultCreateInput, name: "live" }, "host")));
    delete value.players;
    delete value.currentRace.bets;
    delete value.raceHistory;
    const restored = normalizeRoom(value);
    expect(restored.players).toEqual([]);
    expect(restored.currentRace.bets).toEqual([]);
    expect(restored.raceHistory).toEqual([]);
  });

  it("rejects rooms created before schema version 2", () => {
    const legacy = JSON.parse(JSON.stringify(testRoom()));
    delete legacy.schemaVersion;
    expect(() => normalizeRoom(legacy)).toThrow(LegacyRoomError);
  });

  it("derives the race number from older titles and strips legacy fields", () => {
    const legacy = JSON.parse(JSON.stringify(testRoom()));
    delete legacy.currentRace.number;
    legacy.currentRace.title = "第7レース";
    legacy.currentRace.status = "setup";
    legacy.players[0].skillRating = 3;
    const restored = normalizeRoom(legacy);
    expect(restored.currentRace.number).toBe(7);
    expect(restored.currentRace.status).toBe("betting");
    expect(restored.settings.maxRaces).toBeGreaterThanOrEqual(7);
    expect(restored.players[0]).not.toHaveProperty("skillRating");
  });
});

describe("room mutations", () => {
  it("voids open tickets that include a removed racer", () => {
    let room = addBet(
      testRoom(),
      createBet({ playerId: "alice", contestantIds: ["A"], type: "win", amount: 10, placedBy: "host" }),
    );
    room = addBet(
      room,
      createBet({ playerId: "bob", contestantIds: ["B"], type: "win", amount: 10, placedBy: "host" }),
    );
    const next = removeContestant(room, "A");
    expect(next.contestants.map((item) => item.id)).toEqual(["B", "C", "D"]);
    expect(next.currentRace.bets.map((bet) => bet.playerId)).toEqual(["bob"]);
  });

  it("removes a bettor together with their open tickets", () => {
    const room = addBet(
      testRoom(),
      createBet({ playerId: "alice", contestantIds: ["A"], type: "win", amount: 10, placedBy: "host" }),
    );
    const next = removePlayer(room, "alice");
    expect(next.players.map((item) => item.id)).toEqual(["bob"]);
    expect(next.currentRace.bets).toEqual([]);
  });

  it("lets the host void a ticket only while betting is open", () => {
    const room = addBet(
      testRoom(),
      createBet({ playerId: "alice", contestantIds: ["A"], type: "win", amount: 10, placedBy: "host" }),
    );
    const betId = room.currentRace.bets[0].id;
    expect(removeBet(room, betId).currentRace.bets).toEqual([]);
    const closed = { ...room, currentRace: { ...room.currentRace, status: "closed" as const } };
    expect(removeBet(closed, betId)).toBe(closed);
  });

  it("switches to manual odds when the host overrides a value", () => {
    const room = setContestantOdds(testRoom({ autoOdds: true }), "B", 3.333);
    expect(room.settings.autoOdds).toBe(false);
    expect(room.contestants[1].odds).toBe(3.33);
  });

  it("recalculates odds when levels change in auto mode", () => {
    const room = updateContestant(testRoom({ autoOdds: true }), "D", { cpuLevel: 11 });
    expect(room.contestants[3].odds).toBeLessThan(room.contestants[0].odds);
  });

  it("names new racers and keeps auto odds consistent", () => {
    const room = addContestant(testRoom({ autoOdds: true }), {
      name: " ",
      icon: "🚀",
      isCpu: true,
      cpuLevel: 4,
      odds: 2,
    });
    expect(room.contestants.at(-1)?.name).toBe("CPU4");
  });

  it("never lets the race limit drop below the current race", () => {
    const room = { ...testRoom(), currentRace: { ...testRoom().currentRace, number: 6 } };
    expect(updateSettings(room, { maxRaces: 3 }).settings.maxRaces).toBe(6);
    expect(updateSettings(room, { startingBalance: 2500 }).startingBalance).toBe(2500);
  });
});
