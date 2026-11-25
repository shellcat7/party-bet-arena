/** Landscapes painted on tickets. */
export type Biome = "meadow" | "snow" | "desert";

const BIOMES: Biome[] = ["meadow", "snow", "desert"];

/** Each race gets its own landscape, so the tickets of a game night form a small set. */
export function biomeForRace(raceNumber: number): Biome {
  const index = Math.max(1, Math.floor(raceNumber) || 1) - 1;
  return BIOMES[index % BIOMES.length];
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A short, stable code for a ticket, shown like a booking reference (no 0/O or 1/I). */
export function ticketCode(id: string) {
  // FNV-1a, then read six base-32 digits from successive mixes of the hash.
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    code += CODE_ALPHABET[(hash >>> 0) % CODE_ALPHABET.length];
  }
  return code;
}
