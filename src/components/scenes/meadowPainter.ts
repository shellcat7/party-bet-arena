/**
 * Procedural, stroke-by-stroke landscape painting in an Impressionist manner: broken brushwork,
 * a luminous sky with drifting cumulus and the wind moving through the land. Three biomes:
 *  - meadow: blue hills, a stand of poplars and a lone tree, a flowering meadow with a faint path
 *  - snow:   a mountain range with blue-violet shadows, a snowfield and dark spruces close by
 *  - desert: violet mesas, a sunlit butte, dunes with long violet shadows and a few shrubs
 * Composed for ticket artwork (16:10 to 3:1). Pure canvas code, no React.
 *
 * Layers (bottom to top), each a <canvas> owned by the component:
 *  - sky:    sky and clouds, painted once as a horizontally tileable strip (2 tiles wide)
 *            that drifts slowly by moving its CSS transform (compositor only, no repaint)
 *  - ground: the land, painted once
 *  - trees:  the trees, painted once into a small sprite sheet and redrawn leaning with the wind
 *            at ~10 fps; the canvas only covers the trees
 *  - motion: wind-blown grass, nodding flowers and blowing snow or sand, repainted at ~30 fps at a
 *            reduced resolution; the canvas only covers the foreground
 * A canvas-weave tile (generated once) and a vignette are laid on top with CSS (scenes.css).
 *
 * Generation is time-sliced (a few ms per task) so it never blocks the main thread for long.
 * Paused from the start, the engine paints one still frame and never starts an animation loop.
 */

type Ctx = CanvasRenderingContext2D;
type Gen<R = void> = Generator<string | undefined, R, void>;

export interface MeadowCanvases {
  root: HTMLElement;
  sky: HTMLCanvasElement;
  ground: HTMLCanvasElement;
  /** The trees; sized and positioned by the engine. */
  trees: HTMLCanvasElement;
  /** The meadow's moving grass and flowers; sized and positioned by the engine. */
  motion: HTMLCanvasElement;
}

export interface MeadowEngine {
  setPaused(paused: boolean): void;
  destroy(): void;
}

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const FRAME_MS = 1000 / 30;
const SLICE_MS = 8;
const RESIZE_DEBOUNCE_MS = 220;
const MAX_DPR = 2;
const MAX_LAYER_PIXELS = 2_400_000;
/** The moving grass is soft brushwork: it is drawn at a lower resolution than the static layers. */
const MOTION_DPR = 1.25;
const SKY_DRIFT_PX_PER_S = 3.2;
/** The moment shown as a still frame (paused or reduced motion). */
const STILL_TIME = 6.5;

/* ------------------------------------------------------------------ maths & random */

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function hashInt(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

class Rng {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  signed(a: number): number {
    return (this.next() * 2 - 1) * a;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

/** Smooth value noise in [-1, 1]; repeats every `period` lattice cells along x when period > 0. */
function noise2(x: number, y: number, seed: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  let x0 = xi;
  let x1 = xi + 1;
  if (period > 0) {
    x0 = ((x0 % period) + period) % period;
    x1 = ((x1 % period) + period) % period;
  }
  const a = hashInt(hashInt(x0, seed), yi);
  const b = hashInt(hashInt(x1, seed), yi);
  const c = hashInt(hashInt(x0, seed), yi + 1);
  const d = hashInt(hashInt(x1, seed), yi + 1);
  const k = 1 / 4294967295;
  const top = a * k + (b - a) * k * ux;
  const bottom = c * k + (d - c) * k * ux;
  return (top + (bottom - top) * uy) * 2 - 1;
}

function fbm(x: number, y: number, seed: number, period: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * f, y * f, seed + o * 7919, period > 0 ? period * f : 0);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ colour (OKLab) */

interface Lab {
  L: number;
  a: number;
  b: number;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function hexLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function channelHex(c: number): string {
  const v = Math.round(toGamma(clamp(c, 0, 1)) * 255);
  return (v < 16 ? "0" : "") + v.toString(16);
}

function labHex(L: number, A: number, B: number): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return (
    "#" +
    channelHex(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) +
    channelHex(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) +
    channelHex(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  );
}

const hex = (c: Lab) => labHex(c.L, c.a, c.b);
const mix = (p: Lab, q: Lab, t: number): Lab => ({
  L: p.L + (q.L - p.L) * t,
  a: p.a + (q.a - p.a) * t,
  b: p.b + (q.b - p.b) * t,
});
const lighten = (c: Lab, dL: number): Lab => ({ L: c.L + dL, a: c.a, b: c.b });

/** Jitter lightness, chroma and hue (OKLCh) and return a hex string. */
function vary(c: Lab, rng: Rng, dL: number, dC: number, dH: number): string {
  const C = Math.hypot(c.a, c.b) * (1 + rng.signed(dC));
  const h = Math.atan2(c.b, c.a) + rng.signed(dH);
  return labHex(c.L + rng.signed(dL), C * Math.cos(h), C * Math.sin(h));
}

type Ramp = { at: number; c: Lab }[];
const ramp = (stops: [number, string][]): Ramp => stops.map(([at, h]) => ({ at, c: hexLab(h) }));
function rampAt(r: Ramp, t: number): Lab {
  if (t <= r[0].at) return r[0].c;
  for (let i = 1; i < r.length; i++) {
    if (t <= r[i].at) return mix(r[i - 1].c, r[i].c, (t - r[i - 1].at) / (r[i].at - r[i - 1].at));
  }
  return r[r.length - 1].c;
}
const labs = (list: string[]) => list.map(hexLab);

/* Palette: a high summer sky, blue distance, fresh greens in yellow-green light. */
const SKY = ramp([
  [0, "#2f7cc0"],
  [0.25, "#3d8cca"],
  [0.55, "#5ca1d2"],
  [0.8, "#8bbcd8"],
  [0.93, "#b2ced8"],
  [1, "#cad6d2"],
]);
const SKY_DEEP = labs(["#2a74bc", "#3480c4", "#2c84c8", "#4688c0"]);
const SKY_TURQ = labs(["#6cb6da", "#7ec2da", "#5cb0de"]);
const CLOUD_SHADE = ramp([
  [0, "#7886b0"],
  [0.35, "#929cc2"],
  [0.65, "#acb2ca"],
  [1, "#c8c6c6"],
]);
const CLOUD_LIGHT = ramp([
  [0, "#cdc5b6"],
  [0.4, "#e4dac2"],
  [0.75, "#f2e9d2"],
  [1, "#fdf8ea"],
]);
const CLOUD_WARM = labs(["#eed9b6", "#f3dfca", "#ecd2c6", "#f4e6be"]);
const CLOUD_LAV = labs(["#a29bc4", "#b2a9cd", "#9a97c0", "#a8a2c8"]);
const HAZE = labs(["#d8d6c6", "#d0d8d4", "#e2d8ca", "#c8d6da", "#d6cfd6"]);

const HILL_FAR = labs(["#8496c2", "#8d9cc6", "#8a9fc2", "#93a0c4", "#8a92bc"]);
const HILL_FAR_LIT = labs(["#bcbed4", "#c8c0d0", "#b6c0d4", "#c6c4d6", "#d0c8cc"]);
const HILL_NEAR = labs(["#6a84a6", "#64809c", "#6f86a2", "#748aa0", "#5f7a98", "#668892"]);
const HILL_NEAR_LIT = labs(["#8fa4a6", "#9cab9e", "#8aa49c", "#a4ae9e"]);
const TREE_LINE = labs(["#3d5d72", "#46657a", "#4b5d78", "#38566a", "#526a7c"]);
const TREE_LINE_LIT = labs(["#7b9072", "#899a70", "#6f8a76", "#92a07c"]);
const FIELD_FAR = labs(["#8fa294", "#98a88e", "#a0ac8a", "#86a09a", "#93a69c"]);
const FIELD_SUN = labs(["#b4bc72", "#c0c47a", "#aab86c"]);
const FIELD_GOLD = labs(["#d2c262", "#cabe60", "#dccc70", "#d6c46c"]);
const FIELD_SHADE = labs(["#6e8c88", "#76908e", "#7c90a0", "#6a8682"]);

const POPLAR_DARK = labs(["#3a5562", "#40576a", "#36525a", "#455a6c"]);
const POPLAR_MID = labs(["#577262", "#5e7860", "#55706a", "#64785e"]);
const POPLAR_LIT = labs(["#8e9e62", "#9ca86a", "#a8ae72", "#86985e", "#b0b47a"]);
const POPLAR_COOL = labs(["#5e6f98", "#66789c", "#58709a"]);
const TRUNK = hexLab("#4a3f44");

const GRASS = {
  deep: labs(["#1d4a2e", "#24482f", "#2a5135", "#1f4638"]),
  dark: labs(["#355f3e", "#3e6a2c", "#2f5a3b", "#476e56", "#43662f"]),
  mid: labs(["#5e7b3a", "#6a8631", "#76893d", "#607e45", "#6f9035", "#7c9141"]),
  sun: labs(["#9aad3b", "#a8b545", "#b7bd4d", "#a4c14f", "#c1c561", "#b1c959"]),
  cool: labs(["#4f7a6f", "#5a8079", "#4a6f6a", "#5f8781", "#567a84"]),
  haze: labs(["#a8b48c", "#9fb092", "#b4bc8e", "#98aa96", "#aeb4a0"]),
  pale: labs(["#c6caa2", "#b3ba92", "#d2d2ac", "#bdc5a2"]),
  earth: labs(["#5e5429", "#7a6a37", "#8e7c45"]),
  violet: labs(["#7a6a9e", "#8a75a8", "#6c6092"]),
};
const BUTTERCUP = labs(["#f0d63c", "#f5e05a", "#e9c931", "#f6e47b"]);
const DAISY = labs(["#f7f3e3", "#fcf9ef", "#edebdf"]);
const POPPY = labs(["#d9432a", "#e1512c", "#c93b29", "#e9633b"]);
const CORNFLOWER = labs(["#5b79c8", "#6a6fc0", "#7b85d0"]);
const PATH = labs(["#d4c78c", "#dccf9c", "#c9b984", "#e0d6a8", "#cfc28e"]);
const PATH_SHADE = labs(["#b8a884", "#b0a490", "#bcaa86", "#aaa888"]);

/* Snow: a cold, luminous day; sunlit snow warm white, shadows blue-violet. */
const SNOW = {
  far: labs(["#a6b0d8", "#aeb4da", "#9ca8d2", "#b6b6dc"]),
  farLit: labs(["#e6e0ee", "#eee6ec", "#e0deee"]),
  lit: labs(["#f8f3ea", "#fdf8f0", "#f2ebe6", "#f7efe6", "#fff9f0"]),
  half: labs(["#d6d8ea", "#dcdcec", "#cfd4e8", "#e2dfec"]),
  shade: labs(["#93a0cc", "#9aa4d2", "#8794c4", "#a6a8d6", "#8c8ec6"]),
  deep: labs(["#6f7cb0", "#7480b4", "#6a74a8"]),
  rock: labs(["#56608a", "#4a5278", "#62668a", "#5a5a7e"]),
  forest: labs(["#2a4050", "#2f4858", "#253a48", "#34505c"]),
  straw: labs(["#a8925e", "#8a7854", "#c4ae78", "#6e6044"]),
};
const PINE_DARK = labs(["#1d3436", "#213a3c", "#1a2e34", "#26403e"]);
const PINE_MID = labs(["#2f4c46", "#35524a", "#2c4650"]);
const PINE_LIT = labs(["#4e6c52", "#5a7656", "#486a5a"]);
const PINE_SNOW = labs(["#f4f2f6", "#e6e8f2", "#fbf8f2"]);
const PINE_SNOW_SHADE = labs(["#c2c8e4", "#b4bce0", "#cdd0ea"]);

/* Desert: warm ochre and rose in the sun, long violet shadows. */
const DESERT = {
  far: labs(["#b9a2c2", "#c3a8c2", "#aea2c6", "#c8aebe"]),
  farLit: labs(["#e8c8b6", "#eed0ba", "#e0c2b4"]),
  mesa: labs(["#c88a6c", "#d0946e", "#bf8068", "#d69c76"]),
  mesaLit: labs(["#e8ae80", "#efba8a", "#e2a476", "#f2c496"]),
  mesaShade: labs(["#8c6a8c", "#7e6286", "#96708a", "#86688e"]),
  plain: labs(["#dcc4a0", "#d6b890", "#e4cca8", "#cfb48e"]),
  sage: labs(["#9aa088", "#8c967e", "#a4a68c"]),
  sand: labs(["#eab67e", "#f0c28c", "#e4aa76", "#f4cc98", "#dea272"]),
  sandMid: labs(["#d49c74", "#cc9070", "#d8a47c", "#c89276"]),
  sandLit: labs(["#f8dcb0", "#fbe4bc", "#f6d4a4"]),
  shadow: labs(["#9a7c9e", "#8c6e98", "#a88aa6", "#7e6a92", "#94789e"]),
  deep: labs(["#76628c", "#6e5a86"]),
};
const SHRUB = labs(["#7e8a6c", "#8a9474", "#6e7a62", "#949a7a"]);
const SHRUB_LIT = labs(["#b4b48a", "#c0bc92", "#a8ac84"]);
const SHRUB_SHADE = labs(["#5e5e72", "#585a6e", "#666478"]);

/** The sky of each biome: its gradient, its clouds and how many there are. */
interface SkyStyle {
  sky: Ramp;
  deep: Lab[];
  turq: Lab[];
  shade: Ramp;
  light: Ramp;
  warm: Lab[];
  lav: Lab[];
  haze: Lab[];
  /** How much of the sky the cumulus cover and how much thin veil there is (1 = the meadow's). */
  cover: number;
  veil: number;
}

const SKIES: Record<MeadowBiome, SkyStyle> = {
  meadow: {
    sky: SKY,
    deep: SKY_DEEP,
    turq: SKY_TURQ,
    shade: CLOUD_SHADE,
    light: CLOUD_LIGHT,
    warm: CLOUD_WARM,
    lav: CLOUD_LAV,
    haze: HAZE,
    cover: 1,
    veil: 1,
  },
  snow: {
    sky: ramp([
      [0, "#2866b4"],
      [0.3, "#3a80c4"],
      [0.6, "#68a6d4"],
      [0.85, "#a6cce2"],
      [1, "#d8e6ea"],
    ]),
    deep: labs(["#2460ac", "#2a6cb6", "#3470b8"]),
    turq: labs(["#74c0e0", "#88cce2", "#62b4de"]),
    shade: ramp([
      [0, "#7a8cb8"],
      [0.4, "#98a6cc"],
      [0.7, "#b8c0d8"],
      [1, "#d4d8e2"],
    ]),
    light: ramp([
      [0, "#d4d8e2"],
      [0.4, "#e8eaee"],
      [0.75, "#f4f4f2"],
      [1, "#fefcf8"],
    ]),
    warm: labs(["#f4e6e4", "#f2e0dc", "#f8ece4"]),
    lav: labs(["#a8acd4", "#b4b6da", "#9ea4ce"]),
    haze: labs(["#dfe6ee", "#e6e8f0", "#d4dfea", "#ece6ee"]),
    cover: 0.62,
    veil: 1.3,
  },
  desert: {
    sky: ramp([
      [0, "#2f76bc"],
      [0.3, "#4890c8"],
      [0.6, "#78b0cc"],
      [0.85, "#bcd2c8"],
      [1, "#ecdac0"],
    ]),
    deep: labs(["#2a6cb4", "#3478bc", "#3c80c0"]),
    turq: labs(["#6cbcd0", "#80c6cc", "#5cb2cc"]),
    shade: ramp([
      [0, "#9a88ac"],
      [0.4, "#b49eb8"],
      [0.7, "#ccb6bc"],
      [1, "#dccabe"],
    ]),
    light: ramp([
      [0, "#dccab6"],
      [0.4, "#efdcc4"],
      [0.75, "#f8ead6"],
      [1, "#fff6e6"],
    ]),
    warm: labs(["#f6d6b6", "#f8ceb2", "#f4dcbc"]),
    lav: labs(["#b4a2c4", "#c0aac6", "#aa9cc0"]),
    haze: labs(["#ecdcc6", "#f0e0cc", "#e6d6c8", "#f2dcc4"]),
    cover: 0.55,
    veil: 0.8,
  },
};

/* ------------------------------------------------------------------ brush */

class Brush {
  /** Device pixels per user unit of the current transform (decides bristle detail). */
  scale = 1;
  constructor(
    readonly ctx: Ctx,
    readonly rng: Rng,
  ) {}

  /**
   * One loaded brush stroke: a tapered, slightly curved body plus a few bristle streaks
   * a little lighter or darker than the body, ending at random points (dry brush).
   */
  stroke(
    x: number,
    y: number,
    ang: number,
    len: number,
    wid: number,
    bend: number,
    col: Lab,
    alpha: number,
    texture = 1,
  ): void {
    const { ctx, rng } = this;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const nx = -dy;
    const ny = dx;
    const x2 = x + dx * len;
    const y2 = y + dy * len;
    const cx = (x + x2) * 0.5 + nx * bend * len;
    const cy = (y + y2) * 0.5 + ny * bend * len;
    const h = wid * 0.5;
    // a flat brush: blunt start, nearly parallel sides, slightly tapered rounded end
    const hm = h * 1.08;
    const hs = h * rng.range(0.5, 0.98);
    const he = h * rng.range(0.15, 0.6);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = vary(col, rng, 0.022, 0.07, 0.05);
    ctx.beginPath();
    ctx.moveTo(x + nx * hs, y + ny * hs);
    ctx.quadraticCurveTo(cx + nx * hm, cy + ny * hm, x2 + nx * he, y2 + ny * he);
    ctx.quadraticCurveTo(x2 + dx * he * 1.3, y2 + dy * he * 1.3, x2 - nx * he, y2 - ny * he);
    ctx.quadraticCurveTo(cx - nx * hm, cy - ny * hm, x - nx * hs, y - ny * hs);
    ctx.quadraticCurveTo(x - dx * hs * 0.55, y - dy * hs * 0.55, x + nx * hs, y + ny * hs);
    ctx.fill();

    const devWidth = wid * this.scale;
    if (texture <= 0 || devWidth < 3.2) return;
    // bristle streaks spread across the width, some a little lighter than the body and some darker;
    // some run past the end (dry brush). Each set is one path of thin quads that follow the curve,
    // so a stroke costs at most three fills.
    const n = Math.min(6, Math.max(2, Math.round(devWidth / 3.2)));
    const lit = rng.int(1 << n);
    const minW = 0.3 / this.scale;
    for (let pass = 0; pass < 2; pass++) {
      let count = 0;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (((lit >> i) & 1) !== pass) continue;
        count++;
        const o = (((i + 0.5) / n - 0.5) * 1.7 + rng.signed(0.18)) * h;
        const s0 = rng.range(0, 0.25);
        const s1 = rng.range(0.6, 1.08);
        const bw = Math.max(minW, wid * rng.range(0.035, 0.075));
        for (let k = 0; k < 6; k++) {
          // along one side (k < 3) and back along the other, thinning towards the tip
          const j = k < 3 ? k : 5 - k;
          const t = s0 + ((s1 - s0) * j) / 2;
          const u = 1 - t;
          const off = o + (k < 3 ? bw : -bw) * (1 - j * 0.2);
          const px = u * u * x + 2 * u * t * cx + t * t * x2 + nx * off;
          const py = u * u * y + 2 * u * t * cy + t * t * y2 + ny * off;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
      if (!count) continue;
      const shade = lighten(col, pass ? rng.range(0.045, 0.1) : -rng.range(0.04, 0.09));
      ctx.fillStyle = vary(shade, rng, 0.01, 0.08, 0.05);
      ctx.globalAlpha = alpha * texture * rng.range(0.4, 0.65);
      ctx.fill();
    }
  }

  /** A short, fat dab (flowers, foliage). */
  dab(x: number, y: number, r: number, ang: number, col: Lab, alpha: number): void {
    const { ctx, rng } = this;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = vary(col, rng, 0.03, 0.08, 0.06);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.55, 0.85), ang, 0, TAU);
    ctx.fill();
  }
}

/** A stroke centred on (x, y) rather than starting there. */
function centred(
  b: Brush,
  x: number,
  y: number,
  ang: number,
  len: number,
  wid: number,
  bend: number,
  col: Lab,
  alpha: number,
  texture = 1,
) {
  b.stroke(
    x - Math.cos(ang) * len * 0.5,
    y - Math.sin(ang) * len * 0.5,
    ang,
    len,
    wid,
    bend,
    col,
    alpha,
    texture,
  );
}

/* ------------------------------------------------------------------ layout */

export type MeadowBiome = "meadow" | "snow" | "desert";

type TreeKind = "poplar" | "oak" | "pine" | "shrub";

interface Tree {
  kind: TreeKind;
  /** Foot of the trunk (CSS px). */
  x: number;
  y: number;
  /** Height and crown width (CSS px). */
  ht: number;
  wd: number;
  /** Lean towards the right (x shift per px of height) and how far the gusts bend it. */
  lean: number;
  give: number;
  phase: number;
}

interface Layout {
  biome: MeadowBiome;
  w: number;
  h: number;
  dpr: number;
  /** Brush unit (CSS px): the size of a stroke in the sky and in the foreground. */
  bu: number;
  /** Feature scale (CSS px): hills, mountains and trees are sized from it. */
  F: number;
  /** Horizon: the foot of the hills, where the far ground begins. */
  hz: number;
  /**
   * Skylines (y for each CSS px column): the farthest range, a nearer one in front of it, and the
   * crest where the foreground (meadow, snowfield or dunes) begins.
   */
  far: Float32Array;
  near: Float32Array;
  crest: Float32Array;
  landTop: number;
  crestMin: number;
  /** Mean height of the foreground (CSS px), from its crest to the bottom edge. */
  meadowH: number;
  trees: Tree[];
  /** Meadow: the path's centre line in ground units, gx = a + b * sin(gz * k + ph), and half its width. */
  path: { a: number; b: number; k: number; ph: number; half: number } | null;
  /** Snow: the peaks of the main range, as [x, y, half base, ridge slant] for each. */
  peaks: number[];
  /** Desert: the crest lines of the dunes in front, far to near (y for each CSS px column). */
  dunes: Float32Array[];
  /** Desert: each dune crest's wave (frequency, phase), the first crest included; buttes as [x, half width, height]. */
  waves: number[];
  buttes: number[];
  /** Sky tile period in CSS px (tilePx device px). */
  tile: number;
  tilePx: number;
  skyH: number;
}

const colAt = (a: Float32Array, x: number) => a[clamp(Math.round(x), 0, a.length - 1)];

/** Size of a ground unit at depth d in the foreground (0 at the crest, 1 at the bottom edge). */
const persp = (d: number) => 0.24 + 0.76 * d;

/** Places one biome's hills, crest and trees; `side` mirrors a composition position. */
type Scenery = (L: Layout, rng: Rng, seed: number, side: (u: number) => number) => void;

const meadowScenery: Scenery = (L, rng, seed, side) => {
  const { w, F, hz, far, near, crest } = L;
  const sFar = hashInt(seed, 12);
  const sNear = hashInt(seed, 13);
  const sCrest = hashInt(seed, 14);
  const swell = rng.range(0.1, 0.4);
  const swellW = rng.range(0.6, 1.0);
  const swell2 = rng.range(0.6, 0.95);
  const dip = rng.range(0.6, 0.85);
  for (let x = 0; x < far.length; x++) {
    const u = side(x / w);
    const hill = Math.exp(-((((u - swell) * w) / (F * swellW)) ** 2));
    const hill2 = Math.exp(-((((u - swell2) * w) / (F * 0.45)) ** 2));
    far[x] =
      hz -
      F *
        (0.03 +
          0.07 * hill +
          0.035 * hill2 +
          0.025 * fbm(x / (F * 0.4), 0.3, sFar, 0, 3) +
          0.006 * fbm(x / (F * 0.1), 1.7, sFar + 1, 0, 2));
    near[x] = hz - F * (0.014 + 0.022 * (0.5 + 0.5 * fbm(x / (F * 0.3), 2.1, sNear, 0, 3)));
    // the meadow rises nearly to the horizon on one side and falls away on the other
    crest[x] =
      hz +
      F * (0.006 + 0.12 * smoothstep(0.08, dip + 0.08, u) + 0.012 * fbm(x / (F * 0.4), 4.2, sCrest, 0, 2));
  }
  // a stand of poplars on the far fields, where the meadow falls away
  const nPoplars = 4 + rng.int(4);
  const gap = F * rng.range(0.02, 0.03);
  let px = side(rng.range(0.64, 0.8)) * w - ((nPoplars - 1) * gap) / 2;
  for (let i = 0; i < nPoplars; i++) {
    const x = px + rng.signed(gap * 0.25);
    px += gap * rng.range(0.8, 1.25) * (rng.chance(0.15) ? 1.8 : 1);
    const mid = 1 - Math.abs(i / Math.max(1, nPoplars - 1) - 0.45) * 0.9;
    const ht = F * rng.range(0.1, 0.16) * (0.7 + 0.45 * mid);
    L.trees.push({
      kind: "poplar",
      x,
      y: Math.min(hz + F * 0.016, colAt(crest, x) - F * 0.006) + rng.signed(F * 0.002),
      ht,
      wd: ht * rng.range(0.17, 0.23),
      lean: rng.range(0.02, 0.05),
      give: rng.range(0.8, 1.2),
      phase: rng.next() * TAU,
    });
  }
  // and a lone round tree on the rise
  const lx = side(rng.range(0.14, 0.3)) * w;
  const lt = F * rng.range(0.075, 0.1);
  L.trees.push({
    kind: "oak",
    x: lx,
    y: Math.min(hz + F * 0.006, colAt(crest, lx) - F * 0.004),
    ht: lt,
    wd: lt * rng.range(1.0, 1.3),
    lean: 0.012,
    give: 0.45,
    phase: rng.next() * TAU,
  });
  const dir = side(1) > 0.5 ? 1 : -1;
  L.path = { a: dir * 0.03, b: dir * 0.3, k: 1.4, ph: -2.97 + rng.signed(0.3), half: 0.05 };
};

const snowScenery: Scenery = (L, rng, seed, side) => {
  const { w, h, F, hz, far, near, crest } = L;
  // the main range: a few peaks, one of them standing out
  const count = 2 + Math.round(w / (F * 1.1)) + rng.int(2);
  const hero = Math.min(count - 1, Math.floor(side(rng.range(0.25, 0.6)) * count));
  const peaks: number[] = [];
  for (let k = 0; k < count; k++) {
    const x = ((k + 0.5 + rng.signed(0.4)) / count) * w;
    const tall = k === hero ? F * rng.range(0.36, 0.44) : F * rng.range(0.12, 0.27);
    peaks.push(
      x,
      hz - F * 0.03 - tall,
      F * (k === hero ? rng.range(0.55, 0.75) : rng.range(0.3, 0.55)),
      rng.signed(0.4),
    );
  }
  L.peaks = peaks;
  const sRock = hashInt(seed, 15);
  const sFar = hashInt(seed, 16);
  const sCrest = hashInt(seed, 14);
  const dip = rng.range(0.55, 0.85);
  for (let x = 0; x < far.length; x++) {
    let top = 0;
    for (let k = 0; k < peaks.length; k += 4) {
      const d = Math.abs(x - peaks[k]) / peaks[k + 2];
      if (d < 1) top = Math.max(top, (hz - F * 0.03 - peaks[k + 1]) * Math.pow(1 - d, 1.35));
    }
    // broken, rocky edges, sharper up high
    const high = smoothstep(0, F * 0.3, top);
    const jag =
      F *
      (0.012 + 0.012 * high) *
      (fbm(x / (F * 0.06), 0.5, sRock, 0, 3) + 0.4 * fbm(x / (F * 0.015), 2.5, sRock + 1, 0, 2));
    near[x] = hz - F * 0.03 - top + jag;
    far[x] = hz - F * (0.12 + 0.1 * (0.5 + 0.5 * fbm(x / (F * 0.35), 7.7, sFar, 0, 3)));
    crest[x] =
      hz +
      F *
        (0.012 +
          0.08 * smoothstep(0.08, dip + 0.1, side(x / w)) +
          0.012 * fbm(x / (F * 0.4), 4.2, sCrest, 0, 2));
  }
  // dark pines: two or three tall ones close by on one side, and a few small ones further off
  const nBig = 2 + rng.int(2);
  for (let i = 0; i < nBig; i++) {
    const ht = h * rng.range(0.6, 0.85) * (i === 0 ? 1 : 0.82);
    L.trees.push({
      kind: "pine",
      x: side(rng.range(0.02, 0.1) + i * rng.range(0.06, 0.1)) * w,
      y: h * rng.range(0.94, 1.04),
      ht,
      wd: ht * rng.range(0.3, 0.36),
      lean: rng.range(0.005, 0.02),
      give: rng.range(0.35, 0.55),
      phase: rng.next() * TAU,
    });
  }
  const nSmall = 3 + rng.int(3);
  for (let i = 0; i < nSmall; i++) {
    const x = side(rng.range(0.45, 0.97)) * w;
    const d = rng.range(0.08, 0.35);
    const c = colAt(crest, x);
    const ht = F * persp(d) * rng.range(0.22, 0.34);
    L.trees.push({
      kind: "pine",
      x,
      y: c + d * (h - c),
      ht,
      wd: ht * rng.range(0.32, 0.4),
      lean: rng.range(0.005, 0.02),
      give: rng.range(0.4, 0.7),
      phase: rng.next() * TAU,
    });
  }
};

const desertScenery: Scenery = (L, rng, seed, side) => {
  const { w, h, F, hz, far, near, crest } = L;
  // distant mesas: flat tops, steep cliffs and a skirt of fallen rock below
  const nMesas = 2 + Math.round(w / (F * 1.4)) + rng.int(2);
  const mesas: number[] = [];
  for (let k = 0; k < nMesas; k++) {
    mesas.push(
      ((k + 0.5 + rng.signed(0.35)) / nMesas) * w,
      F * rng.range(0.18, 0.5),
      F * rng.range(0.05, 0.11),
    );
  }
  // and a nearer butte or two on one side
  const buttes: number[] = [];
  const nButtes = 1 + rng.int(2);
  for (let k = 0; k < nButtes; k++) {
    buttes.push(
      side(rng.range(0.62, 0.9) - k * 0.22) * w,
      F * rng.range(0.12, 0.22),
      F * rng.range(0.14, 0.24),
    );
  }
  L.buttes = buttes;
  const sTop = hashInt(seed, 20);
  const plateau = (u: number) => smoothstep(1, 0.84, u) * 0.75 + smoothstep(1.45, 0.95, u) * 0.25;
  const sFar = hashInt(seed, 16);
  const sCrest = hashInt(seed, 14);
  for (let x = 0; x < far.length; x++) {
    let f = 0;
    for (let k = 0; k < mesas.length; k += 3)
      f = Math.max(f, mesas[k + 2] * plateau(Math.abs(x - mesas[k]) / mesas[k + 1]));
    far[x] = hz - F * 0.018 - f + F * 0.004 * fbm(x / (F * 0.05), 0.4, sFar, 0, 2);
    let nb = 0;
    for (let k = 0; k < buttes.length; k += 3) {
      const u = Math.abs(x - buttes[k]) / buttes[k + 1];
      // an eroded cap: a step down on one shoulder, a ragged top
      const cap =
        buttes[k + 2] *
        (1 - 0.18 * smoothstep(0.45, 0.6, u) - 0.05 * Math.abs(fbm(x / (F * 0.03), k, sTop, 0, 2)));
      nb = Math.max(nb, cap * plateau(u));
    }
    near[x] = hz - F * 0.004 - nb + F * 0.004 * fbm(x / (F * 0.04), 3.4, sFar + 1, 0, 2);
    crest[x] =
      hz +
      F * (0.035 + 0.025 * Math.sin((x * 3.2) / F + 1.3) + 0.008 * fbm(x / (F * 0.3), 4.2, sCrest, 0, 2));
  }
  // dune crests in front, each a long sinuous ridge
  let mean = 0;
  for (let x = 0; x < crest.length; x++) mean += crest[x];
  mean /= crest.length;
  L.waves.push(3.2 / F, 1.3);
  for (const at of [0.34, 0.7]) {
    const line = new Float32Array(far.length);
    const amp = F * rng.range(0.05, 0.08) * (0.6 + at);
    const freq = rng.range(4.2, 6.5) / F / (0.6 + at);
    const ph = rng.next() * TAU;
    for (let x = 0; x < line.length; x++) {
      line[x] =
        mean +
        (h - mean) * at +
        amp * Math.sin(x * freq + ph) +
        F * 0.008 * fbm(x / (F * 0.2), at * 9, sCrest + 2, 0, 2);
    }
    L.dunes.push(line);
    L.waves.push(freq, ph);
  }
  // a few low desert shrubs
  const nShrubs = 3 + rng.int(4);
  for (let i = 0; i < nShrubs; i++) {
    const x = rng.next() * w;
    const d = rng.range(0.15, 0.95);
    const c = colAt(crest, x);
    const ht = F * persp(d) * rng.range(0.06, 0.11);
    L.trees.push({
      kind: "shrub",
      x,
      y: c + d * (h - c),
      ht,
      wd: ht * rng.range(1.5, 2.1),
      lean: 0.01,
      give: rng.range(0.6, 1),
      phase: rng.next() * TAU,
    });
  }
};

const SCENERY: Record<MeadowBiome, Scenery> = {
  meadow: meadowScenery,
  snow: snowScenery,
  desert: desertScenery,
};

function computeLayout(w: number, h: number, dpr: number, seed: number, biome: MeadowBiome): Layout {
  // 0 for a 16:10 card, 1 for a 3:1 strip (or wider)
  const t = clamp(Math.log(w / h / 1.6) / Math.log(3 / 1.6), 0, 1);
  const hz = h * (biome === "snow" ? lerp(0.64, 0.68, t) : lerp(0.6, 0.64, t));
  const F = Math.min(h, w * 0.9);
  const bu = clamp(Math.sqrt(w * h) / 52, 2.8, 7.5);
  const rng = new Rng(hashInt(seed, 11));
  // mirrored compositions keep the wind blowing left → right
  const flip = rng.chance(0.5);
  const n = Math.ceil(w) + 2;
  const tilePx = Math.ceil(w * dpr);
  const L: Layout = {
    biome,
    w,
    h,
    dpr,
    bu,
    F,
    hz,
    far: new Float32Array(n),
    near: new Float32Array(n),
    crest: new Float32Array(n),
    landTop: 0,
    crestMin: 0,
    meadowH: 0,
    trees: [],
    path: null,
    peaks: [],
    dunes: [],
    waves: [],
    buttes: [],
    tile: tilePx / dpr,
    tilePx,
    skyH: Math.min(h, hz + bu * 2),
  };
  SCENERY[biome](L, rng, seed, (u) => (flip ? 1 - u : u));
  let landTop = Infinity;
  let crestMin = Infinity;
  let meadowH = 0;
  for (let x = 0; x < n; x++) {
    landTop = Math.min(landTop, L.far[x], L.near[x]);
    crestMin = Math.min(crestMin, L.crest[x]);
    meadowH += h - L.crest[x];
  }
  L.landTop = landTop;
  L.crestMin = crestMin;
  L.meadowH = meadowH / n;
  L.trees.sort((a, b) => a.y - b.y);
  return L;
}

/** What the foreground looks like at a point: depth, light, the path and the flowers. */
interface Meadow {
  /** 0 at the crest, 1 at the bottom edge. */
  depth(x: number, y: number): number;
  /** Ground coordinates of a point: across (gx) and away from the viewer (gz, 1 at the bottom edge). */
  gx(x: number, d: number): number;
  /** Sunlit (> 0) or in a cloud's shadow (< 0). */
  light(x: number, y: number): number;
  /** 1 on the trodden middle of the path, 0 off it. */
  path(x: number, y: number): number;
  /** The flower growing here, if any (r in [0, 1) decides how sparse): see FLOWER_*. */
  flower(x: number, y: number, r: number): number;
}

const FLOWER_NONE = 0;
const FLOWER_BUTTERCUP = 1;
const FLOWER_DAISY = 2;
const FLOWER_POPPY = 3;
const FLOWER_CORNFLOWER = 4;

function meadowAt(L: Layout, seed: number): Meadow {
  const { w, h, F, crest, path: P } = L;
  const flowers = L.biome === "meadow";
  const sLight = hashInt(seed, 41);
  const sLight2 = hashInt(seed, 42);
  const sButter = hashInt(seed, 43);
  const sDaisy = hashInt(seed, 44);
  const sPoppy = hashInt(seed, 45);
  const sPath = hashInt(seed, 46);
  const depth = (x: number, y: number) => {
    const c = colAt(crest, x);
    return clamp((y - c) / Math.max(1, h - c), 0, 1);
  };
  const gx = (x: number, d: number) => (x - w / 2) / (F * persp(d));
  return {
    depth,
    gx,
    light(x, y) {
      const d = depth(x, y);
      const u = gx(x, d);
      const v = 1 / persp(d);
      return 1.0 * fbm(u * 0.8, v * 0.9, sLight, 0, 3) + 0.4 * fbm(u * 2.2, v * 2.6, sLight2, 0, 2) + 0.12;
    },
    path(x, y) {
      if (!P) return 0;
      const d = depth(x, y);
      const u = gx(x, d);
      const v = 1 / persp(d);
      const centre = P.a + P.b * Math.sin(v * P.k + P.ph);
      const off = Math.abs(u - centre) / P.half + 0.35 * noise2(u * 9, v * 6, sPath, 0);
      return (1 - smoothstep(0.55, 1.05, off)) * smoothstep(0, 0.07, d);
    },
    flower(x, y, r) {
      if (!flowers) return FLOWER_NONE;
      const d = depth(x, y);
      const u = gx(x, d);
      const v = 1 / persp(d);
      const pp = fbm(u * 1.2 + 3, v * 1.6, sPoppy, 0, 2);
      if (pp > 0.28 && r < (pp - 0.28) * 1.6) return FLOWER_POPPY;
      const bc = fbm(u * 1.5, v * 1.9, sButter, 0, 2);
      if (bc > 0.08 && r < (bc - 0.08) * 2.4) return FLOWER_BUTTERCUP;
      const dz = fbm(u * 2.1 + 9, v * 2.4, sDaisy, 0, 2);
      if (dz > 0.2 && r < (dz - 0.2) * 2.2) return FLOWER_DAISY;
      if (r > 0.992) return FLOWER_POPPY;
      if (r > 0.982) return FLOWER_CORNFLOWER;
      return FLOWER_NONE;
    },
  };
}

/* ------------------------------------------------------------------ sky */

interface CloudField {
  /** Grid cell size (CSS px) across (exactly tile / gw) and down. */
  cx: number;
  cy: number;
  gw: number;
  gh: number;
  /** Thickness of the cloud: 0 in clear sky, about 1 and above inside a cloud. */
  body: Float32Array;
  /** Sunlight on the cloud's surface: 0 in shadow, 1 fully lit. */
  lit: Float32Array;
  /** Direction along the billow's surface, for strokes that follow the form. */
  flow: Float32Array;
}

/**
 * Cumulus as heaps of billows (spheres flattened at the base), lit from the upper left, laid out
 * in rows that grow smaller and flatter towards the horizon. Periodic across the tile.
 */
function* cloudField(L: Layout, rng: Rng, cover: number): Gen<CloudField> {
  const T = L.tile;
  const hz = L.hz;
  const cy = Math.max(1.5, L.bu * 0.45);
  const gw = Math.max(8, Math.round(T / cy));
  const cx = T / gw;
  const gh = Math.ceil(L.skyH / cy) + 1;
  const n = gw * gh;
  const top = new Float32Array(n);
  const body = new Float32Array(n);
  const lit = new Float32Array(n);
  const flow = new Float32Array(n);
  // the sun is high on the left
  const lx = -0.6;
  const ly = -0.6;
  const lz = 0.53;

  /**
   * Adds one billow of a heap (centred on hx, W wide, hc tall, standing on `base`). Its light mixes
   * the billow's own roundness with the form of the whole heap, so the heap reads as one mass.
   */
  const billow = (bx: number, by: number, r: number, base: number, hc: number, hx: number, W: number) => {
    const i0 = Math.floor((bx - r) / cx);
    const i1 = Math.ceil((bx + r) / cx);
    const j0 = Math.max(0, Math.floor((by - r) / cy));
    const j1 = Math.min(gh - 1, Math.ceil(Math.min(by + r, base + hc * 0.15) / cy));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * cy;
      const dy = y - by;
      const flat = 1 - smoothstep(base - hc * 0.1, base + hc * 0.12, y);
      if (flat <= 0) continue;
      const under = smoothstep(base - hc * 0.7, base + hc * 0.05, y);
      const high = 1 - 2 * clamp((y - (base - hc)) / hc, 0, 1);
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * cx - bx;
        const q = 1 - (dx * dx + dy * dy) / r2;
        if (q <= 0) continue;
        const nz = Math.sqrt(q);
        const z = r * nz * flat;
        const k = j * gw + (((i % gw) + gw) % gw);
        if (z <= top[k]) continue;
        top[k] = z;
        body[k] = Math.min(1.6, z / (hc * 0.3));
        const nx = dx / r;
        const ny = dy / r;
        const form = 0.6 * high - 0.4 * clamp((bx + dx - hx) / (W * 0.5), -1, 1);
        const shade = 0.7 * (nx * lx + ny * ly + nz * lz) + 0.3 * form;
        lit[k] = clamp(0.42 + 0.65 * shade - 0.55 * under * under, 0, 1);
        flow[k] = Math.atan2(ny, nx) + HALF_PI;
      }
    }
  };

  /** One heap: billows along a skyline of one to three domes, its tops sheared downwind. */
  const heap = (x: number, base: number, W: number, hc: number) => {
    const shear = rng.range(0.1, 0.4);
    const domes = 1 + rng.int(W > hc * 3 ? 3 : 2);
    const du: number[] = [];
    const dh: number[] = [];
    for (let k = 0; k < domes; k++) {
      du.push(rng.signed(0.33));
      dh.push(rng.range(0.55, 1));
    }
    const skyline = (u: number) => {
      let p = 0.22;
      for (let k = 0; k < domes; k++) p = Math.max(p, dh[k] * (1 - ((u - du[k]) / 0.34) ** 2));
      return p;
    };
    const nb = Math.max(3, Math.round((W / hc) * 1.5 + 2));
    for (let b = 0; b < nb; b++) {
      const u = (b + 0.5) / nb - 0.5 + rng.signed(0.4 / nb);
      const top = skyline(u);
      const r = hc * rng.range(0.32, 0.48) * (0.55 + 0.6 * top);
      const by = base - r * rng.range(0.4, 0.7) - top * hc * rng.range(0.25, 0.5);
      billow(x + u * W + (base - by) * shear, by, r, base, hc, x, W);
    }
    for (let k = 0; k < domes; k++) {
      const by = base - hc * dh[k] * rng.range(0.68, 0.88);
      billow(x + du[k] * W + (base - by) * shear, by, hc * rng.range(0.24, 0.34), base, hc, x, W);
    }
  };

  // A large heap or two high in the sky, then clouds of every size, scattered with a little overlap
  // (so some merge into banks): larger and taller high up, smaller and flatter towards the horizon.
  const size = Math.max(0.5 * hz, Math.min(0.3 * T, 1.1 * hz));
  const boxes: number[] = [];
  const want = T * hz * rng.range(0.25, 0.3) * cover;
  const most = 6 + Math.round(T / Math.max(30, size * 0.3));
  const heroes = T > size * 2.2 ? 2 : 1;
  let covered = 0;
  for (let tries = 0; covered < want && boxes.length < most * 4 && tries < 300; tries++) {
    const hero = boxes.length < heroes * 4;
    const v = hero ? rng.range(0.12, 0.34) : rng.range(0.05, 0.97);
    const s = lerp(1, 0.2, Math.pow(v, 0.85));
    const bank = !hero && rng.chance(0.3);
    // distant clouds lie in long, flat banks
    const far = smoothstep(0.4, 0.95, v);
    const span =
      (hero ? rng.range(1.1, 1.6) : bank ? rng.range(1.0, 2.0) : rng.range(0.3, 0.9)) * (1 + 1.2 * far);
    const W = Math.min(T * 0.85, size * s * span);
    const hc =
      size * s * lerp(0.46, 0.2, v) * (hero ? rng.range(1.05, 1.35) : rng.range(0.7, 1.2)) * (bank ? 0.8 : 1);
    // too small to read as a heap: the veils stand in for those
    if (W < L.bu * 7) continue;
    const base = v * hz;
    const x = rng.next() * T;
    const x0 = x - W / 2;
    const x1 = x + W / 2;
    let clash = false;
    for (let i = 0; i < boxes.length && !clash; i += 4) {
      const oy = Math.min(base, boxes[i + 3]) - Math.max(base - hc, boxes[i + 2]);
      if (oy <= 0) continue;
      const other = (boxes[i + 1] - boxes[i]) * (boxes[i + 3] - boxes[i + 2]);
      for (let shift = -T; shift <= T; shift += T) {
        const ox = Math.min(x1, boxes[i + 1] + shift) - Math.max(x0, boxes[i] + shift);
        if (ox > 0 && ox * oy > 0.22 * Math.min(W * hc, other)) clash = true;
      }
    }
    if (clash) continue;
    boxes.push(x0, x1, base - hc, base);
    covered += W * hc * 0.7;
    heap(x, base, W, hc);
    if ((tries & 3) === 3) yield;
  }
  return { cx, cy, gw, gh, body, lit, flow };
}

function* paintSky(ctx: Ctx, L: Layout, seed: number): Gen {
  const rng = new Rng(hashInt(seed, 101));
  const brush = new Brush(ctx, rng);
  brush.scale = L.dpr;
  const T = L.tile;
  const H = L.skyH;
  const hz = L.hz;
  const bu = L.bu;
  const S = SKIES[L.biome];
  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  ctx.lineCap = "round";

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  for (const s of S.sky) grad.addColorStop(clamp((s.at * hz) / H, 0, 1), hex(s.c));
  ctx.globalAlpha = 1;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, T, H);
  yield;

  const f = yield* cloudField(L, rng, S.cover);
  const sDet = hashInt(seed, 8);
  const pDet = Math.max(4, Math.round(T / clamp(hz * 0.1, 12, 48)));
  const fDet = pDet / T;
  const cellOf = (x: number, y: number) => {
    const xi = Math.min(f.gw - 1, Math.floor((((x % T) + T) % T) / f.cx));
    return clamp(Math.floor(y / f.cy), 0, f.gh - 1) * f.gw + xi;
  };
  const coverAt = (x: number, y: number, k: number) =>
    smoothstep(0.15, 0.55, f.body[k] + 0.45 * fbm(x * fDet, y * fDet * 1.7, sDet, pDet, 3));
  // distant clouds and the sky near the horizon take smaller strokes
  const sizeAt = (y: number) => lerp(1.12, 0.42, Math.pow(clamp(y / hz, 0, 1), 1.15));

  const wrapped = (x: number, reach: number, draw: (x: number) => void) => {
    const st = rng.state;
    draw(x);
    const after = rng.state;
    if (x + reach > T) {
      rng.state = st;
      draw(x - T);
    }
    if (x - reach < 0) {
      rng.state = st;
      draw(x + T);
    }
    rng.state = after;
  };
  const centredWrapped = (
    x: number,
    y: number,
    ang: number,
    len: number,
    wid: number,
    col: Lab,
    a: number,
  ) => {
    const bend = rng.signed(0.16);
    wrapped(x, len + wid, (px) =>
      brush.stroke(
        px - Math.cos(ang) * len * 0.5,
        y - Math.sin(ang) * len * 0.5,
        ang,
        len,
        wid,
        bend,
        col,
        a,
      ),
    );
  };

  const bottom = Math.min(H, hz);
  const area = T * bottom;
  const unit = area / (bu * bu);

  // 1. blue underlayer: steep diagonal hatching and flatter strokes along the wind
  const nBlue = Math.round(unit / 3.2);
  for (let i = 0; i < nBlue; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * T;
    const y = rng.range(-bu, H);
    const v = clamp(y / hz + rng.signed(0.08), 0, 1);
    const r0 = rng.next();
    const col =
      r0 < 0.06 && v < 0.6
        ? rng.pick(S.deep)
        : r0 > 0.9
          ? mix(rampAt(S.sky, v), rng.pick(S.turq), 0.5)
          : r0 > 0.8
            ? rampAt(S.sky, clamp(v + rng.range(0.08, 0.2), 0, 1))
            : rampAt(S.sky, v);
    const steep = rng.chance(0.4);
    const ang = steep ? -1.0 + rng.signed(0.3) : -0.16 + rng.signed(0.22);
    const sz = sizeAt(y);
    centredWrapped(
      x,
      y,
      ang,
      bu * rng.range(1.5, 3.2) * sz,
      bu * rng.range(0.55, 1.05) * sz,
      col,
      rng.range(0.5, 0.88),
    );
  }

  // 2. a far layer of thin cloud behind the cumulus, streaked out by the wind
  const pVeil = Math.max(2, Math.round(T / clamp(hz * 0.7, 60, 360)));
  const fVeil = pVeil / T;
  const sVeil = hashInt(seed, 9);
  const nVeil = Math.round(unit * 0.45 * S.veil);
  for (let i = 0; i < nVeil; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * T;
    const y = rng.range(0, bottom);
    const v = clamp(y / hz, 0, 1);
    // most in the middle and lower sky, thinning towards the zenith
    const n = fbm(x * fVeil, y * fVeil * 3.4, sVeil, pVeil, 4) + 0.2 * smoothstep(0.15, 0.7, v) - 0.12;
    const c = smoothstep(0.12, 0.45, n);
    if (c < 0.05 || rng.next() > c) continue;
    const r = rng.next();
    const sky = rampAt(S.sky, v);
    const col =
      r < 0.35
        ? mix(rampAt(S.light, rng.range(0.35, 0.8)), sky, 0.25)
        : r < 0.8
          ? mix(rng.pick(S.lav), sky, 0.45)
          : mix(rng.pick(S.haze), sky, 0.3);
    const sz = sizeAt(y);
    centredWrapped(
      x,
      y,
      -0.08 + rng.signed(0.16),
      bu * rng.range(2.2, 4.4) * sz,
      bu * rng.range(0.6, 1.1) * sz,
      col,
      rng.range(0.2, 0.42) * (0.5 + 0.5 * c),
    );
  }

  // 3. cumulus: dark to light, then broken edges and the sky cut back into them. Strokes are placed
  // only where there is cloud, more (and smaller) ones on the distant clouds near the horizon.
  const cells: number[] = [];
  const weights: number[] = [];
  let total = 0;
  for (let j = 0; j < f.gh; j++) {
    const s = sizeAt((j + 0.5) * f.cy);
    const wgt = (f.cx * f.cy) / (bu * bu * s * s);
    for (let i = 0; i < f.gw; i++) {
      const k = j * f.gw + i;
      if (f.body[k] <= 0.02) continue;
      total += wgt;
      cells.push(k);
      weights.push(total);
    }
  }
  const pickCell = () => {
    const r = rng.next() * total;
    let lo = 0;
    let hi = weights.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (weights[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return cells[lo];
  };
  const cloudStroke = (x: number, y: number, k: number, col: Lab, size: number, alpha: number) => {
    const r = rng.next();
    const ang =
      r < 0.5 ? f.flow[k] + rng.signed(0.4) : r < 0.82 ? -0.12 + rng.signed(0.22) : -0.85 + rng.signed(0.3);
    const s = size * sizeAt(y) * rng.range(0.7, 1.35);
    centredWrapped(x, y, ang, bu * rng.range(1.2, 2.6) * s, bu * rng.range(0.55, 1.0) * s, col, alpha);
  };
  const passes: [number, number][] = [
    // [strokes per (local) brush unit² of cloud, kind]
    [0.35, 6],
    [0.7, 0],
    [0.55, 1],
    [0.4, 2],
    [0.28, 3],
    [0.4, 4],
    [0.45, 5],
  ];
  for (const [factor, kind] of cells.length ? passes : []) {
    const count = Math.round(total * factor * 0.85);
    for (let i = 0; i < count; i++) {
      if ((i & 31) === 31) yield;
      const k = pickCell();
      const x = ((k % f.gw) + rng.next()) * f.cx;
      const y = (Math.floor(k / f.gw) + rng.next()) * f.cy;
      const c = coverAt(x, y, k);
      const l = clamp(f.lit[k] + rng.signed(0.12), 0, 1);
      if (kind === 6) {
        // broad underpainting in middle tones, so no blue shows through the body
        if (c < 0.3) continue;
        const col = l < 0.5 ? rampAt(S.shade, 0.3 + l) : rampAt(S.light, (l - 0.5) * 0.8);
        cloudStroke(x, y, k, col, 1.9, rng.range(0.6, 0.85));
      } else if (kind === 0) {
        // shadowed and lit masses
        if (c < 0.3) continue;
        const col = l < 0.5 ? rampAt(S.shade, l / 0.5) : rampAt(S.light, ((l - 0.5) / 0.5) * 0.8);
        cloudStroke(x, y, k, col, 1.4, rng.range(0.7, 0.92));
      } else if (kind === 1) {
        // sunlit planes
        if (c < 0.35 || l < 0.52) continue;
        const col = rng.chance(0.1) ? rng.pick(S.warm) : rampAt(S.light, (l - 0.4) / 0.6);
        cloudStroke(x, y, k, col, 1.0, rng.range(0.75, 0.93));
      } else if (kind === 2) {
        // lavender shadows and blue reflected from the sky
        if (c < 0.4 || l > 0.42) continue;
        const r = rng.next();
        const col =
          r < 0.4
            ? rng.pick(S.lav)
            : r < 0.6
              ? mix(rampAt(S.sky, clamp(y / hz, 0, 1)), rampAt(S.shade, 0.3), 0.5)
              : rampAt(S.shade, (l / 0.42) * 0.8);
        cloudStroke(x, y, k, col, 0.8, rng.range(0.65, 0.9));
      } else if (kind === 3) {
        // highlights on the sunlit tops
        if (c < 0.5 || l < 0.74) continue;
        cloudStroke(x, y, k, rampAt(S.light, rng.range(0.86, 1)), 0.62, rng.range(0.8, 0.97));
      } else if (kind === 4) {
        // broken edges, and flecks the wind tears off downwind
        if (c < 0.06 || c > 0.5) continue;
        const col = l < 0.4 ? rampAt(S.shade, 0.5 + l) : rampAt(S.light, 0.2 + l * 0.7);
        cloudStroke(x, y, k, col, 0.7, rng.range(0.55, 0.85));
        if (rng.chance(0.15)) {
          const fx = x + bu * rng.range(1.5, 4) * sizeAt(y);
          const fy = y + rng.signed(bu * 0.5);
          cloudStroke(fx, fy, k, rampAt(S.light, rng.range(0.4, 0.9)), 0.4, rng.range(0.45, 0.7));
        }
      } else {
        // the sky cut back into the cloud edges, as a painter breaks up the masses
        if (c < 0.05 || c > 0.5) continue;
        const col = rampAt(S.sky, clamp(y / hz + rng.signed(0.06), 0, 1));
        cloudStroke(x, y, k, col, 0.65, rng.range(0.6, 0.85));
      }
    }
  }

  // 4. thin streaks of high cloud along the wind, in the clear upper sky
  const nWisps = Math.round(T / (bu * 16));
  for (let i = 0; i < nWisps; i++) {
    const x0 = rng.next() * T;
    const y0 = rng.range(0.04, 0.55) * hz;
    if (coverAt(x0, y0, cellOf(x0, y0)) > 0.15) continue;
    const ang = -0.1 + rng.signed(0.12);
    const parts = 3 + rng.int(3);
    for (let j = 0; j < parts; j++) {
      const s = sizeAt(y0);
      const x = x0 + Math.cos(ang) * j * bu * 2.2 * s + rng.signed(bu * 0.5);
      const y = y0 + Math.sin(ang) * j * bu * 2.2 * s + rng.signed(bu * 0.3);
      centredWrapped(
        x,
        y,
        ang + rng.signed(0.08),
        bu * rng.range(2, 3.6) * s,
        bu * rng.range(0.25, 0.45) * s,
        rampAt(S.light, rng.range(0.55, 0.95)),
        rng.range(0.18, 0.38),
      );
    }
    if ((i & 7) === 7) yield;
  }

  // 5. warm haze above the hills
  const hazeTop = hz - L.F * 0.17;
  const nHaze = Math.round((T * (H - hazeTop)) / (bu * bu * 1.2));
  for (let i = 0; i < nHaze; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * T;
    const y = rng.range(hazeTop, H);
    const v = (y - hazeTop) / (H - hazeTop);
    if (rng.next() > v + 0.15) continue;
    const col = rng.chance(0.6) ? rng.pick(S.haze) : rampAt(S.sky, rng.range(0.85, 1));
    centredWrapped(
      x,
      y,
      rng.signed(0.12),
      bu * rng.range(1.4, 2.8) * 0.5,
      bu * rng.range(0.4, 0.7) * 0.5,
      col,
      rng.range(0.35, 0.7),
    );
  }
}

/* ------------------------------------------------------------------ land */

function fillBelow(ctx: Ctx, L: Layout, line: Float32Array, bottom: number, style: string | CanvasGradient) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.moveTo(0, bottom);
  for (let x = 0; ; x += 3) {
    const xx = Math.min(x, L.w);
    ctx.lineTo(xx, colAt(line, xx));
    if (xx >= L.w) break;
  }
  ctx.lineTo(L.w, bottom);
  ctx.closePath();
  ctx.fill();
}

function vgrad(ctx: Ctx, y0: number, y1: number, colors: string[]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
  return g;
}

/** A range of hills in small strokes that follow its slopes; left-facing slopes catch the sun. */
function* paintRange(
  b: Brush,
  L: Layout,
  line: Float32Array,
  bottom: number,
  pal: Lab[],
  lit: Lab[],
  size: number,
  haze: number,
  front: Float32Array | null,
): Gen {
  const { rng } = b;
  const { w } = L;
  const s = Math.max(L.bu * size, 2);
  // only what shows above the skyline in front needs painting
  const hidden = (x: number) => (front ? Math.min(bottom, colAt(front, x) + s) : bottom);
  let area = 0;
  for (let x = 0; x < w; x += 4) area += Math.max(0, hidden(x) - colAt(line, x)) * 4;
  const count = Math.round((area / (s * s)) * 0.85);
  const slopeAt = (x: number) => (colAt(line, x + 4) - colAt(line, x - 4)) / 8;
  const sFold = rng.int(1e9);
  for (let i = 0; i < count; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const top = colAt(line, x);
    const low = hidden(x);
    if (low <= top) continue;
    const y = rng.range(top + s * 0.15, low);
    const v = (y - top) / (bottom - top);
    const slope = slopeAt(x);
    // sunlit slopes, shadowed folds and woods
    const fold = fbm(x / (L.F * 0.08), v * 1.6, sFold, 0, 2);
    const sun = -slope * 2.5 + (0.5 - v) * 0.6 + fold * 1.1 + rng.signed(0.3);
    let col = sun > 0.35 ? rng.pick(lit) : rng.pick(pal);
    // the air between: hazier towards the skyline
    if (haze > 0) col = mix(col, rng.pick(HAZE), haze * (1 - v) * rng.next());
    const ang = Math.atan(slope) * 0.8 + rng.signed(0.3);
    centred(
      b,
      x,
      y,
      ang,
      s * rng.range(1.5, 3),
      s * rng.range(0.55, 0.95),
      rng.signed(0.12),
      col,
      rng.range(0.55, 0.85),
      0.5,
    );
  }
  // strokes riding along the skyline soften it
  const nEdge = Math.round(w / (s * 1.4));
  for (let i = 0; i < nEdge; i++) {
    const x = rng.next() * w;
    if (hidden(x) <= colAt(line, x)) continue;
    const slope = slopeAt(x);
    centred(
      b,
      x,
      colAt(line, x) + s * 0.3,
      Math.atan(slope) + rng.signed(0.15),
      s * rng.range(1.6, 3),
      s * rng.range(0.45, 0.7),
      rng.signed(0.08),
      -slope * 2.5 + rng.signed(0.5) > 0.2 ? rng.pick(lit) : rng.pick(pal),
      rng.range(0.6, 0.85),
      0.4,
    );
  }
}

/** One rounded mass of distant trees standing on (x, y). */
function clump(b: Brush, x: number, y: number, r: number, dark: Lab[], lit: Lab[]): void {
  const { rng } = b;
  // small, far-off clumps need fewer strokes
  const small = r < 3;
  for (let k = 0; k < (small ? 3 : 5); k++) {
    centred(
      b,
      x + rng.signed(r * 0.6),
      y - r * rng.range(0.3, 0.9),
      -HALF_PI + rng.signed(0.6),
      r * rng.range(0.9, 1.4),
      r * rng.range(0.6, 0.9),
      rng.signed(0.2),
      rng.pick(dark),
      rng.range(0.8, 0.95),
      0.5,
    );
  }
  for (let k = 0; k < (small ? 1 : 2); k++) {
    centred(
      b,
      x - r * rng.range(0.1, 0.5),
      y - r * rng.range(0.9, 1.3),
      rng.signed(0.8),
      r * rng.range(0.6, 1.0),
      r * rng.range(0.4, 0.6),
      rng.signed(0.2),
      rng.pick(lit),
      rng.range(0.7, 0.9),
      0.4,
    );
  }
}

function grassColor(rng: Rng, light: number, d: number): Lab {
  if (rng.chance(0.015 + 0.03 * d)) return rng.pick(rng.chance(0.5) ? GRASS.violet : GRASS.earth);
  // the distance turns hazy and cool
  if (rng.chance(0.35 * (1 - smoothstep(0, 0.1, d)))) {
    return rng.chance(0.55) ? rng.pick(GRASS.haze) : rng.pick(GRASS.cool);
  }
  const sun = light * 1.2 + (0.3 - d) * 0.3 + rng.signed(0.35);
  if (sun > 0.3) return rng.pick(GRASS.sun);
  if (sun > -0.1) return rng.pick(GRASS.mid);
  // under a cloud's shadow the greens turn deep and blue
  if (sun > -0.45) return rng.chance(0.35) ? rng.pick(GRASS.cool) : rng.pick(GRASS.dark);
  return rng.chance(0.3) ? rng.pick(GRASS.cool) : rng.pick(GRASS.deep);
}

function* paintMeadowLand(ctx: Ctx, L: Layout, M: Meadow, seed: number): Gen {
  const rng = new Rng(hashInt(seed, 202));
  const b = new Brush(ctx, rng);
  const { w, h, bu, F, hz, dpr } = L;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  b.scale = dpr;
  ctx.lineCap = "round";

  // far hills, then a nearer, greener range in front of them
  fillBelow(ctx, L, L.far, h, vgrad(ctx, L.landTop, hz, ["#b2b8d2", "#94a4c8"]));
  yield* paintRange(b, L, L.far, hz, HILL_FAR, HILL_FAR_LIT, 0.42, 0.55, L.near);
  fillBelow(ctx, L, L.near, h, vgrad(ctx, hz - F * 0.03, hz, ["#8094b0", "#7a8ea8"]));
  yield* paintRange(b, L, L.near, hz + F * 0.004, HILL_NEAR, HILL_NEAR_LIT, 0.45, 0.2, L.crest);
  // woods along the nearer ridge give it a rounded, broken skyline
  for (let x = -F * 0.02, i = 0; x < w + F * 0.02; i++) {
    const r = Math.max(2.2, F * rng.range(0.01, 0.018));
    if (rng.chance(0.7)) clump(b, x, colAt(L.near, x) + r * 0.9, r, HILL_NEAR, HILL_NEAR_LIT);
    x += r * rng.range(1.0, 1.8);
    if ((i & 7) === 7) yield;
  }

  // the far fields: a patchwork of hazy greens and a golden crop, flattened by the distance
  ctx.globalAlpha = 1;
  ctx.fillStyle = vgrad(ctx, hz, hz + F * 0.09, ["#9cae86", "#98aa74"]);
  ctx.fillRect(0, hz, w, h - hz);
  const sField = hashInt(seed, 62);
  const sf = Math.max(bu * 0.4, 1.9);
  let farArea = 0;
  for (let x = 0; x < w; x += 4) farArea += Math.max(0, colAt(L.crest, x) + bu - hz) * 4;
  const nFar = Math.round((farArea / (sf * sf)) * 0.45);
  for (let i = 0; i < nFar; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const c = colAt(L.crest, x) + bu * 0.5;
    if (c <= hz) continue;
    const y = rng.range(hz, c);
    const v = clamp((y - hz) / (F * 0.08), 0, 1);
    const fv = fbm(x / (F * 0.3), (y - hz) / (F * 0.014), sField, 0, 2);
    let col =
      fv > 0.32
        ? rng.pick(FIELD_GOLD)
        : fv < -0.3
          ? rng.pick(FIELD_SHADE)
          : rng.chance(0.25)
            ? rng.pick(FIELD_SUN)
            : rng.pick(FIELD_FAR);
    if (rng.chance(0.012)) col = rng.pick(POPPY);
    const sz = sf * (0.8 + 0.5 * v);
    centred(
      b,
      x,
      y,
      rng.signed(0.12),
      sz * rng.range(1.6, 3.2),
      sz * rng.range(0.45, 0.8),
      rng.signed(0.1),
      col,
      rng.range(0.6, 0.9),
      0.4,
    );
  }
  // hedgerows between the fields
  const nHedges = 2 + rng.int(2);
  for (let k = 0; k < nHedges; k++) {
    const y0 = hz + F * rng.range(0.008, 0.032);
    const x0 = rng.next() * w;
    const len = w * rng.range(0.15, 0.4);
    const tilt = rng.signed(0.03);
    for (let x = x0; x < x0 + len; x += sf * 1.3) {
      const y = y0 + (x - x0) * tilt;
      if (y > colAt(L.crest, x) - sf) continue;
      centred(
        b,
        x,
        y - sf * 0.4,
        rng.signed(0.5),
        sf * rng.range(1, 1.8),
        sf * rng.range(0.7, 1.1),
        0,
        rng.pick(TREE_LINE),
        0.85,
        0.3,
      );
      if (rng.chance(0.4)) {
        b.dab(x - sf * 0.3, y - sf * 0.9, sf * 0.4, 0, rng.pick(TREE_LINE_LIT), 0.8);
      }
    }
  }
  yield;

  // the tree line along the foot of the hills
  const sLine = hashInt(seed, 61);
  let tx = -F * 0.02;
  for (let i = 0; tx < w + F * 0.02; i++) {
    const v = fbm(tx / (F * 0.22), 0.7, sLine, 0, 2);
    const r = Math.max(2.2, F * rng.range(0.008, 0.016) * (0.7 + 0.6 * clamp(v + 0.4, 0, 1)));
    if (v > -0.2) clump(b, tx, hz + F * 0.003, r, TREE_LINE, TREE_LINE_LIT);
    tx += r * rng.range(0.8, 1.5);
    if ((i & 7) === 7) yield;
  }

  // the meadow: underpainting, then broad blocking-in by light and shade
  fillBelow(ctx, L, L.crest, h, vgrad(ctx, L.crestMin, h, ["#a2ad62", "#86993f", "#5f7e37", "#3d602f"]));
  const yAt = (x: number, d: number) => {
    const c = colAt(L.crest, x);
    return c + d * (h - c);
  };
  const meadowArea = w * L.meadowH;
  const nBlock = Math.round(meadowArea / (bu * bu * 9));
  for (let i = 0; i < nBlock; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const d = rng.next();
    const y = yAt(x, d) + (d > 0.96 ? bu : 0);
    const sc = 1.5 * persp(d);
    const l = M.light(x, y) + rng.signed(0.3);
    let col =
      l < -0.4
        ? rng.pick(GRASS.deep)
        : l < 0
          ? rng.pick(GRASS.dark)
          : rng.chance(0.2)
            ? rng.pick(GRASS.earth)
            : rng.pick(GRASS.mid);
    if (d < 0.15) col = mix(col, rng.pick(GRASS.haze), 0.5);
    const ang = d < 0.3 ? rng.signed(0.3) : -HALF_PI + rng.range(0.3, 0.9);
    centred(
      b,
      x,
      y,
      ang,
      bu * rng.range(2.4, 4.5) * sc,
      bu * rng.range(1.1, 2) * sc,
      rng.signed(0.1),
      col,
      rng.range(0.45, 0.75),
      0.5,
    );
  }

  // the path: worn, pale earth that the grass is taking back
  const P = L.path ?? { a: 0, b: 0, k: 0, ph: 0, half: 0 };
  const pathPoint = (d: number, across: number): [number, number] => {
    const p = persp(d);
    const v = 1 / p;
    const u = P.a + P.b * Math.sin(v * P.k + P.ph) + across * P.half;
    const x = w / 2 + u * F * p;
    return [x, yAt(x, d)];
  };
  const nPath = Math.round((F * P.half * 2 * L.meadowH) / (bu * bu * 0.35));
  for (let i = 0; i < nPath; i++) {
    if ((i & 31) === 31) yield;
    const d = Math.sqrt(rng.next());
    const [x, y] = pathPoint(d, rng.signed(1.1));
    const core = M.path(x, y);
    if (core < 0.15 || rng.next() > core + 0.2) continue;
    const sc = 1.5 * persp(d);
    const [x1, y1] = pathPoint(Math.max(0, d - 0.04), 0);
    const [x2, y2] = pathPoint(Math.min(1, d + 0.04), 0);
    const along = Math.atan2(y2 - y1, x2 - x1);
    const ang = rng.chance(0.5) ? along + rng.signed(0.25) : rng.signed(0.25);
    let col = M.light(x, y) > -0.05 ? rng.pick(PATH) : rng.pick(PATH_SHADE);
    if (core < 0.6) col = mix(col, rng.pick(GRASS.sun), 0.5);
    centred(
      b,
      x,
      y,
      ang,
      bu * rng.range(1.2, 2.4) * sc,
      bu * rng.range(0.4, 0.75) * sc,
      rng.signed(0.12),
      col,
      rng.range(0.45, 0.75),
      0.6,
    );
  }

  // the grass: depth bands, small and combed flat far away, large and upright in front
  const bands = 24;
  for (let band = 0; band < bands; band++) {
    const dm = (band + 0.5) / bands;
    const k = Math.max(1.5 * persp(dm), 0.6);
    const count = Math.round(meadowArea / bands / (bu * bu * k * k * 1.5));
    for (let i = 0; i < count; i++) {
      if ((i & 31) === 31) yield;
      const x = rng.next() * w;
      const d = (band + rng.next()) / bands;
      const y = yAt(x, d) + (d > 0.96 ? bu * 0.6 : 0);
      if (M.path(x, y) > 0.55 && rng.chance(0.55)) continue;
      const sc = Math.max(1.5 * persp(d), 1.4 / bu);
      const l = M.light(x, y);
      const col = grassColor(rng, l, d);
      const r2 = rng.next();
      const lean = r2 < 0.1 ? -rng.range(0, 0.4) : r2 < 0.2 ? rng.range(0.9, 1.3) : rng.range(0.15, 0.85);
      const up = -HALF_PI + lean + l * 0.1;
      const ang = lerp(-0.2 + rng.signed(0.35), up, smoothstep(0, 0.4, d));
      centred(
        b,
        x,
        y,
        ang,
        bu * rng.range(1.3, 2.7) * sc,
        bu * rng.range(0.4, 0.75) * sc,
        0.04 + rng.signed(0.12),
        col,
        rng.range(0.7, 0.95),
        0.7,
      );
    }
  }

  // flowers: drifts of buttercups and daisies, a few poppies, the odd cornflower
  const nFlowers = Math.round(meadowArea / (bu * bu * 3.2));
  for (let i = 0; i < nFlowers; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const d = rng.next();
    const y = yAt(x, d);
    const kind = M.flower(x, y, rng.next());
    if (kind === FLOWER_NONE || M.path(x, y) > 0.6) continue;
    const sc = Math.max(1.5 * persp(d), 1.1 / bu);
    const far = d < 0.25;
    if (kind === FLOWER_BUTTERCUP) {
      const r = bu * 0.26 * sc * rng.range(0.8, 1.3);
      const col = rng.pick(BUTTERCUP);
      const n = far ? 1 : 2;
      for (let j = 0; j < n; j++) {
        centred(
          b,
          x + rng.signed(r),
          y + rng.signed(r * 0.6),
          far ? rng.signed(0.25) : rng.signed(Math.PI),
          r * rng.range(1.6, 2.4),
          r * rng.range(1.0, 1.4),
          rng.signed(0.2),
          col,
          rng.range(0.8, 0.95),
          0.3,
        );
      }
    } else if (kind === FLOWER_DAISY) {
      const r = bu * 0.3 * sc * rng.range(0.8, 1.2);
      centred(b, x, y, rng.signed(0.4), r * 2.4, r * 1.3, 0, rng.pick(DAISY), rng.range(0.85, 0.97), 0.2);
      if (!far) b.dab(x + r * 0.1, y, r * 0.4, 0, BUTTERCUP[2], 0.9);
    } else if (kind === FLOWER_POPPY) {
      const r = bu * 0.36 * sc * rng.range(0.8, 1.25);
      const col = rng.pick(POPPY);
      centred(b, x, y, rng.signed(0.5), r * 2.2, r * 1.6, rng.signed(0.2), col, 0.92, 0.4);
      if (!far) {
        b.dab(x - r * 0.3, y - r * 0.3, r * 0.6, rng.signed(1), lighten(col, 0.08), 0.75);
        b.dab(x + r * 0.15, y + r * 0.15, r * 0.25, 0, hexLab("#3a1f22"), 0.8);
      }
    } else {
      const r = bu * 0.22 * sc * rng.range(0.8, 1.2);
      centred(b, x, y, rng.signed(1), r * 2, r * 1.2, 0, rng.pick(CORNFLOWER), 0.9, 0.2);
    }
  }

  // light accents last: sunlit tips and pale seed heads
  const nTips = Math.round(meadowArea / (bu * bu * 7));
  for (let i = 0; i < nTips; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const d = Math.pow(rng.next(), 0.8);
    const y = yAt(x, d);
    if (M.light(x, y) < -0.25) continue;
    const sc = Math.max(1.5 * persp(d), 1.2 / bu);
    const col = rng.chance(0.25) ? rng.pick(GRASS.pale) : rng.pick(GRASS.sun);
    const up = -HALF_PI + rng.range(0.3, 0.8);
    centred(
      b,
      x,
      y,
      lerp(rng.signed(0.3), up, smoothstep(0, 0.4, d)),
      bu * rng.range(1.2, 2.4) * sc,
      bu * rng.range(0.25, 0.5) * sc,
      0.05,
      col,
      rng.range(0.7, 0.9),
      0.5,
    );
  }

  // the crest: tiny strokes along it make a soft edge against the far fields
  const sc0 = Math.max(1.5 * persp(0), 1.1 / bu);
  const nCrest = Math.round(w / (bu * sc0 * 0.8));
  for (let i = 0; i < nCrest; i++) {
    const x = rng.next() * w;
    const y = colAt(L.crest, x) + rng.signed(bu * sc0 * 0.4);
    const col = rng.chance(0.55)
      ? rng.pick(GRASS.sun)
      : rng.chance(0.5)
        ? rng.pick(GRASS.pale)
        : rng.pick(GRASS.mid);
    centred(
      b,
      x,
      y,
      rng.signed(0.6) - 0.2,
      bu * rng.range(1.2, 2.2) * sc0,
      bu * rng.range(0.35, 0.6) * sc0,
      0,
      col,
      rng.range(0.7, 0.9),
      0.3,
    );
  }
}

/** The snow biome's main range: sunlit faces left of each ridge line, blue-violet shade right of it. */
function* paintPeaks(b: Brush, L: Layout, seed: number): Gen {
  const { rng } = b;
  const { w, bu, F, hz, near, peaks } = L;
  const s = Math.max(bu * 0.62, 2.4);
  const sRock = hashInt(seed, 17);
  const sRidge = hashInt(seed, 18);
  let area = 0;
  for (let x = 0; x < w; x += 4) area += Math.max(0, hz - colAt(near, x)) * 4;
  const faceAt = (x: number, y: number) => {
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < peaks.length; k += 4) {
      const d = Math.abs(x - peaks[k]) / peaks[k + 2];
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    const ridge =
      peaks[best] +
      (y - peaks[best + 1]) * peaks[best + 3] +
      F * 0.04 * fbm(y / (F * 0.06), best, sRidge, 0, 2);
    return x - ridge;
  };
  const count = Math.round((area / (s * s)) * 0.8);
  for (let i = 0; i < count; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const top = colAt(near, x);
    if (top >= hz) continue;
    const y = rng.range(top + s * 0.2, hz + s);
    const v = (y - top) / (hz - top);
    const face = faceAt(x, y) + rng.signed(s * 1.5);
    const rock = fbm(x / (F * 0.05), y / (F * 0.07), sRock, 0, 2) > 0.3 && v > 0.06;
    let col: Lab;
    if (rock) col = face < 0 ? mix(rng.pick(SNOW.rock), rng.pick(SNOW.lit), 0.25) : rng.pick(SNOW.rock);
    else if (face < -s) col = rng.chance(0.75) ? rng.pick(SNOW.lit) : rng.pick(SNOW.half);
    else if (face < s) col = rng.pick(SNOW.half);
    else col = rng.chance(0.2) ? rng.pick(SNOW.deep) : rng.pick(SNOW.shade);
    // mist gathers at the foot of the range
    if (v > 0.7) col = mix(col, rng.pick(SNOW.half), (v - 0.7) * 1.6);
    // strokes run down the fall lines of each face
    const ang = rng.chance(0.3) ? rng.signed(0.2) : HALF_PI + (face < 0 ? 0.55 : -0.55) + rng.signed(0.3);
    centred(
      b,
      x,
      y,
      ang,
      s * rng.range(1.5, 3),
      s * rng.range(0.5, 0.9),
      rng.signed(0.12),
      col,
      rng.range(0.65, 0.92),
      0.5,
    );
  }
  // the skyline: the sunlit side of each ridge catches a warm edge
  const nEdge = Math.round(w / (s * 1.2));
  for (let i = 0; i < nEdge; i++) {
    const x = rng.next() * w;
    const top = colAt(near, x);
    if (top >= hz - s) continue;
    const slope = (colAt(near, x + 3) - colAt(near, x - 3)) / 6;
    const lit = faceAt(x, top + s) < 0;
    centred(
      b,
      x,
      top + s * 0.35,
      Math.atan(slope),
      s * rng.range(1.4, 2.6),
      s * rng.range(0.4, 0.7),
      0,
      lit ? rng.pick(SNOW.lit) : rng.pick(SNOW.shade),
      0.85,
      0.3,
    );
  }
}

/** Long shadows of the trees, falling to the right across the ground. */
function castShadows(b: Brush, L: Layout, kind: TreeKind, colors: Lab[], reach: number): void {
  const { rng } = b;
  for (const t of L.trees) {
    if (t.kind !== kind) continue;
    const length = t.ht * reach * rng.range(0.9, 1.2);
    for (let j = 0; j < 6; j++) {
      const f = j / 6;
      centred(
        b,
        t.x + length * (f + 0.08),
        t.y + t.ht * 0.025 * f + rng.signed(t.wd * 0.04),
        0.05 + rng.signed(0.04),
        length * 0.28,
        Math.max(0.8, t.wd * 0.34 * (1 - f * 0.6)),
        0,
        rng.pick(colors),
        0.5,
        0.3,
      );
    }
  }
}

function* paintSnowLand(ctx: Ctx, L: Layout, M: Meadow, seed: number): Gen {
  const rng = new Rng(hashInt(seed, 202));
  const b = new Brush(ctx, rng);
  const { w, h, bu, F, hz, dpr } = L;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  b.scale = dpr;
  ctx.lineCap = "round";

  // the distant range, pale in the cold air, then the main range in front of it
  fillBelow(ctx, L, L.far, h, vgrad(ctx, hz - F * 0.22, hz, ["#c8cae2", "#aab2d8"]));
  yield* paintRange(b, L, L.far, hz, SNOW.far, SNOW.farLit, 0.5, 0.5, L.near);
  fillBelow(ctx, L, L.near, h, vgrad(ctx, L.landTop, hz, ["#e6e4ee", "#b4bcdc"]));
  yield* paintPeaks(b, L, seed);

  // the snowfield beyond the crest
  ctx.globalAlpha = 1;
  ctx.fillStyle = vgrad(ctx, hz, hz + F * 0.1, ["#dcdeee", "#e8e6f0"]);
  ctx.fillRect(0, hz, w, h - hz);
  const sf = Math.max(bu * 0.4, 1.9);
  const sField = hashInt(seed, 62);
  let farArea = 0;
  for (let x = 0; x < w; x += 4) farArea += Math.max(0, colAt(L.crest, x) + bu - hz) * 4;
  const nFar = Math.round((farArea / (sf * sf)) * 0.55);
  for (let i = 0; i < nFar; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const c = colAt(L.crest, x) + bu * 0.5;
    if (c <= hz) continue;
    const y = rng.range(hz, c);
    const fv = fbm(x / (F * 0.3), (y - hz) / (F * 0.02), sField, 0, 2) + rng.signed(0.2);
    const col = fv > 0.15 ? rng.pick(SNOW.lit) : fv > -0.2 ? rng.pick(SNOW.half) : rng.pick(SNOW.shade);
    centred(b, x, y, rng.signed(0.1), sf * rng.range(1.6, 3.2), sf * rng.range(0.45, 0.8), 0, col, 0.75, 0.3);
  }
  // a dark band of forest along the foot of the range
  const sLine = hashInt(seed, 61);
  let tx = -2;
  for (let i = 0; tx < w + 2; i++) {
    const r = F * rng.range(0.012, 0.022);
    if (fbm(tx / (F * 0.25), 0.7, sLine, 0, 2) > -0.25) {
      centred(
        b,
        tx,
        hz - r * 0.9 + F * 0.004,
        -HALF_PI + rng.signed(0.06),
        r * 2,
        r * 0.7,
        0,
        rng.pick(SNOW.forest),
        0.92,
        0.3,
      );
      if (rng.chance(0.5))
        centred(
          b,
          tx - r * 0.15,
          hz - r * 1.2,
          rng.signed(0.4),
          r * 0.6,
          r * 0.3,
          0,
          rng.pick(SNOW.half),
          0.7,
          0,
        );
    }
    tx += r * rng.range(0.6, 1.2);
    if ((i & 15) === 15) yield;
  }

  // the near snowfield: strokes follow the swell of the drifts, warm white in the sun, blue in shade
  fillBelow(ctx, L, L.crest, h, vgrad(ctx, L.crestMin, h, ["#f2eee8", "#e4e2ee", "#d2d6ec"]));
  const yAt = (x: number, d: number) => {
    const c = colAt(L.crest, x);
    return c + d * (h - c);
  };
  const meadowArea = w * L.meadowH;
  const bands = 12;
  for (let band = 0; band < bands; band++) {
    const k = Math.max(1.5 * persp((band + 0.5) / bands), 0.6);
    const count = Math.round(meadowArea / bands / (bu * bu * k * k * 1.3));
    for (let i = 0; i < count; i++) {
      if ((i & 31) === 31) yield;
      const x = rng.next() * w;
      const d = (band + rng.next()) / bands;
      const y = yAt(x, d) + (d > 0.96 ? bu * 0.6 : 0);
      const sc = Math.max(1.5 * persp(d), 1.2 / bu);
      const l = M.light(x, y) + rng.signed(0.25);
      const col =
        l > 0.22
          ? rng.pick(SNOW.lit)
          : l > -0.1
            ? rng.pick(SNOW.half)
            : rng.chance(0.25)
              ? rng.pick(SNOW.deep)
              : rng.pick(SNOW.shade);
      centred(
        b,
        x,
        y,
        rng.signed(0.16) + 0.08 * Math.sin(x / (F * 0.3) + d * 5),
        bu * rng.range(1.8, 3.6) * sc,
        bu * rng.range(0.45, 0.8) * sc,
        rng.signed(0.08),
        col,
        rng.range(0.6, 0.9),
        0.5,
      );
    }
  }
  castShadows(b, L, "pine", SNOW.shade, 1.1);
  yield;
  // wind-carved ridges along the drifts, a blue line under a lit lip
  const nRidges = 4 + rng.int(3);
  for (let k = 0; k < nRidges; k++) {
    const d = rng.range(0.15, 0.9);
    const sc = Math.max(1.5 * persp(d), 1.2 / bu);
    const x0 = rng.next() * w;
    const len = w * rng.range(0.2, 0.45);
    const ph = rng.next() * TAU;
    for (let x = x0; x < x0 + len; x += bu * sc * 1.4) {
      const y = yAt(x, d) + Math.sin(x / (F * 0.22) + ph) * F * 0.012 * persp(d);
      centred(
        b,
        x,
        y,
        rng.signed(0.1),
        bu * sc * 2,
        Math.max(0.7, bu * sc * 0.25),
        0,
        rng.pick(SNOW.shade),
        0.75,
        0,
      );
      centred(
        b,
        x,
        y - bu * sc * 0.3,
        rng.signed(0.1),
        bu * sc * 1.6,
        Math.max(0.7, bu * sc * 0.25),
        0,
        rng.pick(SNOW.lit),
        0.8,
        0,
      );
    }
  }
  // sparkle where the sun strikes, and dry grass poking through
  const sStraw = hashInt(seed, 63);
  const nDots = Math.round(meadowArea / (bu * bu * 7));
  for (let i = 0; i < nDots; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const d = rng.next();
    const y = yAt(x, d);
    const sc = Math.max(1.5 * persp(d), 1.2 / bu);
    if (fbm(M.gx(x, d) * 2, (1 / persp(d)) * 2, sStraw, 0, 2) > 0.42 && rng.chance(0.5)) {
      centred(
        b,
        x,
        y - bu * sc * 0.6,
        -HALF_PI + rng.range(0.1, 0.6),
        bu * sc * rng.range(1, 2),
        Math.max(0.6, bu * sc * 0.14),
        0.05,
        rng.pick(SNOW.straw),
        0.85,
        0,
      );
    } else if (M.light(x, y) > 0.15) {
      b.dab(x, y, Math.max(0.5, bu * 0.12 * sc), 0, SNOW.lit[rng.chance(0.5) ? 1 : 4], 0.9);
    }
  }
  // the crest
  const sc0 = Math.max(1.5 * persp(0), 1.1 / bu);
  const nCrest = Math.round(w / (bu * sc0 * 0.8));
  for (let i = 0; i < nCrest; i++) {
    const x = rng.next() * w;
    centred(
      b,
      x,
      colAt(L.crest, x) + rng.signed(bu * sc0 * 0.4),
      rng.signed(0.3),
      bu * rng.range(1.2, 2.2) * sc0,
      bu * rng.range(0.35, 0.6) * sc0,
      0,
      rng.chance(0.6) ? rng.pick(SNOW.lit) : rng.pick(SNOW.half),
      0.85,
      0.3,
    );
  }
}

/** The desert's nearer buttes: warm front faces banded with strata, violet shade on the far side. */
function* paintButtes(b: Brush, L: Layout, seed: number): Gen {
  const { rng } = b;
  const { w, bu, F, hz, near } = L;
  const s = Math.max(bu * 0.5, 2);
  const sStrata = hashInt(seed, 19);
  let area = 0;
  for (let x = 0; x < w; x += 4) area += Math.max(0, hz - colAt(near, x)) * 4;
  const count = Math.round((area / (s * s)) * 1);
  for (let i = 0; i < count; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const top = colAt(near, x);
    if (top >= hz - 1) continue;
    const y = rng.range(top + s * 0.2, hz + s);
    const v = (y - top) / (hz - top);
    const slope = (colAt(near, x + 5) - colAt(near, x - 5)) / 10;
    const strata = Math.sin(y / (F * 0.014) + 2 * fbm(x / (F * 0.2), y / (F * 0.05), sStrata, 0, 2));
    // across the butte: its left side turned to the sun, its right side turning away into shade
    let across = 0;
    let nearest = Infinity;
    for (let k = 0; k < L.buttes.length; k += 3) {
      const u = (x - L.buttes[k]) / L.buttes[k + 1];
      if (Math.abs(u) < nearest) {
        nearest = Math.abs(u);
        across = u;
      }
    }
    const gully = fbm(x / (F * 0.012), 0.3, sStrata + 1, 0, 2) < -0.25 ? -0.5 : 0;
    const sun =
      -slope * 3 - across * 0.9 + strata * 0.3 + gully - smoothstep(0.7, 1, v) * 0.8 + rng.signed(0.25);
    const col =
      sun > 0.45
        ? rng.pick(DESERT.mesaLit)
        : sun > -0.35
          ? rng.pick(DESERT.mesa)
          : rng.pick(DESERT.mesaShade);
    const vertical = Math.abs(slope) > 0.6 || rng.chance(0.35);
    centred(
      b,
      x,
      y,
      vertical ? HALF_PI + rng.signed(0.2) : rng.signed(0.12),
      s * rng.range(1.5, 2.8),
      s * rng.range(0.5, 0.9),
      rng.signed(0.1),
      col,
      rng.range(0.7, 0.92),
      0.5,
    );
  }
}

function* paintDesertLand(ctx: Ctx, L: Layout, M: Meadow, seed: number): Gen {
  const rng = new Rng(hashInt(seed, 202));
  const b = new Brush(ctx, rng);
  const { w, h, bu, F, hz, dpr } = L;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  b.scale = dpr;
  ctx.lineCap = "round";

  // distant mesas, violet in the haze, then the nearer buttes
  fillBelow(ctx, L, L.far, h, vgrad(ctx, L.landTop, hz, ["#d6c0cc", "#c2aac6"]));
  yield* paintRange(b, L, L.far, hz, DESERT.far, DESERT.farLit, 0.5, 0.5, L.near);
  fillBelow(ctx, L, L.near, h, vgrad(ctx, L.landTop, hz, ["#d29a76", "#b88070"]));
  yield* paintButtes(b, L, seed);

  // the plain beyond the dunes: pale sand dotted with scrub
  ctx.globalAlpha = 1;
  ctx.fillStyle = vgrad(ctx, hz, hz + F * 0.1, ["#e2caa6", "#dcbc94"]);
  ctx.fillRect(0, hz, w, h - hz);
  const sf = Math.max(bu * 0.4, 1.9);
  let farArea = 0;
  for (let x = 0; x < w; x += 4) farArea += Math.max(0, colAt(L.crest, x) + bu - hz) * 4;
  const nFar = Math.round((farArea / (sf * sf)) * 0.55);
  for (let i = 0; i < nFar; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const c = colAt(L.crest, x) + bu * 0.5;
    if (c <= hz) continue;
    const y = rng.range(hz, c);
    if (rng.chance(0.12)) {
      b.dab(x, y, sf * rng.range(0.4, 0.7), 0, rng.pick(DESERT.sage), 0.85);
      continue;
    }
    const col = rng.chance(0.2) ? rng.pick(DESERT.far) : rng.pick(DESERT.plain);
    centred(b, x, y, rng.signed(0.1), sf * rng.range(1.6, 3.2), sf * rng.range(0.45, 0.8), 0, col, 0.75, 0.3);
  }
  yield;

  // the dunes: a violet shadow under each crest where the ridge turns away from the sun
  fillBelow(ctx, L, L.crest, h, vgrad(ctx, L.crestMin, h, ["#eebc86", "#e2a878", "#d89a72"]));
  const lines = [L.crest, ...L.dunes];
  /**
   * Light on the dunes: the wind blows from the left, so each crest's steep slip face hangs to the
   * right of its high point, a crescent of violet shadow with the sun low on the left.
   */
  const duneAt = (x: number, y: number) => {
    let j = 0;
    while (j + 1 < lines.length && y >= colAt(lines[j + 1], x)) j++;
    const top = colAt(lines[j], x);
    const bottom = j + 1 < lines.length ? colAt(lines[j + 1], x) : h + (h - top) * 0.5;
    const v = (y - top) / Math.max(1, bottom - top);
    const below = y - top;
    const theta = (x - below * 0.9) * L.waves[j * 2] + L.waves[j * 2 + 1] + HALF_PI;
    const turn = ((theta % TAU) + TAU) % TAU;
    const lee = smoothstep(0, 0.25, turn) * smoothstep(2.1, 1.6, turn) * smoothstep(0.85, 0.35, v);
    if (lee > 0.5) return -1 + v * 0.6;
    // the windward slopes brighten towards the next crest
    return 0.15 + v * 0.75 - lee;
  };
  const yAt = (x: number, d: number) => {
    const c = colAt(L.crest, x);
    return c + d * (h - c);
  };
  const meadowArea = w * L.meadowH;
  const bands = 12;
  for (let band = 0; band < bands; band++) {
    const k = Math.max(1.5 * persp((band + 0.5) / bands), 0.6);
    const count = Math.round(meadowArea / bands / (bu * bu * k * k * 1.3));
    for (let i = 0; i < count; i++) {
      if ((i & 31) === 31) yield;
      const x = rng.next() * w;
      const d = (band + rng.next()) / bands;
      const y = yAt(x, d) + (d > 0.96 ? bu * 0.6 : 0);
      const sc = Math.max(1.5 * persp(d), 1.2 / bu);
      const sun = duneAt(x, y) + rng.signed(0.12);
      let line = L.crest;
      for (const dl of L.dunes) if (y >= colAt(dl, x)) line = dl;
      const curve = Math.atan((colAt(line, x + 4) - colAt(line, x - 4)) / 8);
      const col =
        sun < -0.6
          ? rng.pick(DESERT.deep)
          : sun < 0
            ? rng.pick(DESERT.shadow)
            : sun < 0.35
              ? rng.pick(DESERT.sandMid)
              : sun < 0.75
                ? rng.pick(DESERT.sand)
                : rng.pick(DESERT.sandLit);
      centred(
        b,
        x,
        y,
        curve * 0.8 + rng.signed(0.12),
        bu * rng.range(1.8, 3.4) * sc,
        bu * rng.range(0.45, 0.8) * sc,
        rng.signed(0.08),
        col,
        rng.range(0.65, 0.9),
        0.5,
      );
    }
  }
  castShadows(b, L, "shrub", DESERT.shadow, 1.4);
  yield;
  // wind ripples on the sunlit slopes, then a bright lip along each crest
  const nRipples = Math.round(meadowArea / (bu * bu * 6));
  for (let i = 0; i < nRipples; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const d = rng.range(0.25, 1);
    const y = yAt(x, d);
    if (duneAt(x, y) < 0.2) continue;
    const sc = Math.max(1.5 * persp(d), 1.2 / bu);
    centred(
      b,
      x,
      y,
      rng.signed(0.12),
      bu * sc * rng.range(2, 3.4),
      Math.max(0.6, bu * sc * 0.16),
      rng.signed(0.2),
      rng.pick(DESERT.sandMid),
      0.7,
      0,
    );
  }
  // each crest a sharp line: a bright lip with the shadow tucked under it
  for (const line of lines) {
    for (let x = rng.range(0, bu); x < w; x += bu * rng.range(0.7, 1.2)) {
      const y = colAt(line, x);
      const d = M.depth(x, y);
      const sc = Math.max(1.5 * persp(d), 1.2 / bu);
      const slope = (colAt(line, x + 3) - colAt(line, x - 3)) / 6;
      const wid = Math.max(0.6, bu * sc * 0.26);
      const shade = duneAt(x, y + wid * 2) < 0;
      centred(
        b,
        x,
        y - wid * 0.3,
        Math.atan(slope),
        bu * sc * rng.range(1.4, 2.4),
        wid,
        0,
        rng.pick(DESERT.sandLit),
        0.9,
        0,
      );
      if (shade) {
        centred(
          b,
          x,
          y + wid * 0.8,
          Math.atan(slope),
          bu * sc * rng.range(1.4, 2.4),
          wid,
          0,
          rng.pick(DESERT.deep),
          0.8,
          0,
        );
      }
    }
    yield;
  }
}

function* paintLand(ctx: Ctx, L: Layout, M: Meadow, seed: number): Gen {
  if (L.biome === "snow") yield* paintSnowLand(ctx, L, M, seed);
  else if (L.biome === "desert") yield* paintDesertLand(ctx, L, M, seed);
  else yield* paintMeadowLand(ctx, L, M, seed);
}

/* ------------------------------------------------------------------ trees */

/** A tree's place in the sprite sheet (device px) and its anchor: the foot of the trunk. */
interface Sprite {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  ax: number;
  ay: number;
}

interface Sheet {
  width: number;
  height: number;
  /** One per tree, in the order of Layout.trees. */
  trees: Sprite[];
}

function spriteSheet(L: Layout): Sheet {
  const d = L.dpr;
  const maxW = 1024;
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 1;
  const place = (wCss: number, hCss: number, axCss: number, ayCss: number): Sprite => {
    const sw = Math.ceil(wCss * d);
    const sh = Math.ceil(hCss * d);
    if (x > 0 && x + sw > maxW) {
      x = 0;
      y += rowH + 2;
      rowH = 0;
    }
    const s = { sx: x, sy: y, sw, sh, ax: Math.round(axCss * d), ay: Math.round(ayCss * d) };
    x += sw + 2;
    rowH = Math.max(rowH, sh);
    width = Math.max(width, x);
    return s;
  };
  // room around each tree for its crown (and, for a shrub, its shadow on the right)
  const reach: Record<TreeKind, [number, number]> = {
    poplar: [0.8, 1.4],
    oak: [0.75, 1.3],
    pine: [0.62, 0.66],
    shrub: [0.6, 1.5],
  };
  const trees = L.trees.map((t) => {
    const left = t.wd * reach[t.kind][0] + 3;
    const right = t.wd * reach[t.kind][1] + 3;
    const tall = t.ht * 1.08 + 6;
    return place(left + right, tall, left, tall - 3);
  });
  return { width, height: y + rowH, trees };
}

function paintPoplar(b: Brush, t: Tree): void {
  const { rng } = b;
  const H = t.ht;
  const W = t.wd;
  const half = (s: number) => W * 0.5 * Math.pow(1 - s, 0.8) * smoothstep(0.02, 0.26, s) + W * 0.04;
  // its shadow on the field, falling to the right
  centred(b, W * 0.9, -W * 0.05, 0.03, W * 1.8, Math.max(0.8, W * 0.2), 0, rng.pick(POPLAR_DARK), 0.45, 0);
  b.stroke(0, 0, -HALF_PI, H * 0.2, Math.max(0.7, W * 0.1), 0, TRUNK, 0.9, 0);
  const n = Math.round(clamp((H * W) / 5, 24, 150));
  // shadowed body first, then the sunlit left flank
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < (pass === 0 ? n : n * 0.5); i++) {
      const s = rng.range(0.07, 0.97);
      const u = pass === 0 ? rng.signed(1) : rng.range(-1, 0.25);
      const lit = 0.5 - u * 0.6 + rng.signed(0.3) + (s - 0.5) * 0.15;
      let col: Lab;
      if (pass === 0) {
        col =
          lit > 0.45 ? rng.pick(POPLAR_MID) : rng.chance(0.2) ? rng.pick(POPLAR_COOL) : rng.pick(POPLAR_DARK);
      } else if (lit > 0.6) col = rng.pick(POPLAR_LIT);
      else continue;
      centred(
        b,
        u * half(s),
        -s * H,
        -HALF_PI + rng.signed(0.3) + u * 0.25,
        H * rng.range(0.07, 0.13),
        Math.max(0.7, W * rng.range(0.2, 0.34)),
        rng.signed(0.15),
        col,
        rng.range(0.82, 0.96),
        0.6,
      );
    }
  }
  centred(
    b,
    0,
    -H * 0.94,
    -HALF_PI + rng.signed(0.1),
    H * 0.1,
    Math.max(0.6, W * 0.16),
    0,
    POPLAR_MID[0],
    0.9,
    0,
  );
}

function paintOak(b: Brush, t: Tree): void {
  const { rng } = b;
  const H = t.ht;
  const W = t.wd;
  for (let k = 0; k < 3; k++) {
    centred(
      b,
      W * rng.range(0.25, 0.6),
      rng.signed(H * 0.02),
      rng.signed(0.05),
      W * rng.range(0.6, 0.9),
      Math.max(0.8, H * 0.07),
      0,
      rng.pick(GRASS.deep),
      0.5,
      0,
    );
  }
  b.stroke(0, 0, -HALF_PI + 0.05, H * 0.45, Math.max(0.9, W * 0.08), 0, TRUNK, 0.95, 0);
  const cy = -H * 0.6;
  const rx = W * 0.5;
  const ry = H * 0.38;
  const n = Math.round(clamp((W * H) / 4, 30, 180));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < (pass === 0 ? n : n * 0.6); i++) {
      const a = rng.next() * TAU;
      const rr = Math.sqrt(rng.next());
      const x = Math.cos(a) * rr * rx;
      const y = cy + Math.sin(a) * rr * ry;
      const lit = 0.5 - (x / rx) * 0.45 - ((y - cy) / ry) * 0.45 + rng.signed(0.25);
      let col: Lab;
      if (pass === 0) {
        col =
          lit < 0.35
            ? rng.pick(POPLAR_DARK)
            : rng.chance(0.15)
              ? rng.pick(POPLAR_COOL)
              : rng.pick(POPLAR_MID);
      } else if (lit > 0.55) col = rng.pick(POPLAR_LIT);
      else continue;
      centred(
        b,
        x,
        y,
        rng.signed(Math.PI),
        W * rng.range(0.12, 0.2),
        Math.max(0.7, W * rng.range(0.1, 0.16)),
        rng.signed(0.2),
        col,
        rng.range(0.82, 0.96),
        0.5,
      );
    }
  }
}

/** A dark spruce: drooping boughs in tiers, sunlit on the left, with snow along their upper sides. */
function paintPine(b: Brush, t: Tree): void {
  const { rng } = b;
  const H = t.ht;
  const W = t.wd;
  b.stroke(0, 0, -HALF_PI, H * 0.14, Math.max(0.8, W * 0.08), 0, TRUNK, 0.95, 0);
  // a dark body first, so the boughs read as one mass
  const half = (s: number) => W * 0.5 * Math.pow(1 - s, 0.85) + W * 0.03;
  for (let i = 0; i < 10; i++) {
    const s = 0.08 + i * 0.09;
    centred(
      b,
      rng.signed(W * 0.04),
      -s * H,
      -HALF_PI,
      H * 0.12,
      half(s) * 1.1,
      0,
      rng.pick(PINE_DARK),
      0.9,
      0.3,
    );
  }
  // then boughs at irregular heights, drooping, longer low down
  const n = Math.round(clamp(H / 2.2, 18, 60));
  for (let i = 0; i < n; i++) {
    const s = 0.08 + Math.pow(rng.next(), 0.8) * 0.86;
    const side = rng.chance(0.5) ? -1 : 1;
    const len = half(s) * rng.range(0.6, 1.1);
    const thick = Math.max(0.9, H * rng.range(0.03, 0.05));
    const ang = side < 0 ? Math.PI - rng.range(0.2, 0.55) : rng.range(0.2, 0.55);
    const y0 = -s * H;
    const bough = side < 0 ? rng.pick(rng.chance(0.45) ? PINE_LIT : PINE_MID) : rng.pick(PINE_DARK);
    b.stroke(
      side * len * 0.1,
      y0,
      ang,
      len,
      thick,
      side * rng.range(0.02, 0.1),
      bough,
      rng.range(0.85, 0.97),
      0.5,
    );
    // snow lies along the upper side of some boughs, warm where the sun reaches it
    if (rng.chance(0.55)) {
      const snow = side < 0 ? rng.pick(PINE_SNOW) : rng.pick(PINE_SNOW_SHADE);
      b.stroke(
        side * len * 0.2,
        y0 - thick * 0.5,
        ang,
        len * rng.range(0.4, 0.75),
        thick * 0.55,
        0,
        snow,
        rng.range(0.8, 0.95),
        0.3,
      );
    }
  }
  centred(b, 0, -H * 0.95, -HALF_PI, H * 0.12, Math.max(0.7, W * 0.07), 0, PINE_DARK[0], 0.95, 0);
}

/** A low desert shrub: grey-green twigs lit from the left, with its violet shadow on the sand. */
function paintShrub(b: Brush, t: Tree): void {
  const { rng } = b;
  const H = t.ht;
  const W = t.wd;
  for (let k = 0; k < 3; k++) {
    centred(
      b,
      W * rng.range(0.35, 0.7),
      rng.signed(H * 0.04),
      rng.signed(0.05),
      W * rng.range(0.6, 0.9),
      Math.max(0.8, H * 0.22),
      0,
      rng.pick(DESERT.shadow),
      0.55,
      0,
    );
  }
  const n = Math.round(clamp((W * H) / 3, 14, 90));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < (pass === 0 ? n : n * 0.5); i++) {
      const a = rng.next() * TAU;
      const rr = Math.sqrt(rng.next());
      const x = Math.cos(a) * rr * W * 0.5;
      const y = -H * 0.45 + Math.sin(a) * rr * H * 0.45;
      const lit = 0.5 - (x / (W * 0.5)) * 0.45 - ((y + H * 0.45) / (H * 0.45)) * 0.45 + rng.signed(0.25);
      let col: Lab;
      if (pass === 0) col = lit < 0.35 ? rng.pick(SHRUB_SHADE) : rng.pick(SHRUB);
      else if (lit > 0.55) col = rng.pick(SHRUB_LIT);
      else continue;
      centred(
        b,
        x,
        y,
        -HALF_PI + rng.signed(1),
        H * rng.range(0.25, 0.45),
        Math.max(0.6, H * rng.range(0.1, 0.16)),
        rng.signed(0.2),
        col,
        rng.range(0.82, 0.96),
        0.4,
      );
    }
  }
}

const PAINT_TREE: Record<TreeKind, (b: Brush, t: Tree) => void> = {
  poplar: paintPoplar,
  oak: paintOak,
  pine: paintPine,
  shrub: paintShrub,
};

function* paintSheet(ctx: Ctx, L: Layout, sheet: Sheet, seed: number): Gen {
  const rng = new Rng(hashInt(seed, 505));
  const b = new Brush(ctx, rng);
  b.scale = L.dpr;
  ctx.lineCap = "round";
  const at = (s: Sprite, paint: () => void) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(s.sx, s.sy, s.sw, s.sh);
    ctx.clip();
    ctx.setTransform(L.dpr, 0, 0, L.dpr, s.sx + s.ax, s.sy + s.ay);
    paint();
    ctx.restore();
  };
  for (let i = 0; i < L.trees.length; i++) {
    const t = L.trees[i];
    at(sheet.trees[i], () => PAINT_TREE[t.kind](b, t));
    yield;
  }
}

/* ------------------------------------------------------------------ grain */

/**
 * A seamless tile of canvas weave and grain (device px). It is laid over the whole scene with CSS,
 * so it costs nothing per frame and needs no full-size canvas.
 */
function grainTile(dpr: number, seed: number): { tile: HTMLCanvasElement; cssSize: number } | null {
  const size = 192;
  const threads = Math.max(8, Math.round(size / (2.3 * dpr)));
  const period = size / threads;
  const tile = makeCanvas(size, size);
  const tctx = tile.getContext("2d");
  if (!tctx) return null;
  const rng = new Rng(hashInt(seed, 404));
  const rowJ = new Float32Array(threads);
  const colJ = new Float32Array(threads);
  for (let i = 0; i < threads; i++) {
    rowJ[i] = rng.range(0.55, 1);
    colJ[i] = rng.range(0.55, 1);
  }
  // thread profiles and a soft, low-frequency mottling (sampled on a coarse grid)
  const profile = new Float32Array(size);
  for (let i = 0; i < size; i++) profile[i] = 0.5 + 0.5 * Math.cos(((i % period) / period) * TAU);
  const cells = size / 4;
  const low = new Float32Array(cells * cells);
  const nSeed = hashInt(seed, 405);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) low[j * cells + i] = noise2((i / cells) * 6, (j / cells) * 6, nSeed, 6);
  }
  const img = tctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    const cy = Math.floor(y / period);
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / period);
      const weave = (cx + cy) & 1 ? profile[y] * rowJ[cy] : profile[x] * colJ[cx];
      const v = (weave - 0.45) * 0.9 + rng.signed(0.35) + low[(y >> 2) * cells + (x >> 2)] * 0.25;
      const o = (y * size + x) * 4;
      if (v > 0) {
        data[o] = 255;
        data[o + 1] = 249;
        data[o + 2] = 232;
        data[o + 3] = Math.min(255, v * 0.085 * 255);
      } else {
        data[o] = 46;
        data[o + 1] = 38;
        data[o + 2] = 28;
        data[o + 3] = Math.min(255, -v * 0.11 * 255);
      }
    }
  }
  tctx.putImageData(img, 0, 0);
  return { tile, cssSize: size / dpr };
}

/* ------------------------------------------------------------------ motion */

/**
 * Wind strength (about 0 in a lull, 1 in a gust) at ground position gx (across) and gz (away from
 * the viewer) at time t (s). Gust fronts travel left → right, slanted by depth, each one stronger
 * or weaker as a slower swell of wind passes.
 */
function gustAt(gx: number, gz: number, t: number): number {
  let a = 0.5 + 0.5 * Math.sin(gx * 3.6 + gz * 1.1 - t * 0.85);
  a *= a * a;
  a *= a;
  let b = 0.5 + 0.5 * Math.sin(gx * 1.3 - gz * 0.5 - t * 0.41 + 1.9);
  b *= b;
  return a * (0.5 + 0.7 * b) + 0.2 * b;
}

/** A canvas covering only the part of the scene that moves (CSS px). */
interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Group {
  color: string;
  alpha: number;
  start: number;
  end: number;
}

/** Depth slices of the meadow, drawn far to near so nearer grass covers what is behind it. */
const SLICES = 3;
const MAX_TUFTS = 420;
const MAX_STEMS = 90;

/** Plants that move: tufts of grass blades, or flower stems with their heads. */
interface Plants {
  n: number;
  x: Float32Array;
  y: Float32Array;
  len: Float32Array;
  hw: Float32Array;
  lean: Float32Array;
  give: Float32Array;
  phase: Float32Array;
  wob: Float32Array;
  gx: Float32Array;
  gz: Float32Array;
  leanC: Float32Array;
  leanS: Float32Array;
  /** Per frame: the wind on each, the angle of its tip and where the tip ended up. */
  gust: Float32Array;
  tipA: Float32Array;
  tipC: Float32Array;
  tipS: Float32Array;
  tipX: Float32Array;
  tipY: Float32Array;
}

interface Motion {
  /** Resolution of the meadow's pane (lower than the static layers': its strokes are soft). */
  dpr: number;
  pane: Pane;
  /** The trees' pane, at the static layers' resolution. */
  treeDpr: number;
  treePane: Pane;
  trees: Tree[];
  treeGx: Float32Array;
  treeGz: Float32Array;
  blades: Plants;
  /** Blade colour groups of each slice. */
  bladeGroups: Group[][];
  bladeEnd: number[];
  stems: Plants;
  stemEnd: number[];
  head: Float32Array;
  headColor: Int8Array;
  eyeColor: Int8Array;
  sheen: [string, number, number][];
  drift: Drift | null;
}

/** Snow or sand that the gusts lift and carry along the ground. */
interface Drift {
  w: number;
  F: number;
  x0: Float32Array;
  y0: Float32Array;
  d: Float32Array;
  speed: Float32Array;
  len: Float32Array;
  thick: Float32Array;
  phase: Float32Array;
  color: string;
  alpha: number;
  /** Share that drifts even in a lull, and how high a gust lifts it (× brush unit). */
  floor: number;
  lift: number;
}

/** Blade colours, darkest to lightest, then the cool and accent ones: [colour, alpha]. */
const BLADE_COLORS: [string, number][] = [
  ["#1e482e", 0.85],
  ["#2a5434", 0.85],
  ["#386836", 0.85],
  ["#4a7334", 0.85],
  ["#5d8034", 0.85],
  ["#6f8c32", 0.85],
  ["#82983a", 0.85],
  ["#99ac3e", 0.85],
  ["#aebc4c", 0.85],
  ["#c4c860", 0.82],
  ["#45705a", 0.8],
  ["#587a64", 0.8],
  ["#8a4a3a", 0.8],
  ["#6e5a8e", 0.75],
];
const STEM_COLOR = "#4c7a36";
const HEAD_COLORS: [string, number][] = [
  ["#ecd03a", 0.92],
  ["#f6e46a", 0.92],
  ["#f6f2e4", 0.92],
  ["#dcdae4", 0.88],
  ["#d8412a", 0.92],
  ["#ea5c36", 0.92],
  ["#6274c8", 0.88],
];
/** The hearts of daisies and poppies. */
const EYE_COLORS: [string, number][] = [
  ["#e6b828", 1],
  ["#3a1c20", 0.85],
];
/** Head radius for each flower kind, in brush units at the bottom edge. */
const HEAD_SIZE = [0, 0.32, 0.38, 0.5, 0.32];
/** The pale side of the grass that a gust turns up as it presses it down: [colour, alpha, from]. */
const SHEEN: [string, number, number][] = [
  ["#d8e29a", 0.6, 0.3],
  ["#eef0c4", 0.75, 0.52],
];

/** How each biome's plants look and how many there are. */
interface PlantLook {
  colors: [string, number][];
  /** Share of the meadow's number of tufts, and whether they grow in patches rather than all over. */
  amount: number;
  patchy: boolean;
  sheen: [string, number, number][];
}

const PLANT_LOOKS: Record<MeadowBiome, PlantLook> = {
  meadow: { colors: BLADE_COLORS, amount: 1, patchy: false, sheen: SHEEN },
  snow: {
    colors: [
      ["#6e6044", 0.85],
      ["#8a7854", 0.85],
      ["#a8925e", 0.85],
      ["#c4ae78", 0.85],
      ["#5c5a52", 0.8],
      ["#7a6a5e", 0.8],
    ],
    amount: 0.07,
    patchy: true,
    sheen: [["#efe6cc", 0.5, 0.45]],
  },
  desert: {
    colors: [
      ["#9c7e4c", 0.85],
      ["#b8985a", 0.85],
      ["#d0b070", 0.85],
      ["#e2c88a", 0.85],
      ["#8a8a64", 0.8],
      ["#a0a07a", 0.8],
    ],
    amount: 0.3,
    patchy: true,
    sheen: [
      ["#f0deb0", 0.5, 0.35],
      ["#faf0d2", 0.6, 0.6],
    ],
  },
};

/** A dry grass colour (snow and desert), lighter where the sun falls. */
function dryColor(rng: Rng, light: number): number {
  const r = rng.next();
  if (light > 0.2) return r < 0.6 ? 2 + rng.int(2) : 1 + rng.int(4) * (r < 0.8 ? 0 : 1);
  if (light > -0.15) return r < 0.6 ? 1 + rng.int(2) : 4 + rng.int(2);
  return r < 0.5 ? rng.int(2) : 4 + rng.int(2);
}

/** A blade colour that stands out against the painted grass around it. */
function bladeColor(rng: Rng, light: number): number {
  if (rng.chance(0.03)) return 12 + rng.int(2);
  const r = rng.next();
  // in sunlit grass: darker blades and bright ones; in a cloud's shadow: cool and deep ones
  if (light > 0.25) return r < 0.35 ? 2 + rng.int(3) : r < 0.7 ? 7 + rng.int(3) : 5 + rng.int(2);
  if (light > -0.12) return r < 0.4 ? 1 + rng.int(3) : r < 0.8 ? 5 + rng.int(3) : 8 + rng.int(2);
  return r < 0.35 ? rng.int(2) : r < 0.7 ? 10 + rng.int(2) : 3 + rng.int(3);
}

/** Sorts rows by depth into plant columns; returns them with the slice ends (row: d, x, y, …). */
function plants(rows: number[][], slice: (r: number[]) => number, key: (r: number[]) => number): Plants {
  rows.sort((a, b) => slice(a) - slice(b) || key(a) - key(b) || a[0] - b[0]);
  const n = rows.length;
  const col = (c: number) => Float32Array.from(rows, (r) => r[c]);
  return {
    n,
    x: col(1),
    y: col(2),
    len: col(3),
    hw: col(4),
    lean: col(5),
    give: col(6),
    phase: col(7),
    wob: col(8),
    gx: col(9),
    gz: col(10),
    leanC: Float32Array.from(rows, (r) => Math.cos(r[5])),
    leanS: Float32Array.from(rows, (r) => Math.sin(r[5])),
    gust: new Float32Array(n),
    tipA: new Float32Array(n),
    tipC: new Float32Array(n),
    tipS: new Float32Array(n),
    tipX: new Float32Array(n),
    tipY: new Float32Array(n),
  };
}

const sliceOf = (d: number) => Math.min(SLICES - 1, Math.floor(d * SLICES));

function sliceEnds(rows: number[][]): number[] {
  const ends: number[] = [];
  let i = 0;
  for (let k = 0; k < SLICES; k++) {
    while (i < rows.length && sliceOf(rows[i][0]) <= k) i++;
    ends.push(i);
  }
  return ends;
}

function buildMotion(L: Layout, M: Meadow, seed: number, sheet: Sheet): Motion {
  const rng = new Rng(hashInt(seed, 303));
  const { w, h, bu, F } = L;
  let top = h;

  // tufts all over the meadow, as many per px near as far, so the near ones (larger) dominate
  const bladeRows: number[][] = [];
  const look = PLANT_LOOKS[L.biome];
  const sPatch = hashInt(seed, 304);
  const cap = Math.min(MAX_TUFTS, Math.round(((w * L.meadowH) / (bu * bu * 3)) * look.amount));
  for (let tries = 0; bladeRows.length < cap && tries < cap * 6; tries++) {
    const x = rng.next() * w;
    const d = rng.range(0.1, 1);
    const p = persp(d);
    const c = colAt(L.crest, x);
    const y = c + d * (h - c) + bu * 0.3;
    if (M.path(x, y) > 0.5 && rng.chance(0.85)) continue;
    if (look.patchy && fbm(M.gx(x, d) * 1.8, (1 / p) * 1.6, sPatch, 0, 2) < 0.12) continue;
    const sc = 1.5 * p;
    const len = Math.max(3, bu * sc * rng.range(1.8, 4));
    const hw = Math.max(0.5, bu * sc * rng.range(0.09, 0.16));
    bladeRows.push([
      d,
      x,
      y,
      len,
      hw,
      rng.range(0.12, 0.5),
      rng.range(0.26, 0.44),
      rng.next() * TAU,
      rng.range(1.6, 2.6),
      M.gx(x, d),
      1 / p,
      (L.biome === "meadow" ? bladeColor(rng, M.light(x, y)) : dryColor(rng, M.light(x, y))) * 2 +
        (rng.chance(0.35) ? 1 : 0),
    ]);
    top = Math.min(top, y - len - hw);
  }
  const blades = plants(
    bladeRows,
    (r) => sliceOf(r[0]),
    (r) => r[11],
  );
  const bladeEnd = sliceEnds(bladeRows);
  // two strengths of each colour: some blades are thin glazes over the painted grass
  const palette = look.colors.flatMap(([c, a]): [string, number][] => [
    [c, a],
    [c, a * 0.55],
  ]);
  const bladeGroups: Group[][] = [];
  let start = 0;
  for (let k = 0; k < SLICES; k++) {
    const groups: Group[] = [];
    for (let i = start; i < bladeEnd[k]; i++) {
      const key = bladeRows[i][11];
      const last = groups[groups.length - 1];
      if (last && bladeRows[last.start][11] === key) last.end = i + 1;
      else groups.push({ color: palette[key][0], alpha: palette[key][1], start: i, end: i + 1 });
    }
    bladeGroups.push(groups);
    start = bladeEnd[k];
  }

  // flowers on their own stems, nodding above the grass
  const stemRows: number[][] = [];
  for (let tries = 0; stemRows.length < MAX_STEMS && tries < MAX_STEMS * 40; tries++) {
    const x = rng.next() * w;
    const d = Math.sqrt(rng.next());
    const p = persp(d);
    if (bu * 1.5 * p < 3) continue;
    const c = colAt(L.crest, x);
    const y = c + d * (h - c) + bu * 0.3;
    const kind = M.flower(x, y, rng.next());
    if (kind === FLOWER_NONE || M.path(x, y) > 0.5) continue;
    const sc = 1.5 * p;
    const len = bu * sc * rng.range(2.6, 4.2);
    const r = Math.max(1, bu * sc * HEAD_SIZE[kind] * rng.range(0.8, 1.2));
    const head =
      kind === FLOWER_BUTTERCUP
        ? rng.int(2)
        : kind === FLOWER_DAISY
          ? 2 + rng.int(2)
          : kind === FLOWER_POPPY
            ? 4 + rng.int(2)
            : 6;
    const eye = r > 1.8 && kind === FLOWER_DAISY ? 0 : r > 1.8 && kind === FLOWER_POPPY ? 1 : -1;
    stemRows.push([
      d,
      x,
      y,
      len,
      Math.max(0.5, bu * sc * 0.07),
      rng.range(0.1, 0.4),
      rng.range(0.3, 0.5),
      rng.next() * TAU,
      rng.range(1.6, 2.6),
      M.gx(x, d),
      1 / p,
      r,
      head,
      eye,
    ]);
    top = Math.min(top, y - len - r * 2);
  }
  const stems = plants(
    stemRows,
    (r) => sliceOf(r[0]),
    () => 0,
  );

  // snow or sand lifted by the gusts, low over the ground (or off the dune crests)
  let drift: Drift | null = null;
  if (L.biome !== "meadow") {
    const snow = L.biome === "snow";
    const n = Math.round(clamp((w * L.meadowH) / (snow ? 160 : 200), 24, 140));
    const rows: number[][] = [];
    for (let i = 0; i < n; i++) {
      const x = rng.next() * w;
      const d = rng.range(0.03, 1);
      const pd = persp(d);
      let y = colAt(L.crest, x) + d * (h - colAt(L.crest, x));
      if (!snow && L.dunes.length && rng.chance(0.6)) y = colAt(L.dunes[rng.int(L.dunes.length)], x);
      y -= rng.next() * bu * pd * (snow ? 3 : 1);
      rows.push([
        x,
        y,
        d,
        F * pd * rng.range(0.22, 0.4),
        bu * pd * rng.range(snow ? 0.6 : 1.6, snow ? 1.8 : 4),
        Math.max(0.6, bu * pd * (snow ? rng.range(0.18, 0.3) : rng.range(0.1, 0.16))),
        rng.next() * TAU,
      ]);
      top = Math.min(top, y - bu * 3);
    }
    const c = (k: number) => Float32Array.from(rows, (r) => r[k]);
    drift = {
      w,
      F,
      x0: c(0),
      y0: c(1),
      d: c(2),
      speed: c(3),
      len: c(4),
      thick: c(5),
      phase: c(6),
      color: snow ? "#f6f6fb" : "#f3dcb2",
      alpha: snow ? 0.9 : 0.6,
      floor: snow ? 0.12 : 0,
      lift: snow ? 1.6 : 0.8,
    };
  }

  // the trees' own pane covers them at their furthest lean
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  L.trees.forEach((t, i) => {
    const s = sheet.trees[i];
    const d = L.dpr;
    x0 = Math.min(x0, t.x - s.ax / d);
    x1 = Math.max(x1, t.x + (s.sw - s.ax) / d + (t.lean + t.give * 0.06) * (s.ay / d));
    y0 = Math.min(y0, t.y - s.ay / d);
    y1 = Math.max(y1, t.y + (s.sh - s.ay) / d);
  });
  // (only the part inside the scene)
  x0 = Math.max(x0, -2);
  x1 = Math.min(x1, w + 2);
  y0 = Math.max(y0, -2);
  y1 = Math.min(y1, h + 2);
  const treePane =
    L.trees.length && x1 > x0
      ? { x: Math.floor(x0) - 1, y: Math.floor(y0) - 1, w: Math.ceil(x1 - x0) + 3, h: Math.ceil(y1 - y0) + 3 }
      : { x: 0, y: 0, w: 1, h: 1 };
  // trees standing in the foreground feel the gusts there; far ones, out on the horizon
  const treeDepth = (t: Tree) => (t.y > colAt(L.crest, t.x) ? M.depth(t.x, t.y) : -0.04);
  const paneTop = Math.max(0, Math.floor(top - 2));
  return {
    dpr: Math.min(L.dpr, MOTION_DPR),
    pane: { x: 0, y: paneTop, w, h: h - paneTop },
    treeDpr: L.dpr,
    treePane,
    trees: L.trees,
    treeGx: Float32Array.from(L.trees, (t) => (t.x - w / 2) / (F * persp(treeDepth(t)))),
    treeGz: Float32Array.from(L.trees, (t) => 1 / persp(treeDepth(t))),
    blades,
    bladeGroups,
    bladeEnd,
    stems,
    stemEnd: sliceEnds(stemRows),
    head: Float32Array.from(stemRows, (r) => r[11]),
    headColor: Int8Array.from(stemRows, (r) => r[12]),
    eyeColor: Int8Array.from(stemRows, (r) => r[13]),
    sheen: look.sheen,
    drift,
  };
}

/**
 * Blades of a tuft, relative to its first: [foot offset (× half width), length, angle offset]. They
 * run nearly parallel, like the bristles of one loaded brush parting at the end of a stroke.
 */
const TUFT_FORMS = [
  [0, 1, 0],
  [0, 1, 0, 1.9, 0.82, 0.05],
  [0, 1, 0],
  [0, 1, 0, -1.8, 0.7, -0.04],
].map((form) => {
  // stored as [foot offset, length, cos, sin] so a frame needs no trigonometry per blade
  const out: number[] = [];
  for (let j = 0; j < form.length; j += 3)
    out.push(form[j], form[j + 1], Math.cos(form[j + 2]), Math.sin(form[j + 2]));
  return out;
});
const SINGLE = [0, 1, 1, 0];

/** Bends plants i0…i1 for time t: the gusts press them further downwind as they pass. */
function bend(p: Plants, i0: number, i1: number, t: number, push: number): void {
  for (let i = i0; i < i1; i++) {
    const g = gustAt(p.gx[i], p.gz[i], t);
    p.gust[i] = g;
    const sway = Math.sin(t * p.wob[i] + p.phase[i]);
    const a = p.lean[i] + p.give[i] * (0.3 + push * g + 0.25 * sway * (0.4 + g));
    p.tipA[i] = a;
    p.tipC[i] = Math.cos(a);
    p.tipS[i] = Math.sin(a);
  }
}

/**
 * Adds plant i's blades to the current path: each bends from its foot, which keeps the lean of the
 * root, to its tip, which follows the wind. With `sheen`, only the pale upper half of each blade.
 */
function plantPath(ctx: Ctx, p: Plants, i: number, form: number[], tipWidth: number, sheen: boolean): void {
  const x = p.x[i];
  const y = p.y[i];
  const h = p.hw[i];
  const l = p.len[i] * 0.5;
  const ca = p.leanC[i];
  const sa = p.leanS[i];
  const cb = p.tipC[i];
  const sb = p.tipS[i];
  for (let j = 0; j < form.length; j += 4) {
    const cd = form[j + 2];
    const sd = form[j + 3];
    const c0 = ca * cd - sa * sd;
    const s0 = sa * cd + ca * sd;
    const c1 = cb * cd - sb * sd;
    const s1 = sb * cd + cb * sd;
    const bx = x + form[j] * h;
    const len = l * form[j + 1];
    const ex = bx + (s0 + s1) * len;
    const ey = y - (c0 + c1) * len;
    const qx = bx + (s0 * 0.75 + s1 * 0.25) * len;
    const qy = y - (c0 * 0.75 + c1 * 0.25) * len;
    const nx = (c0 + c1) * 0.5 * h * 0.75;
    const ny = (s0 + s1) * 0.5 * h * 0.75;
    if (sheen) {
      ctx.moveTo(qx - nx * 1.3, qy - ny * 1.3);
      ctx.lineTo(ex, ey);
      ctx.lineTo(qx + nx * 1.3, qy + ny * 1.3);
    } else {
      ctx.moveTo(bx - c0 * h, y - s0 * h);
      ctx.lineTo(qx - nx, qy - ny);
      ctx.lineTo(ex - c1 * h * tipWidth, ey - s1 * h * tipWidth);
      ctx.lineTo(ex + c1 * h * tipWidth, ey + s1 * h * tipWidth);
      ctx.lineTo(qx + nx, qy + ny);
      ctx.lineTo(bx + c0 * h, y + s0 * h);
    }
    ctx.closePath();
    if (j === 0) {
      p.tipX[i] = ex;
      p.tipY[i] = ey;
    }
  }
}

/** Redraws the trees, each a sprite sheared about the foot of its trunk as the wind leans on it. */
function drawTrees(ctx: Ctx, sheet: Sheet, img: CanvasImageSource, m: Motion, t: number): void {
  const d = m.treeDpr;
  const pane = m.treePane;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let i = 0; i < m.trees.length; i++) {
    const tr = m.trees[i];
    const s = sheet.trees[i];
    const g = gustAt(m.treeGx[i], m.treeGz[i], t);
    const k = tr.lean + tr.give * (0.012 + 0.03 * g + 0.006 * Math.sin(t * 1.7 + tr.phase));
    ctx.setTransform(1, 0, -k, 1, (tr.x - pane.x) * d, (tr.y - pane.y) * d);
    ctx.drawImage(img, s.sx, s.sy, s.sw, s.sh, -s.ax, -s.ay, s.sw, s.sh);
  }
}

/**
 * Repaints the meadow's pane for time t (seconds), far to near. The gusts bend the grass as they
 * travel and turn up its pale side, so each one crosses the meadow as a band of light.
 * Allocation-free.
 */
function drawMotion(ctx: Ctx, m: Motion, t: number): void {
  const d = m.dpr;
  const pane = m.pane;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalAlpha = 1;

  ctx.setTransform(d, 0, 0, d, -pane.x * d, -pane.y * d);
  const { blades, stems } = m;
  let b0 = 0;
  let s0 = 0;
  for (let slice = 0; slice < SLICES; slice++) {
    const b1 = m.bladeEnd[slice];
    const s1 = m.stemEnd[slice];
    bend(blades, b0, b1, t, 1.75);
    const groups = m.bladeGroups[slice];
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g];
      ctx.globalAlpha = grp.alpha;
      ctx.fillStyle = grp.color;
      // one small path per tuft: a software rasteriser handles many small fills faster than one
      // huge path spanning the whole pane
      for (let i = grp.start; i < grp.end; i++) {
        ctx.beginPath();
        plantPath(ctx, blades, i, TUFT_FORMS[i & 3], 0.3, false);
        ctx.fill();
      }
    }
    // the pale side of the blades, turned up where a gust is passing
    for (let k = 0; k < m.sheen.length; k++) {
      const [color, alpha, from] = m.sheen[k];
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      for (let i = b0; i < b1; i++) {
        if (blades.gust[i] < from) continue;
        ctx.beginPath();
        plantPath(ctx, blades, i, TUFT_FORMS[i & 3], 0, true);
        ctx.fill();
      }
    }
    b0 = b1;
    if (s1 === s0) continue;

    // flower stems, then their heads nodding at the tips
    bend(stems, s0, s1, t, 1.3);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = STEM_COLOR;
    for (let i = s0; i < s1; i++) {
      ctx.beginPath();
      plantPath(ctx, stems, i, SINGLE, 0.15, false);
      ctx.fill();
    }
    for (let pass = 0; pass < 2; pass++) {
      const colors = pass === 0 ? HEAD_COLORS : EYE_COLORS;
      const which = pass === 0 ? m.headColor : m.eyeColor;
      const size = pass === 0 ? 1 : 0.3;
      for (let c = 0; c < colors.length; c++) {
        ctx.globalAlpha = colors[c][1];
        ctx.fillStyle = colors[c][0];
        for (let i = s0; i < s1; i++) {
          if (which[i] !== c) continue;
          const r = m.head[i] * size;
          const a = stems.tipA[i];
          ctx.beginPath();
          ctx.ellipse(
            stems.tipX[i] + Math.sin(a) * m.head[i] * 0.3,
            stems.tipY[i] - Math.cos(a) * m.head[i] * 0.3,
            r,
            r * 0.68,
            a,
            0,
            TAU,
          );
          ctx.fill();
        }
      }
    }
    s0 = s1;
  }
  if (m.drift) drawDrift(ctx, m.drift, t);
  ctx.globalAlpha = 1;
}

/** Streaks of snow or sand, carried downwind and showing mostly where a gust is passing. */
function drawDrift(ctx: Ctx, p: Drift, t: number): void {
  ctx.fillStyle = p.color;
  const margin = p.w * 0.1;
  const span = p.w + margin * 2;
  for (let i = 0; i < p.x0.length; i++) {
    const x = ((p.x0[i] + t * p.speed[i]) % span) - margin;
    const pd = persp(p.d[i]);
    const g = gustAt((x - p.w / 2) / (p.F * pd), 1 / pd, t);
    const seen = Math.min(1, p.floor + smoothstep(0.3, 0.75, g));
    if (seen < 0.03) continue;
    const len = p.len[i] * (0.6 + g);
    const y = p.y0[i] - g * p.lift * p.thick[i] * 4 + Math.sin(t * 1.7 + p.phase[i]) * p.thick[i];
    ctx.globalAlpha = p.alpha * seen;
    ctx.fillRect(x - len, y, len, p.thick[i]);
  }
}

/* ------------------------------------------------------------------ engine */

interface Buffers {
  sky: HTMLCanvasElement;
  ground: HTMLCanvasElement;
  /** Sprite sheet of the trees. */
  sheet: HTMLCanvasElement;
  layout: Sheet;
  grain: { tile: HTMLCanvasElement; cssSize: number } | null;
  /** The context currently being painted; flushed after every step so raster cost stays in the slice. */
  active: Ctx | null;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function release(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}

/** CPU-backed context: painted once, read back cheaply to force rasterisation inside each slice. */
const bufferContext = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true });

function* paintAll(L: Layout, seed: number, bufs: Buffers): Gen {
  const sky = bufferContext(bufs.sky);
  const ground = bufferContext(bufs.ground);
  const sheet = bufferContext(bufs.sheet);
  if (!sky || !ground || !sheet) return;
  bufs.active = sky;
  yield* paintSky(sky, L, seed);
  yield "sky";
  bufs.active = ground;
  yield* paintLand(ground, L, meadowAt(L, seed), seed);
  bufs.active = sheet;
  yield* paintSheet(sheet, L, bufs.layout, seed);
  bufs.active = null;
  bufs.grain = grainTile(L.dpr, seed);
  yield "ground";
}

function pickDpr(w: number, h: number): number {
  const device =
    typeof window.devicePixelRatio === "number" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  let dpr = Math.min(device, MAX_DPR);
  if (w * h * dpr * dpr > MAX_LAYER_PIXELS) dpr = Math.sqrt(MAX_LAYER_PIXELS / (w * h));
  return Math.max(0.75, dpr);
}

function placePane(el: HTMLCanvasElement, pane: Pane, dpr: number): void {
  el.width = Math.max(1, Math.round(pane.w * dpr));
  el.height = Math.max(1, Math.round(pane.h * dpr));
  el.style.left = `${pane.x}px`;
  el.style.top = `${pane.y}px`;
  el.style.width = `${pane.w}px`;
  el.style.height = `${pane.h}px`;
}

/** A finished static layer: an ImageBitmap where supported, else the buffer canvas itself. */
type Shown = ImageBitmap | HTMLCanvasElement | null;

const bitmapsSupported = () =>
  typeof createImageBitmap === "function" && typeof ImageBitmapRenderingContext === "function";

/** Two copies of the sky tile side by side, so the strip can drift and wrap. */
function skyStrip(L: Layout, tile: HTMLCanvasElement): HTMLCanvasElement {
  const strip = makeCanvas(L.tilePx * 2, tile.height);
  const ctx = strip.getContext("2d");
  ctx?.drawImage(tile, 0, 0);
  ctx?.drawImage(tile, L.tilePx, 0);
  return strip;
}

/**
 * Freezes a painted buffer. Static layers are shown through a "bitmaprenderer" context, which hands
 * the bitmap to the compositor once instead of re-producing a 2D canvas resource on every frame.
 */
async function snapshot(src: HTMLCanvasElement, owned = false): Promise<Shown> {
  if (!bitmapsSupported()) {
    if (owned) return src;
    const copy = makeCanvas(src.width, src.height);
    copy.getContext("2d")?.drawImage(src, 0, 0);
    return copy;
  }
  try {
    return await createImageBitmap(src);
  } catch {
    return null;
  } finally {
    if (owned) release(src);
  }
}

function discard(s: Shown): void {
  if (!s) return;
  if (s instanceof HTMLCanvasElement) release(s);
  else s.close();
}

function show(el: HTMLCanvasElement, s: Shown, width: number, height: number): void {
  el.width = width;
  el.height = height;
  if (!s) return;
  if (s instanceof HTMLCanvasElement) {
    el.getContext("2d")?.drawImage(s, 0, 0);
    release(s);
    return;
  }
  const ctx = el.getContext("bitmaprenderer");
  if (ctx) ctx.transferFromImageBitmap(s);
  else s.close();
}

export function createMeadowEngine(
  els: MeadowCanvases,
  options: { seed: number; paused: boolean; biome?: MeadowBiome },
): MeadowEngine {
  const { root } = els;
  const seed = options.seed >>> 0;
  const biome = options.biome ?? "meadow";
  let paused = options.paused;
  let visible = true;
  let destroyed = false;
  const mql =
    typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduced = mql ? mql.matches : false;
  // contexts are taken on first use: nothing touches a canvas until the element has a size
  let motionCtx: Ctx | null = null;
  let treesCtx: Ctx | null = null;

  let current: { L: Layout; motion: Motion; layout: Sheet; sheet: Shown } | null = null;
  let job: { cancel(): void } | null = null;
  let raf = 0;
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFrameAt = 0;
  let frameCount = 0;
  let grainUrl: string | null = null;
  let grainToken = 0;
  let time = STILL_TIME;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let size = { w: 0, h: 0 };

  const running = () => !!current && !destroyed && !paused && visible && !document.hidden && !reduced;

  /** Clouds drift left → right; the strip is two tiles wide, so the offset wraps seamlessly. */
  const placeSky = (L: Layout) => {
    const offset = reduced ? L.tile * 0.5 : (time * SKY_DRIFT_PX_PER_S) % L.tile;
    els.sky.style.transform = `translate3d(${(offset - L.tile).toFixed(2)}px,0,0)`;
  };

  const render = (all = false) => {
    if (!current || !motionCtx || !treesCtx) return;
    const t = reduced ? STILL_TIME : time;
    // the clouds and the trees move a fraction of a pixel per frame: ~10 Hz is enough for them
    if (all || frameCount % 3 === 0) {
      if (current.sheet) drawTrees(treesCtx, current.layout, current.sheet, current.motion, t);
      placeSky(current.L);
    }
    frameCount++;
    drawMotion(motionCtx, current.motion, t);
  };

  // ~30 fps: sleep until a frame is nearly due, then align with the display through rAF. Asking for
  // a frame only when one will be drawn keeps the browser from running (and committing) a main
  // frame on every vsync in between.
  const requestFrame = () => {
    raf = requestAnimationFrame(tick);
  };
  const tick = (now: number) => {
    raf = 0;
    const dt = lastFrameAt === 0 ? 0 : Math.min(now - lastFrameAt, 100);
    lastFrameAt = now;
    time += dt / 1000;
    render();
    frameTimer = setTimeout(() => {
      frameTimer = undefined;
      if (running()) requestFrame();
    }, FRAME_MS - 8);
  };

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(frameTimer);
    frameTimer = undefined;
  };

  const update = () => {
    const run = running();
    if (run && !raf && frameTimer === undefined) {
      lastFrameAt = 0;
      requestFrame();
    } else if (!run) {
      stop();
    }
  };

  /** The weave tile goes in as a small blob URL (in a later frame than the layers themselves). */
  const applyGrain = (tile: HTMLCanvasElement, cssSize: number) => {
    const token = ++grainToken;
    tile.toBlob((blob) => {
      release(tile);
      if (!blob || destroyed || token !== grainToken) return;
      if (grainUrl) URL.revokeObjectURL(grainUrl);
      grainUrl = URL.createObjectURL(blob);
      root.style.setProperty("--scene-meadow-grain", `url("${grainUrl}")`);
      root.style.setProperty("--scene-meadow-grain-size", `${cssSize}px`);
    }, "image/png");
  };

  const commitSky = (L: Layout, sky: Shown) => {
    const el = els.sky;
    show(el, sky, L.tilePx * 2, Math.round(L.skyH * L.dpr));
    el.style.width = `${L.tile * 2}px`;
    el.style.height = `${L.skyH}px`;
    placeSky(L);
    el.dataset.ready = "";
  };

  const commitRest = (L: Layout, ground: Shown, grain: Buffers["grain"], layout: Sheet, sheet: Shown) => {
    show(els.ground, ground, Math.round(L.w * L.dpr), Math.round(L.h * L.dpr));
    els.ground.dataset.ready = "";
    if (grain) applyGrain(grain.tile, grain.cssSize);
    const motion = buildMotion(L, meadowAt(L, seed), seed, layout);
    placePane(els.motion, motion.pane, motion.dpr);
    placePane(els.trees, motion.treePane, motion.treeDpr);
    els.motion.dataset.ready = "";
    els.trees.dataset.ready = "";
    motionCtx ??= els.motion.getContext("2d");
    treesCtx ??= els.trees.getContext("2d");
    if (current) discard(current.sheet);
    current = { L, motion, layout, sheet };
    render(true);
    root.dataset.state = "ready";
    update();
  };

  const generate = (w: number, h: number) => {
    job?.cancel();
    const dpr = pickDpr(w, h);
    const L = computeLayout(w, h, dpr, seed, biome);
    const progressive = current === null;
    const layout = spriteSheet(L);
    const bufs: Buffers = {
      sky: makeCanvas(L.tilePx, Math.round(L.skyH * dpr)),
      ground: makeCanvas(Math.round(w * dpr), Math.round(h * dpr)),
      sheet: makeCanvas(layout.width, layout.height),
      layout,
      grain: null,
      active: null,
    };
    if (progressive) root.dataset.state = "painting";
    const gen = paintAll(L, seed, bufs);
    const channel = new MessageChannel();
    let cancelled = false;
    let sky: Promise<Shown> | null = null;
    const live = () => !cancelled && !destroyed;
    const finish = () => {
      channel.port1.onmessage = null;
      channel.port1.close();
      release(bufs.sky);
      release(bufs.ground);
      release(bufs.sheet);
      if (job === thisJob) job = null;
    };
    const thisJob = {
      cancel() {
        cancelled = true;
        finish();
      },
    };
    job = thisJob;
    channel.port1.onmessage = () => {
      if (!live()) return;
      const start = performance.now();
      for (;;) {
        const r = gen.next();
        // read one pixel back: forces the recorded strokes to rasterise now, inside this slice
        bufs.active?.getImageData(0, 0, 1, 1);
        if (r.value === "sky") {
          sky = snapshot(skyStrip(L, bufs.sky), true);
          if (progressive) {
            void sky.then((s) => {
              if (live()) commitSky(L, s);
              else discard(s);
            });
          }
        }
        if (r.done) {
          const grain = bufs.grain;
          const skyDone = sky ?? Promise.resolve<Shown>(null);
          void Promise.all([skyDone, snapshot(bufs.ground), snapshot(bufs.sheet)]).then(([s, g, sh]) => {
            if (!live()) {
              if (!progressive) discard(s);
              discard(g);
              discard(sh);
              if (grain) release(grain.tile);
              return;
            }
            if (!progressive) commitSky(L, s);
            commitRest(L, g, grain, layout, sh);
            finish();
          });
          return;
        }
        if (performance.now() - start > SLICE_MS) break;
      }
      channel.port2.postMessage(0);
    };
    channel.port2.postMessage(0);
  };

  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          const { width, height } = entry.contentRect;
          if (width < 8 || height < 8) return;
          if (Math.abs(width - size.w) < 0.5 && Math.abs(height - size.h) < 0.5) return;
          size = { w: width, h: height };
          clearTimeout(resizeTimer);
          if (!current && !job) generate(width, height);
          else resizeTimer = setTimeout(() => generate(size.w, size.h), RESIZE_DEBOUNCE_MS);
        })
      : null;
  ro?.observe(root);

  const io =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) visible = e.isIntersecting;
            update();
          },
          { rootMargin: "48px" },
        )
      : null;
  io?.observe(root);

  const onMotionPreference = () => {
    reduced = mql ? mql.matches : false;
    render(true);
    update();
  };
  mql?.addEventListener("change", onMotionPreference);
  document.addEventListener("visibilitychange", update);

  return {
    setPaused(next: boolean) {
      paused = next;
      update();
    },
    destroy() {
      destroyed = true;
      job?.cancel();
      clearTimeout(resizeTimer);
      ro?.disconnect();
      io?.disconnect();
      mql?.removeEventListener("change", onMotionPreference);
      document.removeEventListener("visibilitychange", update);
      stop();
      if (current) discard(current.sheet);
      current = null;
      for (const el of [els.sky, els.ground, els.trees, els.motion]) {
        delete el.dataset.ready;
        release(el);
      }
      root.style.removeProperty("--scene-meadow-grain");
      root.style.removeProperty("--scene-meadow-grain-size");
      if (grainUrl) URL.revokeObjectURL(grainUrl);
      grainUrl = null;
      delete root.dataset.state;
    },
  };
}
