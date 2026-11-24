/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoRoom, createRoom, defaultCreateInput } from "../room";
import {
  clearRoomSnapshot,
  forgetRoom,
  loadPreferences,
  loadRoomSnapshot,
  loadRoomSummaries,
  loadSession,
  rememberRoom,
  saveRoomSnapshot,
  saveSession,
} from "../storage";

beforeEach(() => localStorage.clear());

describe("room summaries", () => {
  it("never store invitation codes or balances", () => {
    const room = createRoom({ ...defaultCreateInput, name: "Privacy" }, "host");
    rememberRoom(room, "host", false);
    const stored = localStorage.getItem("party-bet-arena:room-summaries") ?? "";
    expect(stored).toContain(room.id);
    expect(stored).not.toContain(room.joinCode);
    expect(stored).not.toContain("balance");
  });

  it("do not list the demo room", () => {
    expect(rememberRoom(createDemoRoom(), "host", true)).toEqual([]);
  });

  it("drop entries from older schemas", () => {
    localStorage.setItem(
      "party-bet-arena:room-summaries",
      JSON.stringify([{ id: "OLD", name: "old", isDemo: false, updatedAt: 1 }]),
    );
    expect(loadRoomSummaries()).toEqual([]);
  });

  it("forget a room together with its snapshot and session", () => {
    const room = createRoom({ ...defaultCreateInput, name: "Bye" });
    rememberRoom(room, "host", true);
    saveRoomSnapshot(room);
    saveSession({ roomId: room.id, role: "host" });
    expect(forgetRoom(room.id)).toEqual([]);
    expect(loadRoomSnapshot(room.id)).toBeUndefined();
    expect(loadSession()).toBeUndefined();
    rememberRoom(room, "host", true);
    expect(loadRoomSummaries()).toHaveLength(1);
  });
});

describe("room snapshots", () => {
  it("are removed once the server confirms an equal or newer version", () => {
    const room = createRoom({ ...defaultCreateInput, name: "Sync" }, "host");
    saveRoomSnapshot(room);
    clearRoomSnapshot(room.id, room.updatedAt - 1);
    expect(loadRoomSnapshot(room.id)).toBeDefined();
    clearRoomSnapshot(room.id, room.updatedAt);
    expect(loadRoomSnapshot(room.id)).toBeUndefined();
  });

  it("migrate the single-record cache from older builds", () => {
    const room = createRoom({ ...defaultCreateInput, name: "Old cache" });
    localStorage.setItem("party-bet-arena:room", JSON.stringify(room));
    expect(loadRoomSnapshot(room.id)?.name).toBe("Old cache");
    expect(localStorage.getItem("party-bet-arena:room")).toBeNull();
  });

  it("leave legacy-schema caches untouched in case they hold unsynced data", () => {
    const legacy = { ...createRoom({ ...defaultCreateInput, name: "Legacy" }), schemaVersion: undefined };
    localStorage.setItem("party-bet-arena:room", JSON.stringify(legacy));
    expect(loadRoomSnapshot(legacy.id)).toBeUndefined();
    expect(localStorage.getItem("party-bet-arena:room")).not.toBeNull();
  });
});

describe("preferences", () => {
  it("carry over the language chosen in older builds", () => {
    localStorage.setItem("party-bet-arena:session", JSON.stringify({ role: "host", language: "en" }));
    expect(loadPreferences()).toEqual({ language: "en", theme: "system" });
  });

  it("survive corrupted storage", () => {
    localStorage.setItem("party-bet-arena:preferences", "{not json");
    expect(loadPreferences().theme).toBe("system");
  });
});
