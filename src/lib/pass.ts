/** Landscapes painted on tickets. */
export type Biome = "meadow" | "snow" | "desert";

const BIOMES: Biome[] = ["meadow", "snow", "desert"];

/** Each race gets its own landscape, so the tickets of a game night form a small set. */
export function biomeForRace(raceNumber: number): Biome {
  const index = Math.max(1, Math.floor(raceNumber) || 1) - 1;
  return BIOMES[index % BIOMES.length];
}
