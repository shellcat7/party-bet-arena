/**
 * Crockford-like alphabet without ambiguous characters (0/O, 1/I).
 * It has exactly 32 symbols, so `byte % 32` maps random bytes without modulo bias.
 */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_ID_LENGTH = 12;
export const JOIN_CODE_LENGTH = 16;
export const ROOM_ID_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;
export const JOIN_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{16}$/;

export function randomToken(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export function createRoomId() {
  return randomToken(ROOM_ID_LENGTH);
}

export function createJoinCode() {
  return randomToken(JOIN_CODE_LENGTH);
}

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Uppercases and removes separators people add when typing or pasting a code. */
export function normalizeCodeInput(value: string) {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

/** "ABCDEFGHJKLM" → "ABCD EFGH JKLM" for easier reading aloud. */
export function groupCode(value: string, size = 4) {
  return value.match(new RegExp(`.{1,${size}}`, "g"))?.join(" ") ?? value;
}

export type InviteCredentials = { roomId: string; joinCode: string };

/**
 * Reads invitation credentials from a URL. New invitations keep them in the fragment so they
 * never reach a server log; query parameters are accepted for older shared links.
 */
export function parseInviteUrl(raw: string, base?: string): InviteCredentials | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  const hash = new URLSearchParams(url.hash.slice(1));
  const query = url.searchParams;
  const read = (...keys: string[]) => {
    for (const key of keys) {
      const value = hash.get(key) ?? query.get(key);
      if (value) return normalizeCodeInput(value);
    }
    return "";
  };
  const roomId = read("roomId", "room", "id");
  const joinCode = read("joinCode", "code");
  return roomId && joinCode ? { roomId, joinCode } : null;
}

export function buildInviteUrl(baseHref: string, credentials: InviteCredentials) {
  const url = new URL(baseHref);
  url.search = "";
  url.hash = new URLSearchParams({ roomId: credentials.roomId, joinCode: credentials.joinCode }).toString();
  return url.toString();
}
