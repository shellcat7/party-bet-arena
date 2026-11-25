import { useEffect, useRef } from "react";
import "../../styles/pixel-scene.css";

/*
 * PixelCarriers: a small pixel-art waiting scene. Hard-hat helpers carry coloured blocks (the race-lane
 * colours) across a windy meadow, toss them onto a pyramid, cheer and go back for more. When the pyramid
 * is finished a pennant pops up, then the blocks vanish in a puff and the crew starts again.
 *
 * Everything is drawn on one canvas at a low logical resolution, scaled up by an integer factor in device
 * pixels, so every logical pixel is a crisp square. Sprites are palette-indexed strings, rasterised once.
 */

export type PixelCarriersProps = {
  /** Accessible description of what the user is waiting for, e.g. "Collecting bets…". */
  label: string;
  /** Freeze the animation on its current frame. */
  paused?: boolean;
  className?: string;
  /** Changes the scenery layout, colours of the crew and timing. Same seed, same scene. */
  seed?: number;
};

export function PixelCarriers({ label, paused = false, className, seed = 1 }: PixelCarriersProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneController | null>(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
    sceneRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const scene = startScene(root, canvas, seed, pausedRef.current);
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [seed]);

  return (
    <div ref={rootRef} className={className ? `pixel-scene ${className}` : "pixel-scene"}>
      <canvas ref={canvasRef} className="pixel-scene__canvas" role="img" aria-label={label} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Palette                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

const INK = "#15171b";
const LANES = ["#ff4c69", "#3568ff", "#f2c114", "#25bf45", "#9d7cff", "#ff8f3f", "#14b8c4", "#e255c8"];

type Theme = "light" | "dark";

type ScenePalette = {
  sky: string[];
  glow: string;
  orb: string;
  orbShade: string;
  orbRim: string;
  cloud: string;
  cloudLight: string;
  cloudShade: string;
  star: string[];
  farHill: string;
  farHillEdge: string;
  nearHill: string;
  nearHillEdge: string;
  bush: string;
  bushLight: string;
  groundEdge: string;
  ground: string;
  groundDark: string;
  groundDeep: string;
  fleck: string[];
  blade: string;
  bladeTip: string;
  stem: string;
  dust: string;
  dustShade: string;
  bird: string;
};

const PALETTES: Record<Theme, ScenePalette> = {
  light: {
    sky: ["#79c3fb", "#8ccdfc", "#a0d7fd", "#b3e0fe", "#c4e6ff"],
    glow: "#d2edff",
    orb: "#fff7cf",
    orbShade: "#ffe9a0",
    orbRim: "#ffd65c",
    cloud: "#ffffff",
    cloudLight: "#ffffff",
    cloudShade: "#d9ebfa",
    star: [],
    farHill: "#a9dcc6",
    farHillEdge: "#bfe6d3",
    nearHill: "#7fcf93",
    nearHillEdge: "#97daa6",
    bush: "#5fb878",
    bushLight: "#74c68a",
    groundEdge: "#a2e46e",
    ground: "#62c654",
    groundDark: "#4fb24a",
    groundDeep: "#43a043",
    fleck: ["#ffffff", "#ffe066", "#ff8fb0"],
    blade: "#4cae48",
    bladeTip: "#8fdc5e",
    stem: "#3a9a44",
    dust: "#ffffff",
    dustShade: "#e3ecf2",
    bird: "#45526b",
  },
  dark: {
    sky: ["#0a1230", "#0e1940", "#13214f", "#18295b", "#1a2b5c"],
    glow: "#1d3065",
    orb: "#fff4cc",
    orbShade: "#e8d79c",
    orbRim: "#fff4cc",
    cloud: "#2b3866",
    cloudLight: "#3b4b82",
    cloudShade: "#232e57",
    star: ["#6f7fb8", "#b9c8f5", "#ffffff"],
    farHill: "#1a2d57",
    farHillEdge: "#21386a",
    nearHill: "#1c3d4f",
    nearHillEdge: "#244c5d",
    bush: "#173342",
    bushLight: "#1e4050",
    groundEdge: "#4b8f62",
    ground: "#2f6b4c",
    groundDark: "#285e43",
    groundDeep: "#22523b",
    fleck: ["#c9d4f2", "#d9c77a", "#c98aa8"],
    blade: "#255c41",
    bladeTip: "#4e9a6c",
    stem: "#2c6a47",
    dust: "#c7d0ec",
    dustShade: "#9aa6cf",
    bird: "#45526b",
  },
};

/** Body colours of the crew: [body, shade]. */
const BODIES: [string, string][] = [
  ["#fff4df", "#efcca4"],
  ["#dcf6e4", "#a5d9b8"],
  ["#ece4ff", "#c3b2f2"],
  ["#ffe3d3", "#f2b89d"],
];

/* ------------------------------------------------------------------------------------------------ */
/* Sprites                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

type Pal = Record<string, string>;

/** Crew body, 13 wide. o ink, h/l/d hat, b/s body, p cheeks. Eyes are added per face. */
const BODY = [
  "....ooooo....",
  "...olhhhho...",
  "..olhhhhhho..",
  "..oddddddddo.",
  ".obbbbbbbbbo.",
  ".obbbbbbbbbo.",
  "obbbbbbbbbbbo",
  "obbbpbbbbbpbo",
  "osbbbbbbbbbbo",
  ".osbbbbbbbso.",
  "..ossssssso..",
  "...ooooooo...",
];

/** Squashed body for the wind-up before a toss. */
const CROUCH = [
  "....ooooo....",
  "...olhhhho...",
  "..olhhhhhho..",
  ".ooddddddddo.",
  "obbbbbbbbbbbo",
  "obbbbbbbbbbbo",
  "obbbpbbbbbpbo",
  "osbbbbbbbbbbo",
  ".ossssssssso.",
  "..ooooooooo..",
];

const FEET_APART = "...oo...oo...";
const FEET_TOGETHER = "....oo.oo....";

/** Raised arms with little mitts; the top row sits level with the carried block's middle. */
const ARMS = [
  ".oo.......oo.",
  "obbo.....obbo",
  "obbo.....obbo",
  ".oo.......oo.",
  ".o.........o.",
  ".o.........o.",
];

const BLOCK = ["ooooooo", "owllllo", "olbbbdo", "olbbbdo", "olbbbdo", "odddddo", "ooooooo"];
const BLOCK_SQUASH = [".......", "ooooooo", "owllllo", "olbbbdo", "olbbbdo", "odddddo", "ooooooo"];

const HEART = [".r.r.", "rwrrr", "rrrrr", ".rrr.", "..r.."];

const SPARKLE_BIG = ["..w..", "..w..", "wwyww", "..w..", "..w.."];
const SPARKLE_SMALL = [".....", "..w..", ".wyw.", "..w..", "....."];

const PENNANT = [
  ["o.....", "ooo...", "ohhoo.", "ohhhho", "ohhoo.", "ooo...", "o.....", "o....."],
  ["o.....", "oooo..", "ohhhoo", "ohhoo.", "ooo...", "o.....", "o.....", "o....."],
];

/** Poof: a round cloud that splits into four puffs and fades out. 9x9, drawn 1px up-left of the block. */
const PUFF = [
  [
    ".........",
    "...www...",
    "..wwwww..",
    ".wwwwwww.",
    ".wwwwwww.",
    ".wwwwwgw.",
    "..wwggg..",
    "...ggg...",
    ".........",
  ],
  [
    ".ww...ww.",
    "wwww.wwww",
    "wwwg.wwwg",
    ".gg...gg.",
    ".........",
    ".ww...ww.",
    "wwww.wwww",
    "wwwg.wwwg",
    ".gg...gg.",
  ],
  [
    "ww.....ww",
    "wg.....wg",
    ".........",
    ".........",
    ".........",
    ".........",
    ".........",
    "ww.....ww",
    "wg.....wg",
  ],
];

const DUST = [["ww.", "wgg", ".g."], ["w.", "gg"], ["g"]];

const BIRD = [
  ["o...o", ".o.o.", "..o.."],
  [".....", ".ooo.", "o...o"],
];

/** Far-away hot-air balloon (no outline: it belongs to the background). */
const BALLOON = [
  "..AAYAA..",
  ".HAAYAAS.",
  "HAAYYYAAS",
  "HAAYYYAAS",
  "AAAYYYASS",
  ".AAAYAAS.",
  "..AAYAS..",
  "...AYS...",
  "...k.k...",
  "...k.k...",
  "...KKK...",
  "...KKK...",
];

/** Nodding flower head, outlined like the crew. */
const FLOWER = [".o.o.", "oPoPo", "oPcPo", "oPPPo", ".ooo."];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const out = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Rasterise a palette-indexed sprite into its own small canvas (optionally mirrored). */
function paint(rows: readonly string[], pal: Pal, flip = false): HTMLCanvasElement {
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return c;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const colour = pal[row[x]];
      if (!colour) continue;
      g.fillStyle = colour;
      g.fillRect(flip ? w - 1 - x : x, y, 1, 1);
    }
  }
  return c;
}

type Face = "open" | "blink" | "look" | "happy";
type Pose = "walk" | "carry" | "crouch" | "arms";

/** Compose a crew frame on a 13x19 grid: rows 0-5 are the space for the carried block. */
function crewRows(pose: Pose, face: Face, step: 0 | 1, lamp: boolean): string[] {
  const grid = Array.from({ length: 19 }, () => ".............".split(""));
  const stamp = (rows: readonly string[], dy: number) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== "." && grid[y + dy]) grid[y + dy][x] = row[x];
      }
    });
  };
  const crouch = pose === "crouch";
  const lift = step === 1 && (pose === "walk" || pose === "carry") ? 1 : 0;
  const top = crouch ? 8 : 6 - lift;
  stamp(crouch ? CROUCH : BODY, top);
  stamp([lift ? FEET_TOGETHER : FEET_APART], 18 - lift);
  if (pose !== "walk") stamp(ARMS, crouch ? 6 : 4 - lift);
  const eye = top + (crouch ? 4 : 5);
  const set = (x: number, y: number, c: string) => {
    grid[y][x] = c;
  };
  if (face === "open") {
    set(6, eye, "o");
    set(6, eye + 1, "o");
    set(9, eye, "o");
    set(9, eye + 1, "o");
  } else if (face === "blink") {
    set(6, eye + 1, "o");
    set(9, eye + 1, "o");
  } else if (face === "look") {
    set(6, eye - 1, "o");
    set(6, eye, "o");
    set(9, eye - 1, "o");
    set(9, eye, "o");
  } else {
    set(5, eye + 1, "o");
    set(6, eye, "o");
    set(7, eye + 1, "o");
    set(8, eye + 1, "o");
    set(9, eye, "o");
    set(10, eye + 1, "o");
    set(7, eye + 2, "m");
    set(8, eye + 2, "m");
  }
  if (lamp) {
    // Night shift: a little headlamp on the front of the hat.
    set(9, top + 2, "y");
    set(10, top + 2, "y");
  }
  return grid.map((r) => r.join(""));
}

/* ------------------------------------------------------------------------------------------------ */
/* World model                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Slot = { x: number; y: number; row: number; colour: number; filled: boolean; landedAt: number };

type CrewState = "in" | "windup" | "throw" | "watch" | "cheer" | "turn" | "out";

type Crew = {
  id: number;
  x: number;
  dir: 1 | -1;
  state: CrewState;
  st: number;
  colour: number;
  slot: number;
  body: number;
  speed: number;
  walked: number;
  nextBlink: number;
  blinkUntil: number;
  hop: number;
};

type Flying = {
  slot: number;
  colour: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  arc: number;
};

type ParticleKind = "dust" | "puff" | "heart" | "sparkle" | "petal";
type Particle = {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  delay: number;
};

type Cloud = { x: number; y: number; w: number; h: number; speed: number; shape: number };
type Star = { x: number; y: number; base: number; rate: number; phase: number };
type Tuft = { x: number; blades: { dx: number; h: number; splay: number }[]; front: boolean };
type Firefly = { x: number; y: number; phase: number; rate: number; drift: number };
type Bird = { x: number; y: number; dir: 1 | -1; speed: number; pair: boolean; phase: number };
type Meteor = { x: number; y: number; t: number };
type Balloon = { x: number; y: number; dir: 1 | -1; speed: number };

type Phase = "build" | "done" | "poof" | "rest";

type World = {
  W: number;
  H: number;
  groundY: number;
  footY: number;
  skyH: number;
  rng: Rng;
  t: number;
  phase: Phase;
  phaseT: number;
  slots: Slot[];
  reserved: number;
  filled: number;
  /** Colours of the next round, drawn when the pyramid completes so its first helper can set off early. */
  nextColours: number[] | null;
  earlyCrew: boolean;
  tossX: number;
  stackLeft: number;
  stackRight: number;
  crew: Crew[];
  nextCrewId: number;
  spawnIn: number;
  flying: Flying[];
  particles: Particle[];
  clouds: Cloud[];
  stars: Star[];
  tufts: Tuft[];
  flowerX: number;
  flowerH: number;
  flowerColour: number;
  fireflies: Firefly[];
  bird: Bird | null;
  birdIn: number;
  meteor: Meteor | null;
  meteorIn: number;
  balloon: Balloon | null;
  balloonIn: number;
  orbX: number;
  orbY: number;
  hillSeed: number;
  gustAt: number;
  gustPetals: boolean;
};

const BLOCK_PITCH = 6;

function shuffledColours(rng: Rng): number[] {
  const order = LANES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function buildSlots(world: World, base: number) {
  const width = base * BLOCK_PITCH + 1;
  const cx = Math.round(world.W * 0.6);
  let left = cx - Math.floor(width / 2);
  left = Math.min(left, world.W - width - 18);
  left = Math.max(left, 34);
  const slots: Slot[] = [];
  const bottom = world.footY - 6;
  for (let row = 0; row < base; row++) {
    for (let i = 0; i < base - row; i++) {
      slots.push({
        x: left + row * 3 + i * BLOCK_PITCH,
        y: bottom - row * BLOCK_PITCH,
        row,
        colour: 0,
        filled: false,
        landedAt: -1,
      });
    }
  }
  world.slots = slots;
  world.stackLeft = left;
  world.stackRight = left + width;
  world.tossX = left - 15;
}

function colourQueue(world: World): number[] {
  const queue: number[] = [];
  while (queue.length < world.slots.length) queue.push(...shuffledColours(world.rng));
  return queue;
}

function resetStack(world: World) {
  world.reserved = world.earlyCrew ? 1 : 0;
  world.filled = 0;
  for (const slot of world.slots) {
    slot.filled = false;
    slot.landedAt = -1;
  }
  const queue = world.nextColours ?? colourQueue(world);
  world.nextColours = null;
  world.earlyCrew = false;
  world.slots.forEach((slot, i) => {
    slot.colour = queue[i];
  });
}

function createWorld(W: number, H: number, seed: number): World {
  const rng = mulberry32(seed * 7919 + 17);
  const groundH = H >= 80 ? 12 : H >= 56 ? 10 : 8;
  const groundY = H - groundH;
  const world: World = {
    W,
    H,
    groundY,
    footY: groundY + 2,
    skyH: groundY,
    rng,
    t: 0,
    phase: "build",
    phaseT: 0,
    slots: [],
    reserved: 0,
    filled: 0,
    nextColours: null,
    earlyCrew: false,
    tossX: 0,
    stackLeft: 0,
    stackRight: 0,
    crew: [],
    nextCrewId: 0,
    spawnIn: 0.25,
    flying: [],
    particles: [],
    clouds: [],
    stars: [],
    tufts: [],
    flowerX: 0,
    flowerH: 0,
    flowerColour: 0,
    fireflies: [],
    bird: null,
    birdIn: 4 + rng() * 6,
    meteor: null,
    meteorIn: 5 + rng() * 8,
    balloon: null,
    balloonIn: 2 + rng() * 6,
    orbX: W - 20,
    orbY: Math.max(3, Math.round(groundY * 0.12)),
    hillSeed: rng() * 1000,
    gustAt: 3 + rng() * 4,
    gustPetals: false,
  };

  const rowsFit = Math.floor((world.footY - 10) / BLOCK_PITCH);
  const widthFit = Math.floor((W - 52) / BLOCK_PITCH);
  const base = Math.max(2, Math.min(5, rowsFit, widthFit, H >= 80 ? 5 : H >= 52 ? 4 : 3));
  buildSlots(world, base);
  resetStack(world);

  const cloudCount = Math.max(2, Math.min(6, Math.round(W / 48) + (groundY > 60 ? 1 : 0)));
  for (let i = 0; i < cloudCount; i++) {
    const w = 11 + Math.floor(rng() * 12);
    world.clouds.push({
      x: (W / cloudCount) * i + rng() * 20 - 10,
      y: 2 + Math.floor(rng() * Math.max(2, groundY * 0.42)),
      w,
      h: 4 + Math.floor(w / 6),
      speed: 1.2 + rng() * 1.8,
      shape: Math.floor(rng() * 100000),
    });
  }

  const starCount = Math.min(60, Math.round((W * groundY) / 110));
  for (let i = 0; i < starCount; i++) {
    const x = Math.floor(rng() * W);
    const y = 1 + Math.floor(rng() * groundY * 0.62);
    if (Math.abs(x - world.orbX - 4) < 9 && Math.abs(y - world.orbY - 4) < 9) continue;
    world.stars.push({ x, y, base: rng() < 0.25 ? 1 : 0, rate: 0.6 + rng() * 1.8, phase: rng() * 10 });
  }

  // Grass clumps: a tall middle blade with two shorter ones splayed outwards.
  const clump = (x: number, tall: number, front: boolean) => {
    const side = Math.max(1, tall - 1 - Math.floor(rng() * 2));
    world.tufts.push({
      x,
      front,
      blades: [
        { dx: -1, h: side, splay: -1 },
        { dx: 0, h: tall, splay: 0 },
        { dx: 1, h: Math.max(1, tall - 1 - Math.floor(rng() * 2)), splay: 1 },
      ],
    });
  };
  for (let x = 2 + Math.floor(rng() * 4); x < W; x += 5 + Math.floor(rng() * 9)) {
    clump(x, 2 + Math.floor(rng() * 3), false);
  }
  for (let x = 3 + Math.floor(rng() * 6); x < W; x += 9 + Math.floor(rng() * 14)) {
    clump(x, 2 + Math.floor(rng() * 2), true);
  }

  const room = W - world.stackRight;
  world.flowerX = Math.min(W - 6, world.stackRight + Math.max(6, Math.round(room * 0.42)));
  world.flowerH = H >= 80 ? 8 : 6;
  world.flowerColour = rng() < 0.5 ? 0 : 7;

  const flies = Math.max(2, Math.min(6, Math.round(W / 36)));
  for (let i = 0; i < flies; i++) {
    world.fireflies.push({
      x: rng() * W,
      y: groundY - 4 - rng() * Math.min(18, groundY * 0.35),
      phase: rng() * 10,
      rate: 0.8 + rng() * 0.9,
      drift: 2 + rng() * 3,
    });
  }
  return world;
}

/* ------------------------------------------------------------------------------------------------ */
/* Simulation                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

function slotTarget(world: World, crew: Crew): number {
  // Queue behind whoever is still heading for (or standing at) the toss spot.
  let target = world.tossX;
  for (const other of world.crew) {
    if (other === crew || other.dir !== 1 || other.state === "out" || other.id > crew.id) continue;
    target = Math.min(target, other.x - 16);
  }
  return target;
}

function spawnParticle(
  world: World,
  kind: ParticleKind,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
  life = 0.4,
  delay = 0,
) {
  world.particles.push({ kind, x, y, vx, vy, t: 0, life, delay });
}

function setPhase(world: World, phase: Phase) {
  world.phase = phase;
  world.phaseT = 0;
}

function step(world: World, dt: number) {
  const { rng } = world;
  world.t += dt;
  world.phaseT += dt;
  const t = world.t;

  // Spawning. While the finished pyramid is celebrated, the next round's first helper already sets off.
  const early = world.phase === "done" && world.phaseT > 0.4 && !world.earlyCrew ? world.nextColours : null;
  if (world.phase === "build" || early) {
    world.spawnIn -= dt;
    const walkingIn = world.crew.filter((c) => c.dir === 1 && c.state === "in");
    const entranceFree = !walkingIn.some((c) => c.x < 4);
    const free = early || world.reserved < world.slots.length;
    if ((world.spawnIn <= 0 || early) && free && entranceFree && walkingIn.length < 2) {
      const slot = early ? 0 : world.reserved++;
      if (early) world.earlyCrew = true;
      world.crew.push({
        id: world.nextCrewId++,
        x: -14,
        dir: 1,
        state: "in",
        st: 0,
        colour: early ? early[0] : world.slots[slot].colour,
        slot,
        body: Math.floor(rng() * BODIES.length),
        speed: 16 + rng() * 4,
        walked: 0,
        nextBlink: t + 0.6 + rng() * 2.5,
        blinkUntil: 0,
        hop: 0,
      });
      world.spawnIn = 0.9 + rng() * 1.6;
    }
  }

  // Crew.
  for (const crew of world.crew) {
    crew.st += dt;
    if (t >= crew.nextBlink) {
      crew.blinkUntil = t + 0.12;
      crew.nextBlink = t + 1.6 + rng() * 2.8;
    }
    switch (crew.state) {
      case "in": {
        const target = slotTarget(world, crew);
        if (crew.x < target) {
          const move = Math.min(target - crew.x, crew.speed * dt);
          crew.x += move;
          crew.walked += move;
        }
        if (crew.x >= world.tossX - 0.01 && world.phase === "build") {
          crew.x = world.tossX;
          crew.state = "windup";
          crew.st = 0;
        }
        break;
      }
      case "windup":
        if (crew.st >= 0.2) {
          crew.state = "throw";
          crew.st = 0;
          const slot = world.slots[crew.slot];
          const x0 = Math.round(crew.x) + 3;
          const y0 = world.footY - 18;
          const dist = Math.abs(slot.x - x0) + Math.abs(slot.y - y0) * 0.5;
          world.flying.push({
            slot: crew.slot,
            colour: crew.colour,
            x0,
            y0,
            x1: slot.x,
            y1: slot.y,
            t: 0,
            dur: 0.42 + dist / 90,
            arc: 7 + dist * 0.12,
          });
          crew.colour = -1;
        }
        break;
      case "throw":
        if (crew.st >= 0.22) {
          crew.state = "watch";
          crew.st = 0;
        }
        break;
      case "watch":
        if (world.slots[crew.slot].filled) {
          crew.state = "cheer";
          crew.st = 0;
          spawnParticle(world, "heart", Math.round(crew.x) + 4, world.footY - 22, 0, -9, 0.7);
        }
        break;
      case "cheer": {
        const hopLen = 0.28;
        const k = (crew.st % hopLen) / hopLen;
        const prevHop = crew.hop;
        crew.hop = crew.st < hopLen * 2 ? Math.round(Math.sin(Math.PI * k) * 4) : 0;
        if (prevHop > 0 && crew.hop === 0) {
          spawnParticle(world, "dust", Math.round(crew.x) + 1, world.footY - 2, -6, -2, 0.3);
          spawnParticle(world, "dust", Math.round(crew.x) + 10, world.footY - 2, 6, -2, 0.3);
        }
        if (crew.st >= hopLen * 2 + 0.12) {
          crew.hop = 0;
          crew.state = "turn";
          crew.st = 0;
          crew.dir = -1;
        }
        break;
      }
      case "turn":
        if (crew.st >= 0.2) {
          crew.state = "out";
          crew.st = 0;
        }
        break;
      case "out": {
        const move = crew.speed * 1.1 * dt;
        crew.x -= move;
        crew.walked += move;
        break;
      }
    }
  }
  world.crew = world.crew.filter((c) => c.x > -18);

  // Blocks in flight.
  for (const fly of world.flying) {
    fly.t += dt;
    if (fly.t >= fly.dur) {
      const slot = world.slots[fly.slot];
      slot.filled = true;
      slot.landedAt = t;
      world.filled++;
      if (slot.row === 0) {
        // Dust only where it is not covered by a neighbouring block.
        const left = world.slots.find((o) => o.row === 0 && o.x === slot.x - BLOCK_PITCH);
        const right = world.slots.find((o) => o.row === 0 && o.x === slot.x + BLOCK_PITCH);
        if (!left?.filled) spawnParticle(world, "dust", slot.x - 2, slot.y + 4, -7, -3, 0.32);
        if (!right?.filled) spawnParticle(world, "dust", slot.x + 6, slot.y + 4, 7, -3, 0.32);
      }
    }
  }
  world.flying = world.flying.filter((f) => f.t < f.dur);

  // Pyramid lifecycle.
  if (world.phase === "build" && world.filled >= world.slots.length && world.flying.length === 0) {
    setPhase(world, "done");
    world.nextColours = colourQueue(world);
    const top = world.slots[world.slots.length - 1];
    for (let i = 0; i < 4; i++) {
      const sx = world.stackLeft - 3 + Math.floor(rng() * (world.stackRight - world.stackLeft + 2));
      const sy = top.y - 4 + Math.floor(rng() * (world.footY - top.y - 6));
      spawnParticle(world, "sparkle", sx, sy, 0, 0, 0.6, 0.45 + i * 0.32);
    }
  } else if (world.phase === "done" && world.phaseT >= 2.4) {
    setPhase(world, "poof");
    const rows = world.slots.reduce((m, s) => Math.max(m, s.row), 0);
    for (const slot of world.slots) {
      spawnParticle(world, "puff", slot.x - 1, slot.y - 1, 0, -2, 0.45, (rows - slot.row) * 0.07);
    }
    const top = world.slots[world.slots.length - 1];
    spawnParticle(world, "puff", top.x + 1, top.y - 8, 0, -2, 0.45, 0);
  } else if (world.phase === "poof") {
    const rows = world.slots.reduce((m, s) => Math.max(m, s.row), 0);
    for (const slot of world.slots) {
      if (slot.filled && world.phaseT >= (rows - slot.row) * 0.07 + 0.08) slot.filled = false;
    }
    if (world.phaseT >= rows * 0.07 + 0.6) setPhase(world, "rest");
  } else if (world.phase === "rest" && world.phaseT >= 0.45) {
    resetStack(world);
    setPhase(world, "build");
    world.spawnIn = 0.6;
  }

  // Particles.
  for (const p of world.particles) {
    if (p.delay > 0) {
      p.delay -= dt;
      continue;
    }
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  world.particles = world.particles.filter((p) => p.t < p.life);

  // Sky.
  for (const cloud of world.clouds) {
    cloud.x += cloud.speed * dt;
    if (cloud.x > world.W + 2) cloud.x = -cloud.w - 2 - rng() * 10;
  }
  if (world.bird) {
    const bird = world.bird;
    bird.x += bird.dir * bird.speed * dt;
    if (bird.x < -20 || bird.x > world.W + 20) {
      world.bird = null;
      world.birdIn = 9 + rng() * 12;
    }
  } else {
    world.birdIn -= dt;
    if (world.birdIn <= 0) {
      const dir = rng() < 0.5 ? 1 : -1;
      world.bird = {
        x: dir === 1 ? -12 : world.W + 12,
        y: 4 + Math.floor(rng() * Math.max(3, world.skyH * 0.38)),
        dir,
        speed: 16 + rng() * 8,
        pair: rng() < 0.5,
        phase: rng() * 6,
      };
    }
  }
  if (world.meteor) {
    world.meteor.t += dt;
    if (world.meteor.t > 0.55) {
      world.meteor = null;
      world.meteorIn = 7 + rng() * 14;
    }
  } else {
    world.meteorIn -= dt;
    if (world.meteorIn <= 0) {
      world.meteor = {
        x: world.W * (0.3 + rng() * 0.7),
        y: 2 + rng() * world.skyH * 0.25,
        t: 0,
      };
    }
  }
  if (world.skyH >= 46) {
    if (world.balloon) {
      const b = world.balloon;
      b.x += b.dir * b.speed * dt;
      if (b.x < -12 || b.x > world.W + 12) {
        world.balloon = null;
        world.balloonIn = 18 + rng() * 22;
      }
    } else {
      world.balloonIn -= dt;
      if (world.balloonIn <= 0) {
        const dir = rng() < 0.5 ? 1 : -1;
        world.balloon = {
          x: dir === 1 ? -10 : world.W + 10,
          y: world.orbY + 13 + Math.floor(rng() * Math.max(1, world.skyH * 0.25 - 6)),
          dir,
          speed: 2.2 + rng() * 1.2,
        };
      }
    }
  }
  // Each gust carries a few petals across, riding the same front that bends the grass.
  if (!world.gustPetals && t >= world.gustAt) {
    world.gustPetals = true;
    const count = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i++) {
      const y = world.groundY - 5 - Math.floor(rng() * Math.min(16, world.skyH * 0.45));
      spawnParticle(world, "petal", -22 - i * 9, y, 46, -1 - rng() * 2, (world.W + 40) / 46);
    }
  }
  if (t > world.gustAt + (world.W + 60) / 46) {
    world.gustAt = t + 2 + rng() * 6;
    world.gustPetals = false;
  }
}

/**
 * Advance a fresh world, without drawing, to a lively moment: the pyramid about half built and a helper
 * mid-hop with its heart. Every scene starts here, so a paused or reduced-motion scene shows this frame.
 */
function prewarm(world: World) {
  const half = Math.ceil(world.slots.length / 2);
  for (let i = 0; i < 120 * 20; i++) {
    step(world, 1 / 20);
    if (world.filled >= half && world.crew.some((c) => c.state === "cheer" && c.hop >= 3)) return;
  }
}

/** Wind lean (-1..2) for something standing at x; quantised to the sprite tick so grass moves in steps. */
function lean(world: World, x: number): number {
  const tq = Math.floor(world.t * 10) / 10;
  const breeze = 0.55 + 0.75 * Math.sin(tq * 2.1 - x * 0.09) + 0.25 * Math.sin(tq * 3.7 + x * 0.21);
  const front = (tq - world.gustAt) * 46 - 20;
  const gust = 1.3 * Math.exp(-(((x - front) / 16) ** 2));
  return Math.max(-1, Math.min(2, Math.round(breeze + gust)));
}

/* ------------------------------------------------------------------------------------------------ */
/* Rendering                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

type Art = {
  theme: Theme;
  pal: ScenePalette;
  sky: HTMLCanvasElement;
  land: HTMLCanvasElement;
  clouds: Map<number, HTMLCanvasElement>;
  sprites: Map<string, HTMLCanvasElement>;
};

function layer(W: number, H: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return [c, c.getContext("2d")];
}

function paintSky(world: World, pal: ScenePalette, theme: Theme): HTMLCanvasElement {
  const { W, skyH } = world;
  const [c, g] = layer(W, world.H);
  if (!g) return c;
  const bands = pal.sky.length;
  for (let y = 0; y < skyH; y++) {
    const band = Math.min(bands - 1, Math.floor((y * bands) / skyH));
    const nextBand = Math.min(bands - 1, Math.floor(((y + 1) * bands) / skyH));
    g.fillStyle = pal.sky[band];
    g.fillRect(0, y, W, 1);
    if (nextBand !== band) {
      // One checkerboard row softens each band edge.
      g.fillStyle = pal.sky[nextBand];
      for (let x = y % 2; x < W; x += 2) g.fillRect(x, y, 1, 1);
    }
  }
  g.fillStyle = pal.sky[bands - 1];
  g.fillRect(0, skyH, W, world.H - skyH);

  // Sun or moon with a dithered halo.
  const ox = world.orbX;
  const oy = world.orbY;
  const cx = ox + 4;
  const cy = oy + 4;
  for (let y = -8; y <= 8; y++) {
    for (let x = -8; x <= 8; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > 5.6 && d < 7.2 && (x + y) % 2 === 0) {
        g.fillStyle = pal.glow;
        g.fillRect(cx + x, cy + y, 1, 1);
      }
    }
  }
  for (let y = -4; y <= 4; y++) {
    for (let x = -4; x <= 4; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > 4.6) continue;
      if (theme === "dark") {
        // Crescent: cut a second disc out of the top right.
        const cut = Math.sqrt((x - 2.2) ** 2 + (y + 1.6) ** 2);
        if (cut < 3.9) continue;
        g.fillStyle = d > 3.6 || x > 1 ? pal.orbShade : pal.orb;
      } else {
        g.fillStyle = d > 3.7 ? pal.orbRim : x + y > 2 ? pal.orbShade : pal.orb;
      }
      g.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  return c;
}

function paintLand(world: World, pal: ScenePalette): HTMLCanvasElement {
  const { W, H, groundY } = world;
  const [c, g] = layer(W, H);
  if (!g) return c;
  const rng = mulberry32(Math.floor(world.hillSeed * 1000) + 3);
  const p1 = rng() * 10;
  const p2 = rng() * 10;
  const p3 = rng() * 10;
  const farMax = Math.max(6, Math.min(24, Math.round(world.skyH * 0.3)));
  const nearMax = Math.max(4, Math.round(farMax * 0.55));
  const farTop: number[] = [];
  const nearTop: number[] = [];
  for (let x = 0; x < W; x++) {
    const f = farMax * (0.62 + 0.26 * Math.sin(x * 0.045 + p1) + 0.12 * Math.sin(x * 0.13 + p2));
    const n = nearMax * (0.55 + 0.3 * Math.sin(x * 0.07 + p3) + 0.15 * Math.sin(x * 0.17 + p1));
    farTop.push(groundY - Math.round(f));
    nearTop.push(groundY - Math.round(n));
  }
  for (let x = 0; x < W; x++) {
    g.fillStyle = pal.farHill;
    g.fillRect(x, farTop[x], 1, groundY - farTop[x]);
    g.fillStyle = pal.farHillEdge;
    g.fillRect(x, farTop[x], 1, 1);
  }
  for (let x = 0; x < W; x++) {
    g.fillStyle = pal.nearHill;
    g.fillRect(x, nearTop[x], 1, groundY - nearTop[x]);
    g.fillStyle = pal.nearHillEdge;
    g.fillRect(x, nearTop[x], 1, 1);
  }
  // Round bushes dotted along the near hills.
  for (let x = 3 + Math.floor(rng() * 8); x < W - 3; x += 9 + Math.floor(rng() * 16)) {
    const y = nearTop[x];
    if (y > groundY - 3) continue;
    g.fillStyle = pal.bush;
    g.fillRect(x - 1, y - 2, 3, 3);
    g.fillRect(x - 2, y - 1, 5, 2);
    g.fillStyle = pal.bushLight;
    g.fillRect(x - 1, y - 2, 1, 1);
  }

  // Meadow.
  g.fillStyle = pal.ground;
  g.fillRect(0, groundY, W, H - groundY);
  g.fillStyle = pal.groundEdge;
  g.fillRect(0, groundY, W, 1);
  const deepFrom = groundY + Math.ceil((H - groundY) * 0.55);
  g.fillStyle = pal.groundDark;
  for (let x = 0; x < W; x++) {
    if (x % 2 === 0) g.fillRect(x, deepFrom - 1, 1, 1);
  }
  g.fillRect(0, deepFrom, W, H - deepFrom);
  g.fillStyle = pal.groundDeep;
  for (let x = 0; x < W; x++) if (x % 2 === 1) g.fillRect(x, H - 2, 1, 1);
  g.fillRect(0, H - 1, W, 1);
  // Little specks and flowers in the grass.
  for (let i = 0; i < W / 3; i++) {
    const x = Math.floor(rng() * W);
    const y = groundY + 2 + Math.floor(rng() * (H - groundY - 3));
    g.fillStyle = y >= deepFrom ? pal.groundDeep : pal.groundDark;
    g.fillRect(x, y, 2, 1);
  }
  for (let i = 0; i < W / 14; i++) {
    const x = Math.floor(rng() * W);
    const y = groundY + 3 + Math.floor(rng() * (H - groundY - 4));
    g.fillStyle = pal.fleck[Math.floor(rng() * pal.fleck.length)];
    g.fillRect(x, y, 1, 1);
  }
  return c;
}

function cloudSprite(cloud: Cloud, pal: ScenePalette): HTMLCanvasElement {
  const rng = mulberry32(cloud.shape);
  const { w, h } = cloud;
  const blobs: { cx: number; cy: number; r: number }[] = [];
  const count = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i++) {
    const r = h * (0.55 + rng() * 0.45);
    blobs.push({ cx: (w / (count + 1)) * (i + 1) + (rng() - 0.5) * 2, cy: h - 1, r });
  }
  blobs.push({ cx: w * (0.35 + rng() * 0.3), cy: h - 1, r: h });
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      const inside = blobs.some((b) => (x + 0.5 - b.cx) ** 2 + ((y + 0.5 - b.cy) * 1.25) ** 2 <= b.r * b.r);
      const sideways = x > 0 && x < w - 1;
      row += inside && (sideways || y > h / 2) ? "c" : ".";
    }
    rows.push(row);
  }
  // Light from above: top edge highlight, shaded underside.
  const shaded = rows.map((row, y) =>
    row
      .split("")
      .map((ch, x) => {
        if (ch === ".") return ".";
        if (y === h - 1) return "s";
        if (y === 0 || rows[y - 1][x] === ".") return "l";
        return "c";
      })
      .join(""),
  );
  return paint(shaded, { c: pal.cloud, l: pal.cloudLight, s: pal.cloudShade });
}

function makeArt(world: World, theme: Theme): Art {
  const pal = PALETTES[theme];
  return {
    theme,
    pal,
    sky: paintSky(world, pal, theme),
    land: paintLand(world, pal),
    clouds: new Map(),
    sprites: new Map(),
  };
}

function sprite(art: Art, key: string, build: () => HTMLCanvasElement): HTMLCanvasElement {
  let s = art.sprites.get(key);
  if (!s) {
    s = build();
    art.sprites.set(key, s);
  }
  return s;
}

function blockPal(colour: number): Pal {
  const base = LANES[colour];
  return { o: INK, b: base, l: mix(base, "#ffffff", 0.38), d: mix(base, "#000000", 0.24), w: "#ffffff" };
}

function crewSprite(art: Art, pose: Pose, face: Face, stepIndex: 0 | 1, body: number, dir: 1 | -1) {
  const lamp = art.theme === "dark";
  return sprite(art, `crew:${pose}:${face}:${stepIndex}:${body}:${dir}`, () =>
    paint(
      crewRows(pose, face, stepIndex, lamp),
      {
        o: INK,
        h: "#ffc400",
        l: "#ffe680",
        d: "#cf8600",
        b: BODIES[body][0],
        s: BODIES[body][1],
        p: "#ff8f9e",
        m: "#d93a58",
        y: "#fffbe0",
      },
      dir === -1,
    ),
  );
}

function drawWorld(ctx: CanvasRenderingContext2D, world: World, art: Art) {
  const { pal } = art;
  const { t, W, groundY, footY } = world;
  const tick = Math.floor(t * 10);

  ctx.drawImage(art.sky, 0, 0);

  // Stars.
  if (art.theme === "dark") {
    for (const star of world.stars) {
      const tw = Math.sin(t * star.rate + star.phase);
      const level = star.base + (tw > 0.55 ? 1 : 0) - (tw < -0.85 ? 1 : 0);
      if (level < 0) continue;
      ctx.fillStyle = pal.star[Math.min(2, level)];
      ctx.fillRect(star.x, star.y, 1, 1);
      if (level >= 2 || (star.base === 1 && tw > 0.92)) {
        ctx.fillStyle = pal.star[0];
        ctx.fillRect(star.x - 1, star.y, 1, 1);
        ctx.fillRect(star.x + 1, star.y, 1, 1);
        ctx.fillRect(star.x, star.y - 1, 1, 1);
        ctx.fillRect(star.x, star.y + 1, 1, 1);
      }
    }
    if (world.meteor) {
      const m = world.meteor;
      const hx = Math.round(m.x - m.t * 70);
      const hy = Math.round(m.y + m.t * 28);
      for (let i = 5; i >= 0; i--) {
        ctx.globalAlpha = i === 0 ? 1 : 0.7 - i * 0.11;
        ctx.fillStyle = i === 0 ? "#ffffff" : pal.star[1];
        ctx.fillRect(hx + Math.round(i * 2.5), hy - i, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Clouds.
  for (const cloud of world.clouds) {
    let s = art.clouds.get(cloud.shape);
    if (!s) {
      s = cloudSprite(cloud, pal);
      art.clouds.set(cloud.shape, s);
    }
    ctx.drawImage(s, Math.round(cloud.x), cloud.y);
  }

  // Balloon drifting far away (tall skies only).
  if (world.balloon) {
    const b = world.balloon;
    const s = sprite(art, "balloon", () => {
      const haze = art.theme === "dark" ? 0.45 : 0.12;
      const sky = pal.sky[1];
      return paint(BALLOON, {
        A: mix("#ff5f7a", sky, haze),
        Y: mix("#ffd23f", sky, haze),
        H: mix("#ffa9b8", sky, haze),
        S: mix("#d9415f", sky, haze),
        k: mix("#7a5a44", sky, haze),
        K: mix("#a8784c", sky, haze),
      });
    });
    ctx.drawImage(s, Math.round(b.x), b.y + Math.round(Math.sin(t * 0.8) * 1.2));
  }

  // Bird (daytime).
  if (world.bird && art.theme === "light") {
    const b = world.bird;
    const flap = (Math.floor(t * 7 + b.phase) % 2) as 0 | 1;
    const bob = Math.round(Math.sin(t * 3 + b.phase));
    const s = sprite(art, `bird:${flap}`, () => paint(BIRD[flap], { o: pal.bird }));
    ctx.drawImage(s, Math.round(b.x), b.y + bob);
    if (b.pair) {
      const flap2 = (1 - flap) as 0 | 1;
      const s2 = sprite(art, `bird:${flap2}`, () => paint(BIRD[flap2], { o: pal.bird }));
      ctx.drawImage(s2, Math.round(b.x) - b.dir * 7, b.y + 3 - bob);
    }
  }

  ctx.drawImage(art.land, 0, 0);

  // Back grass tufts sway along the meadow edge.
  drawTufts(ctx, world, pal, false);

  // Nodding flower.
  {
    const fx = world.flowerX;
    const lx = Math.max(-1, Math.min(1, lean(world, fx)));
    const nod = Math.sin(t * 1.3) > 0.75 ? 1 : 0;
    const topY = groundY + 1 - world.flowerH;
    ctx.fillStyle = pal.stem;
    ctx.fillRect(fx, topY + 2, 1, world.flowerH - 1);
    ctx.fillRect(fx + lx, topY + 1, 1, 2);
    ctx.fillRect(fx + 1, groundY - 2, 2, 1);
    ctx.fillRect(fx + 2, groundY - 3, 1, 1);
    const petals = LANES[world.flowerColour];
    const s = sprite(art, `flower:${world.flowerColour}`, () =>
      paint(FLOWER, { o: INK, P: petals, c: "#ffc400" }),
    );
    ctx.drawImage(s, fx - 2 + lx + nod, topY - 4 + nod);
  }

  // Pennant when the pyramid is complete.
  if (world.phase === "done") {
    const top = world.slots[world.slots.length - 1];
    const rise = Math.max(0, 7 - Math.floor(world.phaseT * 30));
    const frame = Math.floor(t * 5) % 2;
    const s = sprite(art, `pennant:${frame}`, () => paint(PENNANT[frame], { o: INK, h: "#ffc400" }));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, top.y + 1);
    ctx.clip();
    ctx.drawImage(s, top.x + 3, top.y - 7 + rise);
    ctx.restore();
  }

  // Pyramid.
  for (const slot of world.slots) {
    if (!slot.filled) continue;
    const squash = t - slot.landedAt < 0.09;
    const s = sprite(art, `block:${slot.colour}:${squash ? 1 : 0}`, () =>
      paint(squash ? BLOCK_SQUASH : BLOCK, blockPal(slot.colour)),
    );
    ctx.drawImage(s, slot.x, slot.y);
  }

  // Crew (walking out are drawn in front).
  const order = [...world.crew].sort((a, b) => (a.dir === b.dir ? a.id - b.id : a.dir === 1 ? -1 : 1));
  for (const crew of order) {
    const x = Math.round(crew.x);
    const stepIndex = (Math.floor(crew.walked / 3) % 2) as 0 | 1;
    let pose: Pose = "walk";
    let face: Face = t < crew.blinkUntil ? "blink" : "open";
    let stepFrame: 0 | 1 = 0;
    let blockDy = 0;
    switch (crew.state) {
      case "in": {
        pose = "carry";
        const moving = crew.x < slotTarget(world, crew) - 0.01;
        stepFrame = moving ? stepIndex : 0;
        blockDy = stepFrame === 1 ? -1 : 0;
        break;
      }
      case "windup":
        pose = "crouch";
        blockDy = 2;
        break;
      case "throw":
        pose = "arms";
        face = "look";
        break;
      case "watch":
        pose = "walk";
        face = "look";
        break;
      case "cheer":
        pose = "arms";
        face = "happy";
        break;
      case "turn":
        pose = "walk";
        face = "blink";
        break;
      case "out":
        pose = "walk";
        stepFrame = stepIndex;
        break;
    }
    const top = footY - 18 - crew.hop;
    if (crew.colour >= 0) {
      const b = sprite(art, `block:${crew.colour}:0`, () => paint(BLOCK, blockPal(crew.colour)));
      ctx.drawImage(b, x + 3, top + blockDy);
    }
    ctx.drawImage(crewSprite(art, pose, face, stepFrame, crew.body, crew.dir), x, top);
  }

  // Blocks in flight.
  for (const fly of world.flying) {
    const k = Math.min(1, fly.t / fly.dur);
    const x = fly.x0 + (fly.x1 - fly.x0) * k;
    const y = fly.y0 + (fly.y1 - fly.y0) * k - fly.arc * 4 * k * (1 - k);
    const s = sprite(art, `block:${fly.colour}:0`, () => paint(BLOCK, blockPal(fly.colour)));
    ctx.drawImage(s, Math.round(x), Math.round(y));
  }

  // Particles.
  const fxPal: Pal = { w: pal.dust, g: pal.dustShade };
  for (const p of world.particles) {
    if (p.delay > 0) continue;
    const k = p.t / p.life;
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (p.kind === "dust") {
      const f = Math.min(2, Math.floor(k * 3));
      ctx.drawImage(
        sprite(art, `dust:${f}`, () => paint(DUST[f], fxPal)),
        px,
        py,
      );
    } else if (p.kind === "puff") {
      const f = Math.min(2, Math.floor(k * 3));
      ctx.drawImage(
        sprite(art, `puff:${f}`, () => paint(PUFF[f], fxPal)),
        px,
        py,
      );
    } else if (p.kind === "petal") {
      const wobble = Math.round(Math.sin(p.t * 5 + p.vy * 3) * 2);
      ctx.fillStyle = p.vy < -2 ? pal.fleck[0] : pal.fleck[2];
      if (Math.floor(p.t * 8) % 2 === 0) ctx.fillRect(px, py + wobble, 2, 1);
      else ctx.fillRect(px, py + wobble, 1, 2);
    } else if (p.kind === "heart") {
      if (k > 0.7 && tick % 2 === 0) continue;
      ctx.drawImage(
        sprite(art, "heart", () => paint(HEART, { r: "#ff4c69", w: "#ffb3c1" })),
        px,
        py,
      );
    } else {
      const big = k > 0.25 && k < 0.7;
      ctx.drawImage(
        sprite(art, `sparkle:${big ? 1 : 0}`, () =>
          paint(big ? SPARKLE_BIG : SPARKLE_SMALL, { w: "#ffffff", y: "#ffe680" }),
        ),
        px - 2,
        py - 2,
      );
    }
  }

  // Front tufts and fireflies.
  drawTufts(ctx, world, pal, true);
  if (art.theme === "dark") {
    for (const fly of world.fireflies) {
      const glow = Math.sin(t * fly.rate * 2 + fly.phase);
      if (glow < -0.2) continue;
      const fx = Math.round(fly.x + Math.sin(t * 0.5 + fly.phase) * fly.drift * 3) % W;
      const fy = Math.round(fly.y + Math.sin(t * 0.9 + fly.phase * 2) * fly.drift);
      const x = fx < 0 ? fx + W : fx;
      if (glow > 0.45) {
        ctx.fillStyle = "rgba(214, 255, 122, 0.35)";
        ctx.fillRect(x - 1, fy, 3, 1);
        ctx.fillRect(x, fy - 1, 1, 3);
      }
      ctx.fillStyle = glow > 0.45 ? "#f2ffb0" : "#a9c46a";
      ctx.fillRect(x, fy, 1, 1);
    }
  }
}

function drawTufts(ctx: CanvasRenderingContext2D, world: World, pal: ScenePalette, front: boolean) {
  const base = front ? world.H - 1 : world.groundY;
  for (const tuft of world.tufts) {
    if (tuft.front !== front) continue;
    const l = lean(world, tuft.x);
    for (const blade of tuft.blades) {
      const bx = tuft.x + blade.dx;
      for (let i = 0; i < blade.h; i++) {
        const k = blade.h > 1 ? i / (blade.h - 1) : 0;
        const dx = Math.round(l * k * k) + (i > 0 && i === blade.h - 1 ? blade.splay : 0);
        ctx.fillStyle = i === blade.h - 1 ? pal.bladeTip : pal.blade;
        ctx.fillRect(bx + dx, base - 1 - i, 1, 1);
      }
    }
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Controller: sizing, observers and the frame loop                                                 */
/* ------------------------------------------------------------------------------------------------ */

type SceneController = { setPaused: (paused: boolean) => void; destroy: () => void };

/**
 * Integer device pixels per logical pixel: about 140 logical pixels across, so the crew keeps the same size
 * from a thin banner to a card; at most 120 logical rows, and never fewer than 36.
 */
function pickScale(devW: number, devH: number): number {
  let s = Math.max(1, Math.round(devW / 140));
  s = Math.max(s, Math.ceil(devH / 120));
  if (devH / s < 36) s = Math.max(1, Math.floor(devH / 36));
  return s;
}

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function startScene(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  seed: number,
  initiallyPaused: boolean,
): SceneController {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return { setPaused: () => {}, destroy: () => {} };

  const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let reduced = motionQuery?.matches ?? false;
  let paused = initiallyPaused;
  let onScreen = true;
  let theme = readTheme();
  let world: World | null = null;
  let art: Art | null = null;
  let raf = 0;
  let last = -1;
  let size = { W: 0, H: 0 };

  const draw = () => {
    if (!world) return;
    if (!art || art.theme !== theme) art = makeArt(world, theme);
    ctx.imageSmoothingEnabled = false;
    drawWorld(ctx, world, art);
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (last < 0) last = now;
    const elapsed = now - last;
    if (elapsed < 12) return; // cap near 60 fps on 90/120 Hz screens
    last = now;
    if (world) step(world, Math.min(elapsed / 1000, 0.1));
    draw();
  };

  const sync = () => {
    const run = !!world && !paused && onScreen && !document.hidden && !reduced;
    if (run && !raf) {
      last = -1;
      raf = requestAnimationFrame(frame);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const resize = () => {
    const rect = root.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    const devW = Math.round(rect.width * dpr);
    const devH = Math.round(rect.height * dpr);
    const s = pickScale(devW, devH);
    const W = Math.ceil(devW / s);
    const H = Math.ceil(devH / s);
    canvas.style.width = `${(W * s) / dpr}px`;
    canvas.style.height = `${(H * s) / dpr}px`;
    if (W !== size.W || H !== size.H) {
      size = { W, H };
      canvas.width = W;
      canvas.height = H;
      world = createWorld(W, H, seed);
      prewarm(world);
      art = null;
    }
    draw();
    sync();
  };

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(root);
  const intersectionObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          onScreen = entry.isIntersecting;
          sync();
        })
      : null;
  intersectionObserver?.observe(root);
  const themeObserver =
    typeof MutationObserver === "function"
      ? new MutationObserver(() => {
          const next = readTheme();
          if (next === theme) return;
          theme = next;
          draw();
        })
      : null;
  themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const onVisibility = () => sync();
  document.addEventListener("visibilitychange", onVisibility);
  const onMotion = (event: MediaQueryListEvent) => {
    reduced = event.matches;
    sync();
  };
  motionQuery?.addEventListener?.("change", onMotion);

  resize();

  return {
    setPaused(next) {
      paused = next;
      sync();
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      themeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery?.removeEventListener?.("change", onMotion);
      world = null;
      art = null;
    },
  };
}
