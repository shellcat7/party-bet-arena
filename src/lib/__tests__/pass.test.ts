import { describe, expect, it } from "vitest";
import { biomeForRace } from "../pass";

describe("ticket landscapes", () => {
  it("cycles the landscape by race", () => {
    expect([1, 2, 3, 4].map(biomeForRace)).toEqual(["meadow", "snow", "desert", "meadow"]);
    expect(biomeForRace(0)).toBe("meadow");
  });
});
