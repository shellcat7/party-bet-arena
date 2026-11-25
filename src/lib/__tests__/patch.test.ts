import { describe, expect, it } from "vitest";
import { addBet, createBet } from "../betting";
import { buildRoomPatch, deepEqual, stripUndefined } from "../patch";
import { renameRoom, updatePlayer } from "../room";
import { setRaceStatus, settleRoom, startNextRace } from "../settlement";
import { testRoom } from "./fixtures";

describe("buildRoomPatch", () => {
  it("is empty when nothing changed", () => {
    const room = testRoom();
    expect(buildRoomPatch(room, { ...room, updatedAt: room.updatedAt + 1 })).toEqual({});
  });

  it("touches only the renamed field", () => {
    const room = testRoom();
    const next = renameRoom(room, "Renamed");
    expect(buildRoomPatch(room, next)).toEqual({ name: "Renamed", updatedAt: next.updatedAt });
  });

  it("writes a proxy bet to its own path so concurrent bets are not overwritten", () => {
    const room = testRoom();
    const bet = createBet({
      playerId: "bob",
      contestantIds: ["A"],
      type: "win",
      amount: 10,
      placedBy: "host",
    });
    const patch = buildRoomPatch(room, addBet(room, bet));
    expect(Object.keys(patch).sort()).toEqual([`currentRace/bets/${bet.id}`, "updatedAt"]);
    expect(patch).not.toHaveProperty("currentRace");
    expect(patch).not.toHaveProperty("players");
  });

  it("deletes removed records with null", () => {
    const room = testRoom();
    const next = { ...room, players: room.players.slice(1) };
    expect(buildRoomPatch(room, next)).toMatchObject({ "players/alice": null });
  });

  it("updates only the changed field of a player, so a stale view can't roll back a balance", () => {
    const room = testRoom();
    const patch = buildRoomPatch(room, updatePlayer(room, "bob", { emoji: "🚀" }));
    expect(patch).toEqual({ "players/bob/emoji": "🚀", updatedAt: expect.any(Number) });
  });

  it("writes a new player as a whole record", () => {
    const room = testRoom();
    const next = { ...room, players: [...room.players, { ...room.players[0], id: "carol", uid: "carol" }] };
    expect(buildRoomPatch(room, next)["players/carol"]).toMatchObject({ id: "carol" });
  });

  it("only changes status when the host closes betting", () => {
    const room = testRoom();
    expect(Object.keys(buildRoomPatch(room, setRaceStatus(room, "closed"))).sort()).toEqual([
      "currentRace/status",
      "updatedAt",
    ]);
  });

  it("writes changed balances, history and race result on settlement", () => {
    const room = addBet(
      testRoom(),
      createBet({ playerId: "alice", contestantIds: ["A"], type: "win", amount: 10, placedBy: "self" }),
    );
    const patch = buildRoomPatch(room, settleRoom(room, ["A", "B", "C", "D"]));
    expect(Object.keys(patch).sort()).toEqual([
      "currentRace/resultIds",
      "currentRace/settledAt",
      "currentRace/status",
      "players/alice/balance",
      "raceHistory",
      "updatedAt",
    ]);
  });

  it("replaces the whole race when a new one starts", () => {
    const room = settleRoom(testRoom(), ["A", "B", "C", "D"]);
    const next = startNextRace(room);
    const patch = buildRoomPatch(room, next);
    expect(patch.currentRace).toMatchObject({ id: next.currentRace.id, number: 2, bets: {} });
  });
});

describe("helpers", () => {
  it("strips undefined values the database would reject", () => {
    expect(stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: [1, { f: undefined }] } })).toEqual({
      a: 1,
      c: { e: [1, {}] },
    });
  });

  it("compares structurally and ignores undefined keys", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
