import { describe, expect, it } from "vitest";
import { biomeForRace, sceneForRace } from "../pass";

describe("ticket landscapes", () => {
  it("starts with the meadow by day and repeats every twelve races", () => {
    expect(sceneForRace(1)).toEqual({ biome: "meadow", light: "day" });
    expect(sceneForRace(13)).toEqual(sceneForRace(1));
    expect(sceneForRace(26)).toEqual(sceneForRace(2));
    expect(sceneForRace(0)).toEqual(sceneForRace(1));
  });

  it("changes both the landscape and the hour from one race to the next", () => {
    for (let n = 1; n <= 24; n++) {
      expect(sceneForRace(n + 1).biome).not.toBe(sceneForRace(n).biome);
      expect(sceneForRace(n + 1).light).not.toBe(sceneForRace(n).light);
    }
  });

  it("shows every landscape and every hour within a game night", () => {
    const night = Array.from({ length: 12 }, (_, i) => sceneForRace(i + 1));
    expect(new Set(night.map((s) => s.biome))).toEqual(
      new Set(["meadow", "snow", "desert", "coast", "lavender", "autumn", "lake", "sakura", "wheat"]),
    );
    expect(new Set(night.map((s) => s.light))).toEqual(new Set(["day", "golden", "dusk"]));
  });

  it("keeps biomeForRace as the scene's landscape", () => {
    for (let n = 0; n <= 13; n++) expect(biomeForRace(n)).toBe(sceneForRace(n).biome);
    expect([1, 2, 3, 4].map(biomeForRace)).toEqual(["meadow", "coast", "snow", "lavender"]);
  });

  it("hands out copies, so a caller cannot change the sequence", () => {
    sceneForRace(1).biome = "desert";
    expect(sceneForRace(1).biome).toBe("meadow");
  });
});
