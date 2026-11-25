/** Landscapes painted on tickets. */
export type Biome =
  "meadow" | "snow" | "desert" | "coast" | "lavender" | "autumn" | "lake" | "sakura" | "wheat";

/** The hour a ticket's landscape is painted at: full daylight, golden hour or dusk. */
export type Light = "day" | "golden" | "dusk";

/**
 * The scenes of a game night, in order. Every landscape and every hour appears; one race never
 * has the landscape or the hour of the race before it (nor does the twelfth the first's).
 */
const SCENES: readonly { biome: Biome; light: Light }[] = [
  { biome: "meadow", light: "day" },
  { biome: "coast", light: "golden" },
  { biome: "snow", light: "day" },
  { biome: "lavender", light: "dusk" },
  { biome: "autumn", light: "golden" },
  { biome: "lake", light: "day" },
  { biome: "desert", light: "golden" },
  { biome: "sakura", light: "day" },
  { biome: "wheat", light: "golden" },
  { biome: "snow", light: "dusk" },
  { biome: "coast", light: "day" },
  { biome: "lake", light: "dusk" },
];

/** Each race gets its own scene, so the tickets of a game night form a small collection. */
export function sceneForRace(raceNumber: number): { biome: Biome; light: Light } {
  const index = Math.max(1, Math.floor(raceNumber) || 1) - 1;
  return { ...SCENES[index % SCENES.length] };
}

/** The landscape of a race's scene. */
export function biomeForRace(raceNumber: number): Biome {
  return sceneForRace(raceNumber).biome;
}
