import { createRoom, defaultCreateInput } from "../room";
import type { Player, Room } from "../types";

export function player(id: string, balance = 1000, extra: Partial<Player> = {}): Player {
  return { id, uid: id, name: id, balance, isOffline: false, accent: "#3568ff", emoji: "🎮", ...extra };
}

/** A fresh room with fixed-odds racers A–D (1.5x, 2x, 4x, 8x) and two bettors. */
export function testRoom(overrides: Partial<Room["settings"]> = {}): Room {
  const room = createRoom({ ...defaultCreateInput, name: "Test", contestantCount: 4 }, "host-uid", 1_000);
  const odds = [1.5, 2, 4, 8];
  return {
    ...room,
    settings: { ...room.settings, marketOdds: false, autoOdds: false, allowDebt: false, ...overrides },
    players: [player("alice"), player("bob")],
    contestants: room.contestants.map((contestant, index) => ({
      ...contestant,
      id: "ABCD"[index],
      name: `Racer ${"ABCD"[index]}`,
      odds: odds[index],
    })),
  };
}
