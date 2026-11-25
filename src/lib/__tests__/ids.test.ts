import { describe, expect, it } from "vitest";
import {
  buildInviteUrl,
  CODE_ALPHABET,
  createJoinCode,
  groupCode,
  normalizeCodeInput,
  parseInviteUrl,
  randomToken,
} from "../ids";

describe("random tokens", () => {
  it("only use the unambiguous alphabet", () => {
    const token = randomToken(512);
    expect([...token].every((char) => CODE_ALPHABET.includes(char))).toBe(true);
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[01IO]/);
  });

  it("are long enough to resist guessing", () => {
    expect(createJoinCode()).toHaveLength(16); // 80 bits of entropy
  });
});

describe("invite links", () => {
  const base = "https://example.com/party-bet-arena/";

  it("put credentials in the fragment so they never reach a server", () => {
    const url = new URL(buildInviteUrl(`${base}?utm=x#old`, { roomId: "ROOM", joinCode: "CODE" }));
    expect(url.search).toBe("");
    expect(url.hash).toBe("#roomId=ROOM&joinCode=CODE");
  });

  it("round-trip through the parser", () => {
    const link = buildInviteUrl(base, { roomId: "ABCDEFGHJKLM", joinCode: "ABCDEFGHJKLMNPQR" });
    expect(parseInviteUrl(link)).toEqual({ roomId: "ABCDEFGHJKLM", joinCode: "ABCDEFGHJKLMNPQR" });
  });

  it("accept older query-string links and normalise case", () => {
    expect(parseInviteUrl(`${base}?room=abcd&code=ef-gh`)).toEqual({ roomId: "ABCD", joinCode: "EFGH" });
  });

  it("return null for unrelated input", () => {
    expect(parseInviteUrl("not a url")).toBeNull();
    expect(parseInviteUrl(base)).toBeNull();
  });
});

describe("formatting", () => {
  it("groups codes for reading aloud and strips separators when typed", () => {
    expect(groupCode("ABCDEFGHJKLM")).toBe("ABCD EFGH JKLM");
    expect(normalizeCodeInput(" abcd-efgh jklm ")).toBe("ABCDEFGHJKLM");
  });
});
