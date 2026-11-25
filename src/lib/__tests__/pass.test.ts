import { describe, expect, it } from "vitest";
import { biomeForRace, ticketCode } from "../pass";

describe("ticket helpers", () => {
  it("cycles the landscape by race", () => {
    expect([1, 2, 3, 4].map(biomeForRace)).toEqual(["meadow", "snow", "desert", "meadow"]);
    expect(biomeForRace(0)).toBe("meadow");
  });

  it("gives every ticket a stable six-character code without ambiguous characters", () => {
    const code = ticketCode("uid-123");
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(ticketCode("uid-123")).toBe(code);
    const codes = new Set(Array.from({ length: 500 }, (_, index) => ticketCode(`bet-${index}`)));
    expect(codes.size).toBeGreaterThan(495);
  });
});
