import { readFileSync } from "node:fs";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { get, ref, remove, runTransaction, set, update } from "firebase/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addBet, createBet } from "../src/lib/betting";
import { buildRoomPatch, toRoomPayload } from "../src/lib/patch";
import { createRoom, defaultCreateInput, normalizeRoom } from "../src/lib/room";
import { setRaceStatus, settleRace, settleRoom } from "../src/lib/settlement";
import type { Room } from "../src/lib/types";

const roomId = "SECUREABC234";
const joinCode = "ABCDEFGHJKLMNPQR";
const hostUid = "host-user";
const playerUid = "player-user";

let environment: RulesTestEnvironment;
let room: Room;

const anonymous = () => environment.unauthenticatedContext().database();
const as = (uid: string) =>
  environment.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).database();

const playerRecord = () => ({
  id: playerUid,
  uid: playerUid,
  name: "Player",
  balance: room.startingBalance,
  isOffline: false,
  accent: "#3568ff",
  emoji: "x",
  joinedAt: Date.now(),
});

const selfBet = (overrides: Record<string, unknown> = {}) => ({
  id: playerUid,
  uid: playerUid,
  playerId: playerUid,
  contestantId: room.contestants[0].id,
  contestantIds: [room.contestants[0].id],
  type: "win",
  amount: 10,
  placedBy: "self",
  createdAt: Date.now(),
  ...overrides,
});

async function seed(mutator: (value: Room) => Room = (value) => value) {
  await environment.clearDatabase();
  room = mutator({
    ...createRoom({ ...defaultCreateInput, name: "Rules test" }, hostUid),
    id: roomId,
    joinCode,
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database(), `rooms/${roomId}`), toRoomPayload(room));
    await set(ref(context.database(), `roomMembers/${roomId}/${hostUid}`), {
      role: "host",
      joinCode,
      joinedAt: 1,
    });
  });
}

async function joinAsPlayer() {
  await assertSucceeds(
    set(ref(as(playerUid), `roomMembers/${roomId}/${playerUid}`), { role: "player", joinCode, joinedAt: 1 }),
  );
  await assertSucceeds(set(ref(as(playerUid), `rooms/${roomId}/players/${playerUid}`), playerRecord()));
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-party-bet-security",
    database: { rules: readFileSync(new URL("../firebase.rules.json", import.meta.url), "utf8") },
  });
});

afterAll(async () => {
  await environment?.cleanup();
});

beforeEach(async () => {
  await seed();
});

describe("room access", () => {
  it("hides rooms from anonymous users and outsiders", async () => {
    await assertFails(get(ref(anonymous(), `rooms/${roomId}`)));
    await assertFails(get(ref(as("outsider"), `rooms/${roomId}`)));
    await assertSucceeds(get(ref(as(hostUid), `rooms/${roomId}`)));
  });

  it("admits a participant only with the correct join code", async () => {
    await assertFails(
      set(ref(as(playerUid), `roomMembers/${roomId}/${playerUid}`), {
        role: "player",
        joinCode: "WRONGWRONGWRONG2",
        joinedAt: 1,
      }),
    );
    await assertFails(
      set(ref(as(playerUid), `roomMembers/${roomId}/${playerUid}`), { role: "host", joinCode, joinedAt: 1 }),
    );
    await joinAsPlayer();
    await assertSucceeds(get(ref(as(playerUid), `rooms/${roomId}`)));
  });

  it("rejects rooms without the current schema, long codes or a matching host", async () => {
    const payload = toRoomPayload({ ...room, id: "NEWRXXMABC23" });
    await assertSucceeds(set(ref(as(hostUid), "rooms/NEWRXXMABC23"), payload));
    await assertFails(
      set(ref(as(hostUid), "rooms/SHRTCDEX2345"), { ...payload, id: "SHRTCDEX2345", joinCode: "2468" }),
    );
    const { schemaVersion: _schemaVersion, ...legacy } = { ...payload, id: "LEGACYRXXM23" };
    await assertFails(set(ref(as(hostUid), "rooms/LEGACYRXXM23"), legacy));
    await assertFails(
      set(ref(as(hostUid), "rooms/DEMXRXXMAB23"), { ...payload, id: "DEMXRXXMAB23", isDemo: true }),
    );
    await assertFails(set(ref(as("someone"), "rooms/STXLENRXXM23"), { ...payload, id: "STXLENRXXM23" }));
  });

  it("keeps rooms from older schema versions sealed", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const { schemaVersion: _schemaVersion, ...legacy } = toRoomPayload({ ...room, id: "LEGACYRXXM12" });
      await set(ref(context.database(), "rooms/LEGACYRXXM12"), legacy);
    });
    await assertFails(get(ref(as(hostUid), "rooms/LEGACYRXXM12")));
    await assertFails(set(ref(as(hostUid), "rooms/LEGACYRXXM12/name"), "revived"));
  });
});

describe("participant writes", () => {
  beforeEach(joinAsPlayer);

  it("cannot inflate their balance or touch other records", async () => {
    await assertFails(set(ref(as(playerUid), `rooms/${roomId}/players/${playerUid}/balance`), 1_000_000));
    await assertFails(
      set(ref(as(playerUid), `rooms/${roomId}/players/someone-else`), {
        ...playerRecord(),
        id: "someone-else",
      }),
    );
    await assertFails(set(ref(as(playerUid), `rooms/${roomId}/hostUid`), playerUid));
    await assertFails(set(ref(as(playerUid), `rooms/${roomId}/currentRace/status`), "settled"));
  });

  it("can place exactly one valid bet while betting is open", async () => {
    await assertFails(
      set(ref(as(playerUid), `rooms/${roomId}/currentRace/bets/${playerUid}`), selfBet({ multiplier: 9999 })),
    );
    await assertFails(
      set(
        ref(as(playerUid), `rooms/${roomId}/currentRace/bets/${playerUid}`),
        selfBet({ amount: room.startingBalance + 1 }),
      ),
    );
    await assertFails(
      set(
        ref(as(playerUid), `rooms/${roomId}/currentRace/bets/${playerUid}`),
        selfBet({ contestantIds: ["ghost"], contestantId: "ghost" }),
      ),
    );
    await assertSucceeds(set(ref(as(playerUid), `rooms/${roomId}/currentRace/bets/${playerUid}`), selfBet()));
    await assertFails(
      set(ref(as(playerUid), `rooms/${roomId}/currentRace/bets/${playerUid}`), selfBet({ amount: 1 })),
    );
    await assertFails(remove(ref(as(playerUid), `rooms/${roomId}/currentRace/bets/${playerUid}`)));
  });

  it("cannot bet once the host has closed the race", async () => {
    await assertSucceeds(
      update(ref(as(hostUid), `rooms/${roomId}`), buildRoomPatch(room, setRaceStatus(room, "closed"))),
    );
    await assertFails(set(ref(as(playerUid), `rooms/${roomId}/currentRace/bets/${playerUid}`), selfBet()));
  });
});

describe("host writes", () => {
  it("applies minimal multi-path patches without clobbering a participant's bet", async () => {
    await joinAsPlayer();
    await assertSucceeds(set(ref(as(playerUid), `rooms/${roomId}/currentRace/bets/${playerUid}`), selfBet()));
    // The host's copy is stale: it has never seen the participant's bet.
    const renamed = { ...room, name: "Renamed by host", updatedAt: room.updatedAt + 1 };
    await assertSucceeds(update(ref(as(hostUid), `rooms/${roomId}`), buildRoomPatch(room, renamed)));
    const stored = (await get(ref(as(hostUid), `rooms/${roomId}`))).val();
    expect(stored.name).toBe("Renamed by host");
    expect(stored.currentRace.bets[playerUid].amount).toBe(10);
  });

  it("settles from the server copy and voids tickets while betting is open", async () => {
    await joinAsPlayer();
    await assertSucceeds(set(ref(as(playerUid), `rooms/${roomId}/currentRace/bets/${playerUid}`), selfBet()));
    const proxy = createBet({
      playerId: playerUid,
      contestantIds: [room.contestants[1].id],
      type: "win",
      amount: 5,
      placedBy: "host",
    });
    const withProxy = addBet(room, proxy);
    await assertSucceeds(update(ref(as(hostUid), `rooms/${roomId}`), buildRoomPatch(room, withProxy)));
    await assertSucceeds(remove(ref(as(hostUid), `rooms/${roomId}/currentRace/bets/${proxy.id}`)));

    const fresh = normalizeRoom((await get(ref(as(hostUid), `rooms/${roomId}`))).val());
    const closed = setRaceStatus(fresh, "closed");
    const settled = settleRoom(
      closed,
      fresh.contestants.map((item) => item.id),
    );
    await assertSucceeds(update(ref(as(hostUid), `rooms/${roomId}`), buildRoomPatch(fresh, settled)));
    const stored = (await get(ref(as(hostUid), `rooms/${roomId}`))).val();
    expect(stored.currentRace.status).toBe("settled");
    expect(stored.raceHistory[0].bets).toHaveLength(1);
  });

  it("settles inside a full-room transaction against the server's state", async () => {
    await joinAsPlayer();
    await assertSucceeds(set(ref(as(playerUid), `rooms/${roomId}/currentRace/bets/${playerUid}`), selfBet()));
    const order = room.contestants.map((item) => item.id);
    const outcome = await runTransaction(ref(as(hostUid), `rooms/${roomId}`), (raw) => {
      if (raw === null) return raw;
      const next = settleRace(normalizeRoom(raw), room.currentRace.id, order);
      return next ? toRoomPayload(next) : undefined;
    });
    expect(outcome.committed).toBe(true);
    const stored = (await get(ref(as(hostUid), `rooms/${roomId}`))).val();
    expect(stored.currentRace.status).toBe("settled");
    expect(stored.raceHistory[0].bets).toHaveLength(1);
    // A participant cannot run the same transaction.
    await assertFails(
      runTransaction(ref(as(playerUid), `rooms/${roomId}`), (raw) =>
        raw ? { ...raw, name: "hijacked" } : raw,
      ),
    );
  });

  it("revokes a removed participant's access", async () => {
    await joinAsPlayer();
    await assertSucceeds(remove(ref(as(hostUid), `roomMembers/${roomId}/${playerUid}`)));
    await assertFails(get(ref(as(playerUid), `rooms/${roomId}`)));
  });

  it("deletes the room and its memberships in one atomic write", async () => {
    await joinAsPlayer();
    await assertFails(
      update(ref(as(playerUid)), { [`rooms/${roomId}`]: null, [`roomMembers/${roomId}`]: null }),
    );
    await assertSucceeds(
      update(ref(as(hostUid)), { [`rooms/${roomId}`]: null, [`roomMembers/${roomId}`]: null }),
    );
    await environment.withSecurityRulesDisabled(async (context) => {
      expect((await get(ref(context.database(), `rooms/${roomId}`))).exists()).toBe(false);
      expect((await get(ref(context.database(), `roomMembers/${roomId}`))).exists()).toBe(false);
    });
  });

  it("cannot change the host, schema or join code, and can delete the room", async () => {
    await assertFails(set(ref(as(hostUid), `rooms/${roomId}/hostUid`), "new-host"));
    await assertFails(set(ref(as(hostUid), `rooms/${roomId}/schemaVersion`), 1));
    await assertFails(set(ref(as(hostUid), `rooms/${roomId}/joinCode`), "2468"));
    await assertFails(set(ref(as(hostUid), `rooms/${roomId}/hostPin`), "1234"));
    await assertSucceeds(remove(ref(as(hostUid), `roomMembers/${roomId}`)));
    await assertSucceeds(remove(ref(as(hostUid), `rooms/${roomId}`)));
  });
});
