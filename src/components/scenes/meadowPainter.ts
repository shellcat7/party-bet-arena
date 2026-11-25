/**
 * Procedural, stroke-by-stroke painting of a windy hilltop in the manner of Monet's
 * "Woman with a Parasol – Madame Monet and Her Son" (1875). Pure canvas code, no React.
 *
 * Layers (bottom to top), each a <canvas> owned by the component:
 *  - sky:    sky and clouds, painted once as a horizontally tileable strip (2 tiles wide)
 *            that drifts slowly by moving its CSS transform (compositor only, no repaint)
 *  - ground: hill, grass, child and woman, painted once
 *  - motion: wind-blown grass blades and the hem, repainted at ~30 fps; the canvas only
 *            covers the band that moves, so little has to be rasterised per frame
 *  - veil:   a small canvas for the fluttering veil
 * A canvas-weave tile (generated once) and a vignette are laid on top with CSS (scenes.css).
 *
 * Generation is time-sliced (a few ms per task) so it never blocks the main thread for long.
 */

type Ctx = CanvasRenderingContext2D;
type Gen = Generator<string | undefined, void, void>;

export interface MeadowCanvases {
  root: HTMLElement;
  sky: HTMLCanvasElement;
  ground: HTMLCanvasElement;
  /** Grass band (and the hem); sized and positioned by the engine. */
  motion: HTMLCanvasElement;
  /** Veil strands; sized and positioned by the engine. */
  veil: HTMLCanvasElement;
}

export interface MeadowEngine {
  setPaused(paused: boolean): void;
  destroy(): void;
}

const TAU = Math.PI * 2;
const FRAME_MS = 1000 / 30;
const SLICE_MS = 8;
const RESIZE_DEBOUNCE_MS = 220;
const MAX_DPR = 2;
const MAX_LAYER_PIXELS = 2_400_000;
const SKY_DRIFT_PX_PER_S = 2.6;
const STILL_TIME = 2.2;

/* Reference-painting coordinates (px in a 1568×1962 reproduction) used to place the figures. */
const REF_FEET_X = 878;
const REF_CREST_Y = 1318; // where the grass crest crosses the woman's skirt
const REF_TOP_Y = 15; // top of the parasol
const REF_LEFT_X = 401; // left tip of the parasol
const REF_RIGHT_X = 1140; // right edge of the bustle
const REF_CHILD_X = 430;
const REF_CHILD_CREST_Y = 1300;

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

/* Palette sampled from the reference (converted from Display P3 to sRGB). */
const SKY = ramp([
  [0, "#3282c2"],
  [0.3, "#4393cc"],
  [0.62, "#66a8d4"],
  [0.85, "#93c1d8"],
  [1, "#b3ccd0"],
]);
const SKY_DEEP = labs(["#2a88c8", "#3a86bc", "#4a8fc4", "#5b8db6"]);
const CLOUD_SHADE = ramp([
  [0, "#7f8fae"],
  [0.35, "#9a9dbd"],
  [0.65, "#aab4c2"],
  [1, "#c2bfb2"],
]);
const CLOUD_LIGHT = ramp([
  [0, "#c9bea6"],
  [0.4, "#e2d6ba"],
  [0.75, "#efe6cd"],
  [1, "#fbf6e6"],
]);
const CLOUD_WARM = labs(["#e9d9b0", "#f0dfc4", "#e8cfc0", "#f2e8b8"]);

const GRASS = {
  deep: labs(["#0e3d22", "#1a3a24", "#22442c", "#173c2a"]),
  dark: labs(["#2a533c", "#3a6418", "#264428", "#447060", "#3c5a2e"]),
  mid: labs(["#525f41", "#626d0a", "#757339", "#5b5f39", "#55700d", "#6a7a2a", "#7a8054"]),
  sun: labs(["#858406", "#8b8c11", "#9a8c2c", "#abaa3d", "#9e935b", "#a6b040", "#b8b44e", "#a3c046"]),
  cool: labs(["#618492", "#447060", "#6f8f86", "#7d98a8", "#5c7f78"]),
  pale: labs(["#b5b19d", "#989578", "#c2c0a6", "#a9ac8a"]),
  earth: labs(["#423a21", "#5e4c26", "#7a6a3a", "#9e935b"]),
  accent: labs(["#9a3c30", "#7e3a4a", "#6a4a86", "#b0603a", "#8c2f3a", "#7a5a9a"]),
  flower: labs(["#e4d24a", "#efdf6e", "#d8c83c", "#dfe060", "#f1e78e"]),
};

const SKIRT = ramp([
  [0, "#3e5878"],
  [0.25, "#536d8e"],
  [0.45, "#6983a2"],
  [0.65, "#859cb6"],
  [0.83, "#a5b6c6"],
  [1, "#cad3d4"],
]);
const LAVENDER = labs(["#8c8cb8", "#a09cc6", "#8888b0", "#ab9fc6"]);
const REFLECT_BLUE = labs(["#5fa8dc", "#74b6de", "#4f9bd2"]);
const JACKET_WARM = ramp([
  [0, "#9e9a62"],
  [0.5, "#bdb575"],
  [1, "#d8cf94"],
]);
const JACKET_COOL = ramp([
  [0, "#55707f"],
  [0.5, "#6f8a98"],
  [1, "#8fa4ab"],
]);
const JACKET_PALE = ramp([
  [0, "#8fa0a4"],
  [0.5, "#aeb9b2"],
  [1, "#d0d3c6"],
]);
const HAT = labs(["#3e4b60", "#4f5f78", "#5c6e88", "#34405a"]);
const PARASOL = ramp([
  [0, "#173a22"],
  [0.25, "#245631"],
  [0.45, "#326e38"],
  [0.62, "#4c883c"],
  [0.8, "#73aa50"],
  [1, "#a4c968"],
]);
const EMERALD = labs(["#0f6c47", "#1a8257", "#127a52"]);
const RIM = ramp([
  [0, "#a9b6be"],
  [0.4, "#d9d7c8"],
  [0.75, "#efeadb"],
  [1, "#fcf9ef"],
]);
const SKIN = labs(["#8a6c56", "#a07e64", "#b48e70", "#7a604c"]);
const HAIR = labs(["#3e382f", "#4a4236", "#2f2c27"]);
const SCARF = labs(["#24477e", "#335c9c", "#1c3567", "#3d6aa8"]);
const SHAFT = labs(["#6b4a2e", "#7e5a36"]);
const CHILD = ramp([
  [0, "#2f5f86"],
  [0.35, "#457aa2"],
  [0.65, "#6c9cb8"],
  [1, "#a6d0d4"],
]);
const CHILD_FACE = labs(["#d68a76", "#e2a08a", "#c4705e", "#e8b09a"]);
const STRAW = labs(["#d8c58e", "#e8d7a6", "#b9a36c", "#f0e2b8"]);
const HAT_BAND = labs(["#c64e38", "#d9674a", "#b44434"]);

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
    if (texture <= 0 || devWidth < 2.6) return;
    // bristle streaks spread across the width; some run past the end (dry brush)
    const n = Math.min(6, Math.max(2, Math.round(devWidth / 3.2)));
    for (let i = 0; i < n; i++) {
      const o = (((i + 0.5) / n - 0.5) * 1.7 + rng.signed(0.18)) * h;
      const s0 = rng.range(0, 0.25);
      const s1 = rng.range(0.6, 1.08);
      const ox = nx * o;
      const oy = ny * o;
      const a0 = (1 - s0) * (1 - s0);
      const a1 = 2 * (1 - s0) * s0;
      const a2 = s0 * s0;
      const b0 = (1 - s1) * (1 - s1);
      const b1 = 2 * (1 - s1) * s1;
      const b2 = s1 * s1;
      const m0 = (1 - s0) * (1 - s1);
      const m1 = (1 - s0) * s1 + s0 * (1 - s1);
      const m2 = s0 * s1;
      const light = rng.chance(0.55);
      const shade = lighten(col, light ? rng.range(0.04, 0.11) : -rng.range(0.035, 0.1));
      ctx.strokeStyle = vary(shade, rng, 0.01, 0.08, 0.05);
      ctx.globalAlpha = alpha * texture * rng.range(0.32, 0.7);
      ctx.lineWidth = Math.max(0.6 / this.scale, wid * rng.range(0.07, 0.15));
      ctx.beginPath();
      ctx.moveTo(a0 * x + a1 * cx + a2 * x2 + ox, a0 * y + a1 * cy + a2 * y2 + oy);
      ctx.quadraticCurveTo(
        m0 * x + m1 * cx + m2 * x2 + ox,
        m0 * y + m1 * cy + m2 * y2 + oy,
        b0 * x + b1 * cx + b2 * x2 + ox,
        b0 * y + b1 * cy + b2 * y2 + oy,
      );
      ctx.stroke();
    }
  }

  /** A short, fat dab (flowers, faces, highlights). */
  dab(x: number, y: number, r: number, ang: number, col: Lab, alpha: number): void {
    const { ctx, rng } = this;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = vary(col, rng, 0.03, 0.08, 0.06);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.55, 0.85), ang, 0, TAU);
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ layout */

interface Layout {
  w: number;
  h: number;
  dpr: number;
  /** Brush unit for sky and grass strokes (CSS px). */
  bu: number;
  /** Figure scale: CSS px per reference-painting px. */
  k: number;
  /** Translation that maps reference px to CSS px for the woman: X = tx + k * px. */
  tx: number;
  ty: number;
  /** Same for the child. */
  cx: number;
  cy: number;
  ridge: Float32Array;
  ridgeMin: number;
  ridgeMax: number;
  /** Sky tile period in CSS px (tilePx device px). */
  tile: number;
  tilePx: number;
  skyH: number;
}

function ridgeAt(L: Layout, x: number): number {
  const i = clamp(Math.round(x), 0, L.ridge.length - 1);
  return L.ridge[i];
}

function computeLayout(w: number, h: number, dpr: number, seed: number): Layout {
  const aspect = w / h;
  // 0 for a 3:4 portrait card, 1 for a 3:1 banner
  const t = clamp(Math.log(aspect / 0.75) / Math.log(4), 0, 1);
  const crest = h * lerp(0.68, 0.8, t);
  const top = h * lerp(0.06, 0.08, t);
  let k = (crest - top) / (REF_CREST_Y - REF_TOP_Y);
  k = Math.min(k, (w * 0.88) / (REF_RIGHT_X - REF_LEFT_X));
  const feetX = clamp(
    w * lerp(0.6, 0.63, t),
    (REF_FEET_X - REF_LEFT_X) * k + w * 0.04,
    w - (REF_RIGHT_X - REF_FEET_X) * k - w * 0.03,
  );
  const bu = clamp(Math.sqrt(w * h) / 72, 2.3, 7.5);

  const n = Math.ceil(w) + 2;
  const ridge = new Float32Array(n);
  const rs = hashInt(seed, 31);
  const shape = (x: number) => {
    const d = (x - feetX) / Math.max(w, h * 1.2);
    return (
      h * 0.05 * d * d * 2.2 +
      h * 0.018 * fbm(x / (h * 0.45), 0.5, rs, 0, 3) +
      h * 0.006 * fbm(x / (h * 0.09), 3.3, rs + 1, 0, 2) +
      (h * 0.025 * (feetX - x)) / w
    );
  };
  const base = shape(feetX);
  let ridgeMin = Infinity;
  let ridgeMax = -Infinity;
  for (let x = 0; x < n; x++) {
    // higher ground to the left (the hill continues), lowest point near the right edge
    const y = crest + (shape(x) - base) - (h * 0.05 * (feetX - x)) / w;
    ridge[x] = y;
    ridgeMin = Math.min(ridgeMin, y);
    ridgeMax = Math.max(ridgeMax, y);
  }

  const childX = feetX + (REF_CHILD_X - REF_FEET_X) * k;
  const tilePx = Math.ceil(w * dpr);
  return {
    w,
    h,
    dpr,
    bu,
    k,
    tx: feetX - REF_FEET_X * k,
    ty: crest - REF_CREST_Y * k,
    cx: childX - REF_CHILD_X * k,
    cy: ridge[clamp(Math.round(childX), 0, n - 1)] - REF_CHILD_CREST_Y * k,
    ridge,
    ridgeMin,
    ridgeMax,
    tile: tilePx / dpr,
    tilePx,
    skyH: Math.min(h, ridgeMax + bu * 3),
  };
}

/* ------------------------------------------------------------------ sky */

function* paintSky(ctx: Ctx, L: Layout, seed: number): Gen {
  const rng = new Rng(hashInt(seed, 101));
  const brush = new Brush(ctx, rng);
  brush.scale = L.dpr;
  const T = L.tile;
  const H = L.skyH;
  const bu = L.bu;
  const hz = (L.ridgeMin + L.ridgeMax) * 0.5; // the horizon is hidden behind the hill
  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  ctx.lineCap = "round";

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  for (const s of SKY) grad.addColorStop(clamp((s.at * hz) / H, 0, 1), hex(s.c));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, T, H);
  yield;

  // Periodic cloud field (period T along x) so the strip tiles seamlessly while drifting.
  const pBig = Math.max(2, Math.round(T / clamp(L.h * 0.55, 70, 300)));
  const pDet = Math.max(5, Math.round(T / clamp(L.h * 0.15, 18, 80)));
  const fBig = pBig / T;
  const fDet = pDet / T;
  const sBig = hashInt(seed, 7);
  const sDet = hashInt(seed, 8);
  const rawCloud = (x: number, y: number) => {
    const v = y / hz;
    const big = fbm(x * fBig, y * fBig * 1.9, sBig, pBig, 4);
    const det = fbm(x * fDet, y * fDet * 2.6, sDet, pDet, 3);
    const env = smoothstep(0.0, 0.36, v) * (1 - 0.45 * smoothstep(0.8, 1.05, v));
    return (0.76 * big + 0.24 * det + 0.3) * env;
  };
  // pick the threshold so that every seed gets a similar amount of cloud
  const samples: number[] = [];
  for (let gy = 0; gy < 24; gy++) {
    for (let gx = 0; gx < 48; gx++) samples.push(rawCloud(((gx + 0.5) / 48) * T, ((gy + 0.5) / 24) * hz));
    if ((gy & 7) === 7) yield;
  }
  samples.sort((a, b) => a - b);
  const th = samples[Math.floor(samples.length * 0.5)];
  const cloudAt = (x: number, y: number) => smoothstep(th, th + 0.2, rawCloud(x, y));

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

  const area = T * Math.min(H, hz + bu * 2);
  // 1. blue underlayer: steep diagonal hatching and flatter wind-driven strokes
  const nBlue = Math.round(area / (bu * bu * 2.1));
  for (let i = 0; i < nBlue; i++) {
    const x = rng.next() * T;
    const y = rng.range(-bu, Math.min(H, hz + bu * 2));
    const v = clamp(y / hz + rng.signed(0.1), 0, 1);
    const r0 = rng.next();
    const col =
      v < 0.55 && r0 < 0.05
        ? mix(rampAt(SKY, v), rng.pick(SKY_DEEP), 0.6)
        : r0 > 0.88
          ? rampAt(SKY, clamp(v + rng.range(0.1, 0.24), 0, 1))
          : rampAt(SKY, v);
    const steep = rng.chance(0.45);
    const ang = steep ? -1.05 + rng.signed(0.3) : -0.24 + rng.signed(0.22);
    const len = bu * rng.range(1.5, 3.2) * (steep ? 0.85 : 1);
    const wid = bu * rng.range(0.55, 1.05) * (steep ? 1.15 : 1);
    const bend = rng.signed(0.1);
    const alpha = rng.range(0.5, 0.88);
    wrapped(x, len + wid, (px) => brush.stroke(px, y, ang, len, wid, bend, col, alpha, 0.6));
    if ((i & 31) === 31) yield;
  }

  // 2. clouds, dark to light: shaded body, lit body, highlights, then broken edges
  const skyBottom = Math.min(H, hz + bu);
  const litAt = (x: number, y: number, c: number) => {
    const up = cloudAt(x, y - bu * 2.2);
    const dn = cloudAt(x, y + bu * 2.2);
    return clamp(0.46 + (dn - up) * 1.4 + (c - 0.6) * 0.4 + rng.signed(0.2), 0, 1);
  };
  const cloudStroke = (x: number, y: number, col: Lab, size: number, alpha: number) => {
    const r = rng.next();
    const ang = r < 0.45 ? -0.22 + rng.signed(0.22) : r < 0.78 ? -0.75 + rng.signed(0.3) : rng.signed(1.4);
    const s = size * rng.range(0.65, 1.45);
    const len = bu * rng.range(1.3, 2.8) * s;
    const wid = bu * rng.range(0.6, 1.05) * s;
    const bend = rng.chance(0.25) ? rng.signed(0.32) : rng.signed(0.14);
    wrapped(x, len + wid, (px) =>
      brush.stroke(
        px - Math.cos(ang) * len * 0.5,
        y - Math.sin(ang) * len * 0.5,
        ang,
        len,
        wid,
        bend,
        col,
        alpha,
      ),
    );
  };
  const passes: [number, number, number][] = [
    // [count factor, min density, stroke size]
    [1 / 2.2, 0.22, 1.55],
    [1 / 1.5, 0.12, 1.05],
    [1 / 4.5, 0.3, 0.6],
    [1 / 2.2, 0.04, 0.75],
  ];
  for (let p = 0; p < passes.length; p++) {
    const [factor, minC, size] = passes[p];
    const count = Math.round((area / (bu * bu)) * factor);
    for (let i = 0; i < count; i++) {
      if ((i & 31) === 31) yield;
      const x = rng.next() * T;
      const y = rng.range(-bu, skyBottom);
      const c = cloudAt(x, y);
      if (c < minC || rng.next() > c * 1.4) {
        continue;
      }
      const lit = litAt(x, y, c);
      if (p === 0) {
        const col = lit < 0.55 ? rampAt(CLOUD_SHADE, lit / 0.55) : rampAt(CLOUD_LIGHT, (lit - 0.55) * 1.1);
        cloudStroke(x, y, col, size, rng.range(0.7, 0.92));
      } else if (p === 1) {
        if (lit < 0.42 && rng.chance(0.6)) continue;
        const col = rng.chance(0.07) ? rng.pick(CLOUD_WARM) : rampAt(CLOUD_LIGHT, (lit - 0.3) / 0.7);
        cloudStroke(x, y, col, size, rng.range(0.7, 0.93));
      } else if (p === 2) {
        if (lit < 0.7) continue;
        cloudStroke(x, y, rampAt(CLOUD_LIGHT, 0.86 + rng.next() * 0.14), size, rng.range(0.8, 0.97));
      } else {
        if (c > 0.45) continue;
        const col = lit < 0.4 ? rampAt(CLOUD_SHADE, 0.5 + lit) : rampAt(CLOUD_LIGHT, lit * 0.8);
        cloudStroke(x, y, col, size, rng.range(0.55, 0.85));
      }
    }
  }

  // 3. blue cut back into the cloud edges, as a painter breaks up the masses
  const nCut = Math.round((area / (bu * bu)) * 0.3);
  for (let i = 0; i < nCut; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * T;
    const y = rng.range(0, Math.min(H, hz));
    const c = cloudAt(x, y);
    if (c < 0.06 || c > 0.55) continue;
    const col = rampAt(SKY, clamp(y / hz + rng.signed(0.1), 0, 1));
    const len = bu * rng.range(1.0, 2.2);
    const wid = bu * rng.range(0.4, 0.8);
    const ang = -0.3 + rng.signed(0.45);
    const bend = rng.signed(0.12);
    const alpha = rng.range(0.55, 0.85);
    wrapped(x, len + wid, (px) => brush.stroke(px, y, ang, len, wid, bend, col, alpha));
  }
}

/* ------------------------------------------------------------------ ground: grass + figures */

/** Light/shade field over the grass, including the figure's shadow falling down-left. */
function grassLight(L: Layout, seed: number): (x: number, y: number) => number {
  const { w, h, bu } = L;
  const patchSeed = hashInt(seed, 41);
  const shadeSeed = hashInt(seed, 42);
  const feetX = L.tx + REF_FEET_X * L.k;
  return (x, y) => {
    const r = ridgeAt(L, x);
    const dy = y - r;
    // large sunlit and shaded masses, broken up by smaller patches
    const patch =
      0.6 * fbm(x / (bu * 20), y / (bu * 11), patchSeed + 5, 0, 2) +
      0.55 * fbm(x / (bu * 8), y / (bu * 4.5), patchSeed, 0, 3);
    if (dy < bu) return patch + 0.15;
    const centre = feetX - 0.9 * dy + fbm(x / (bu * 7), y / (bu * 4), shadeSeed, 0, 2) * bu * 4;
    const half = bu * 2 + 0.34 * dy;
    const shadow = smoothstep(half, half * 0.45, Math.abs(x - centre)) * smoothstep(bu, bu * 4, dy);
    return patch - 1.5 * shadow - (0.15 * dy) / Math.max(w, h) + 0.08;
  };
}

function grassColor(rng: Rng, patch: number, depth: number): Lab {
  if (rng.chance(0.025 + 0.02 * (1 - depth))) return rng.pick(GRASS.accent);
  if (rng.chance(0.07)) return rng.pick(GRASS.earth);
  if (depth < 0.2 && rng.chance(0.3 * (1 - depth / 0.2))) {
    return rng.chance(0.6) ? rng.pick(GRASS.cool) : rng.pick(GRASS.pale);
  }
  // mix measured from the reference: ~14% deep, 20% dark, 36% olive, 25% sunlit
  const sun = patch * 1.1 + (0.25 - depth) * 0.35 + rng.signed(0.35);
  if (sun > 0.18) return rng.pick(GRASS.sun);
  if (sun > -0.24) return rng.pick(GRASS.mid);
  if (sun > -0.56) return rng.pick(GRASS.dark);
  return rng.pick(GRASS.deep);
}

function pointInPoly(poly: readonly number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polyBounds(poly: readonly number[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    x0 = Math.min(x0, poly[i]);
    x1 = Math.max(x1, poly[i]);
    y0 = Math.min(y0, poly[i + 1]);
    y1 = Math.max(y1, poly[i + 1]);
  }
  return [x0, y0, x1, y1];
}

function polyArea(poly: readonly number[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    a += (poly[j] + poly[i]) * (poly[j + 1] - poly[i + 1]);
  }
  return Math.abs(a) / 2;
}

function fillPoly(ctx: Ctx, poly: readonly number[], color: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
  ctx.fill();
}

type RegionStroke = (x: number, y: number, u: number, v: number) => void;

/** Calls `paint` for `count` random points inside `poly`, with u/v normalised to its bounds. */
function* strokesIn(rng: Rng, poly: readonly number[], count: number, paint: RegionStroke): Gen {
  const [x0, y0, x1, y1] = polyBounds(poly);
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 6; tries++) {
    if ((tries & 15) === 15) yield;
    const x = rng.range(x0, x1);
    const y = rng.range(y0, y1);
    if (!pointInPoly(poly, x, y)) continue;
    paint(x, y, (x - x0) / (x1 - x0), (y - y0) / (y1 - y0));
    placed++;
  }
}

/* Figure outlines in reference-painting px. */
const SKIRT_POLY = [
  822, 795, 795, 850, 772, 910, 748, 970, 725, 1030, 700, 1080, 672, 1120, 640, 1160, 612, 1205, 590, 1250,
  566, 1300, 600, 1332, 700, 1346, 850, 1352, 1000, 1346, 1100, 1322, 1122, 1260, 1132, 1200, 1136, 1120,
  1132, 1040, 1124, 970, 1112, 900, 1100, 850, 1086, 812, 1000, 800, 900, 796,
];
const JACKET_POLY = [
  880, 492, 860, 508, 847, 540, 840, 600, 834, 680, 826, 750, 812, 802, 900, 810, 1000, 816, 1080, 822, 1124,
  834, 1098, 792, 1070, 760, 1056, 700, 1048, 620, 1044, 566, 1034, 532, 1012, 508, 980, 492, 948, 484, 914,
  484,
];
const CANOPY_POLY = [
  401, 240, 471, 165, 526, 95, 600, 45, 676, 15, 760, 22, 846, 40, 931, 95, 1016, 190, 966, 225, 936, 262,
  890, 305, 846, 350, 800, 334, 760, 336, 716, 370, 666, 395, 620, 362, 576, 332, 530, 345, 486, 355, 466,
  300, 430, 270,
];
const CANOPY_CENTER: [number, number] = [696, 130];
const CANOPY_TIPS = [401, 240, 526, 95, 676, 15, 931, 95, 1016, 190, 846, 350, 666, 395, 486, 355];
const RIM_TOP = [452, 188, 526, 98, 600, 48, 676, 18, 760, 25, 846, 43, 931, 98, 1004, 182];
const RIM_BOTTOM = [
  1016, 190, 966, 225, 936, 262, 890, 305, 846, 350, 800, 334, 760, 336, 716, 370, 666, 395, 620, 362, 576,
  332, 530, 345, 486, 355, 466, 300, 430, 270, 401, 240,
];
const CHILD_BODY = [
  372, 1188, 404, 1172, 462, 1170, 494, 1186, 514, 1226, 522, 1300, 520, 1370, 346, 1370, 340, 1300, 350,
  1226,
];

function* paintParasol(b: Brush): Gen {
  const { ctx, rng } = b;
  fillPoly(ctx, CANOPY_POLY, "#2a5a32", 1);
  const [ccx, ccy] = CANOPY_CENTER;
  const panelTone = [0.36, 0.5, 0.44, 0.72, 0.62, 0.52, 0.4, 0.3];
  const tipAngles: number[] = [];
  for (let i = 0; i < CANOPY_TIPS.length; i += 2) {
    tipAngles.push(Math.atan2(CANOPY_TIPS[i + 1] - ccy, CANOPY_TIPS[i] - ccx));
  }
  const panelOf = (a: number) => {
    // the panel whose angular sector contains a
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < tipAngles.length; i++) {
      const j = (i + 1) % tipAngles.length;
      let mid = (tipAngles[i] + tipAngles[j]) / 2;
      if (Math.abs(tipAngles[j] - tipAngles[i]) > Math.PI) mid += Math.PI;
      const d = Math.abs(Math.atan2(Math.sin(a - mid), Math.cos(a - mid)));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const count = Math.round((polyArea(CANOPY_POLY) / (60 * 15)) * 2.8);
  // strokes are clipped to the canopy so its scalloped silhouette stays crisp
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(CANOPY_POLY[0], CANOPY_POLY[1]);
  for (let i = 2; i < CANOPY_POLY.length; i += 2) ctx.lineTo(CANOPY_POLY[i], CANOPY_POLY[i + 1]);
  ctx.closePath();
  ctx.clip();
  yield* strokesIn(rng, CANOPY_POLY, count, (x, y) => {
    const a = Math.atan2(y - ccy, x - ccx);
    const r = Math.hypot(x - ccx, y - ccy);
    const tone = panelTone[panelOf(a)] + Math.min(r / 320, 1) * 0.12 + rng.signed(0.16);
    const col = rng.chance(0.14) ? rng.pick(EMERALD) : rampAt(PARASOL, tone);
    const ang = a + rng.signed(0.35) + (rng.chance(0.5) ? Math.PI : 0);
    centred(b, x, y, ang, rng.range(40, 85), rng.range(11, 19), rng.signed(0.12), col, rng.range(0.7, 0.95));
  });
  ctx.restore();
  // ribs
  for (let i = 0; i < CANOPY_TIPS.length; i += 2) {
    const tx = CANOPY_TIPS[i];
    const ty = CANOPY_TIPS[i + 1];
    const ang = Math.atan2(ty - ccy, tx - ccx);
    const len = Math.hypot(tx - ccx, ty - ccy);
    b.stroke(ccx, ccy, ang, len * 0.96, 6, rng.signed(0.03), hexLab("#1d3d26"), 0.45, 0);
  }
  // bottom edge: dark scalloped hem with a cool reflected line
  for (let i = 0; i + 2 < RIM_BOTTOM.length; i += 2) {
    const x0 = RIM_BOTTOM[i];
    const y0 = RIM_BOTTOM[i + 1];
    const x1 = RIM_BOTTOM[i + 2];
    const y1 = RIM_BOTTOM[i + 3];
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const len = Math.hypot(x1 - x0, y1 - y0);
    b.stroke(
      x0,
      y0,
      ang,
      len,
      12,
      rng.signed(0.08),
      hexLab(rng.chance(0.5) ? "#1f4430" : "#2b5448"),
      0.85,
      0.6,
    );
    if (rng.chance(0.6)) b.stroke(x0, y0 + 6, ang, len * 0.8, 5, rng.signed(0.08), hexLab("#4d7f9e"), 0.6, 0);
  }
  yield;
  // the sunlit outer surface shows as a pale crescent along the upper edge
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i + 2 < RIM_TOP.length; i += 2) {
      const x0 = RIM_TOP[i];
      const y0 = RIM_TOP[i + 1];
      const x1 = RIM_TOP[i + 2];
      const y1 = RIM_TOP[i + 3];
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const len = Math.hypot(x1 - x0, y1 - y0);
      const nx = Math.sin(ang);
      const ny = -Math.cos(ang);
      // thicker in the middle of the arc, thin at its ends
      const mid = 1 - Math.abs(i / (RIM_TOP.length - 4) - 0.5) * 1.4;
      for (let s = 0; s < 3; s++) {
        const f = (s + rng.next() * 0.7) / 3;
        const o = (pass === 0 ? -16 : pass === 1 ? -9 : -4) * mid + rng.signed(4);
        const x = x0 + (x1 - x0) * f + nx * o - Math.cos(ang) * len * 0.25;
        const y = y0 + (y1 - y0) * f + ny * o - Math.sin(ang) * len * 0.25;
        const tone =
          pass === 0 ? rng.range(0.05, 0.5) : pass === 1 ? rng.range(0.5, 0.9) : rng.range(0.85, 1);
        const wid = (pass === 2 ? rng.range(10, 16) : rng.range(18, 30)) * (0.45 + 0.55 * mid);
        b.stroke(
          x,
          y,
          ang + rng.signed(0.15),
          len * rng.range(0.5, 0.85),
          wid,
          rng.signed(0.1),
          rampAt(RIM, tone),
          rng.range(0.8, 0.96),
        );
      }
    }
  }
  yield;
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

/** Strokes laid along a line from (x0, y0) to (x1, y1), `n` side by side across `width`. */
function band(
  b: Brush,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  n: number,
  pick: (f: number) => Lab,
  alpha: number,
) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const o = (f - 0.5) * width + b.rng.signed(width * 0.08);
    const s = b.rng.range(0, 0.12) * len;
    b.stroke(
      x0 + nx * o + Math.cos(ang) * s,
      y0 + ny * o + Math.sin(ang) * s,
      ang + b.rng.signed(0.06),
      len * b.rng.range(0.75, 1),
      (width / n) * b.rng.range(1.3, 1.9),
      b.rng.signed(0.05),
      pick(f),
      alpha,
    );
  }
}

function* paintWoman(b: Brush): Gen {
  const { ctx, rng } = b;

  // the parasol is behind her head
  yield* paintParasol(b);

  // skirt: diagonal folds swept down-left by the wind, lit from the front-left
  fillPoly(ctx, SKIRT_POLY, "#6f88a6", 1);
  const skirtSeed = rng.int(1e9);
  let count = Math.round((polyArea(SKIRT_POLY) / (80 * 20)) * 3.3);
  yield* strokesIn(rng, SKIRT_POLY, count, (x, y, u, v) => {
    // folds run from the waist down to the lower left
    const fold = Math.sin((u * 2.6 + v * 2.2 + 0.4 * noise2(x / 70, y / 70, skirtSeed, 0)) * Math.PI);
    let tone = 0.62 - 0.46 * u + 0.3 * fold + rng.signed(0.1);
    if (u < 0.5 && v > 0.08 && v < 0.75) tone += 0.08;
    let col = rampAt(SKIRT, tone);
    const bustle = u > 0.7 && v < 0.48;
    if (bustle ? rng.chance(0.45) : tone < 0.4 && rng.chance(0.18)) col = mix(col, rng.pick(LAVENDER), 0.55);
    else if (rng.chance(0.08)) col = rng.pick(REFLECT_BLUE);
    else if (tone > 0.8 && rng.chance(0.3)) col = hexLab("#e9e4c8");
    if (v > 0.8 && rng.chance(0.2)) col = mix(col, hexLab("#9ea052"), 0.5);
    let ang = Math.PI / 2 + 0.78 - 0.55 * u + rng.signed(0.18);
    if (bustle && rng.chance(0.6)) ang = Math.PI / 2 - 1 + v * 1.8 + rng.signed(0.3);
    centred(
      b,
      x,
      y,
      ang,
      rng.range(50, 105),
      rng.range(15, 24),
      rng.signed(0.14),
      col,
      rng.range(0.75, 0.95),
    );
  });
  // long light sweeps along the front folds
  for (let i = 0; i < 12; i++) {
    const x = rng.range(720, 980);
    const y = rng.range(830, 1180);
    if (!pointInPoly(SKIRT_POLY, x, y)) continue;
    centred(
      b,
      x,
      y,
      Math.PI / 2 + 0.72 + rng.signed(0.12),
      rng.range(110, 190),
      rng.range(10, 16),
      rng.signed(0.08),
      rampAt(SKIRT, rng.range(0.84, 1)),
      0.85,
    );
  }

  // jacket: warm light in front, cool blue-grey shadow at the back and under the arm
  fillPoly(ctx, JACKET_POLY, "#a2ada8", 1);
  count = Math.round((polyArea(JACKET_POLY) / (45 * 13)) * 3.2);
  yield* strokesIn(rng, JACKET_POLY, count, (x, y, u, v) => {
    // pale on the arm side, warm yellow light in front, blue-grey shadow towards the back,
    // with a thin rim of light along the back edge
    const uu = u + rng.signed(0.1);
    let col: Lab;
    if (uu > 0.93 && rng.chance(0.4)) col = rampAt(JACKET_PALE, rng.range(0.5, 1));
    else if (uu > 0.6)
      col = rampAt(JACKET_COOL, clamp(0.8 - (uu - 0.6) * 2 + rng.signed(0.25) - (v < 0.2 ? 0.2 : 0), 0, 1));
    else if (uu > 0.26 && v > 0.3 && rng.chance(0.75))
      col = rampAt(JACKET_WARM, clamp(0.25 + v * 0.55 + rng.signed(0.25), 0, 1));
    else col = rampAt(JACKET_PALE, clamp(0.72 - v * 0.45 + rng.signed(0.25), 0, 1));
    if (rng.chance(0.06)) col = hexLab("#a6c6da");
    const r = rng.next();
    const ang = r < 0.5 ? 2.15 + rng.signed(0.3) : r < 0.8 ? 1.2 + rng.signed(0.25) : rng.signed(0.35);
    centred(b, x, y, ang, rng.range(30, 60), rng.range(10, 16), rng.signed(0.16), col, rng.range(0.78, 0.95));
  });
  yield;

  // cool shadows: under the arm, along the peplum, at the back of the waist
  band(b, 884, 560, 866, 780, 24, 2, () => rampAt(JACKET_COOL, rng.range(0.15, 0.5)), 0.75);
  // the peplum throws a soft shadow onto the skirt below it
  for (let i = 0; i < 7; i++) {
    const x = rng.range(840, 1100);
    centred(
      b,
      x,
      836 + (x - 840) * 0.08 + rng.signed(8),
      0.1 + rng.signed(0.25),
      rng.range(50, 90),
      rng.range(12, 18),
      rng.signed(0.15),
      rng.chance(0.5) ? rng.pick(LAVENDER) : rampAt(SKIRT, rng.range(0.1, 0.35)),
      rng.range(0.5, 0.75),
    );
  }
  band(b, 1050, 640, 1080, 790, 22, 2, () => rampAt(JACKET_COOL, rng.range(0.0, 0.3)), 0.7);
  // her other arm hangs along the back: a cool contour and a rim of light beyond it
  band(b, 1004, 530, 1030, 770, 14, 1, () => rampAt(JACKET_COOL, rng.range(0.05, 0.3)), 0.7);
  band(b, 1036, 560, 1052, 720, 10, 1, () => rampAt(JACKET_PALE, rng.range(0.7, 1)), 0.6);

  // sleeve raised along the jacket's front edge to the hand on the shaft
  band(
    b,
    884,
    500,
    830,
    628,
    54,
    5,
    (f) => (f < 0.55 ? rampAt(JACKET_PALE, 0.45 + f) : rampAt(JACKET_COOL, 0.75 - f * 0.4)),
    0.92,
  );
  band(b, 876, 520, 838, 640, 22, 2, () => rampAt(JACKET_WARM, rng.range(0.5, 0.9)), 0.6);

  // neck, scarf
  // a short, shadowed neck half hidden by the collar
  for (let i = 0; i < 5; i++)
    centred(
      b,
      912 + rng.signed(10),
      452 + i * 6,
      -Math.PI / 2 + rng.signed(0.2),
      30,
      24,
      0,
      rng.pick([SKIN[0], SKIN[3]]),
      0.92,
      0.4,
    );
  for (let i = 0; i < 5; i++)
    centred(
      b,
      912 + rng.signed(36),
      478 + rng.signed(5),
      rng.signed(0.3),
      rng.range(26, 40),
      rng.range(10, 14),
      0,
      rampAt(JACKET_PALE, rng.range(0.6, 1)),
      0.9,
      0.5,
    );
  for (let i = 0; i < 9; i++) {
    const ang = rng.chance(0.5) ? 0.3 + rng.signed(0.4) : 2.5 + rng.signed(0.35);
    centred(
      b,
      912 + rng.signed(30),
      498 + rng.signed(12),
      ang,
      rng.range(26, 44),
      rng.range(9, 13),
      rng.signed(0.15),
      rng.pick(SCARF),
      0.92,
      0.5,
    );
  }
  b.stroke(888, 508, 2.45, 46, 10, 0.12, SCARF[2], 0.9, 0.4);

  // head: hair, a shadowed face with a few dabs for features, small dark bonnet
  // hair framing the face (dark at the temples, a bun behind)
  for (let i = 0; i < 14; i++) {
    const side = rng.chance(0.5) ? -1 : 1;
    centred(
      b,
      902 + side * rng.range(22, 46),
      345 + rng.signed(22),
      Math.PI / 2 + rng.signed(0.5),
      rng.range(26, 44),
      rng.range(11, 16),
      rng.signed(0.2),
      rng.pick(HAIR),
      0.92,
      0.4,
    );
  }
  b.dab(962, 328, 24, 0.5, HAIR[1], 0.92);
  // face: lit cheek on the left, warm shadow on the right and under the brim
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = hex(SKIN[1]);
  ctx.beginPath();
  ctx.ellipse(904, 392, 45, 53, 0.1, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 20; i++) {
    const fx = rng.signed(1);
    const fy = rng.signed(1);
    if (fx * fx + fy * fy > 1.1) continue;
    const lit = fx < 0.05 && fy > -0.55;
    const col = lit
      ? rng.pick([SKIN[2], hexLab("#c8a080"), hexLab("#d2ab8a")])
      : rng.pick([SKIN[0], SKIN[3], SKIN[1]]);
    b.dab(904 + fx * 30, 394 + fy * 42, rng.range(12, 18), 1.4 + rng.signed(0.3), col, 0.88);
  }
  b.dab(902, 342, 30, 0, SKIN[3], 0.55);
  b.dab(888, 380, 7, 0, hexLab("#5a4436"), 0.55);
  b.dab(921, 378, 7, 0, hexLab("#5a4436"), 0.55);
  b.dab(893, 406, 10, 0.4, hexLab("#c88a74"), 0.45);
  b.dab(905, 424, 8, 0, hexLab("#8a5a4c"), 0.45);
  // small soft bonnet
  for (let i = 0; i < 8; i++) {
    centred(
      b,
      936 + rng.signed(52),
      306 + rng.signed(6),
      rng.signed(0.12),
      rng.range(44, 76),
      rng.range(11, 15),
      rng.signed(0.08),
      rng.pick(HAT),
      0.92,
      0.6,
    );
  }
  for (let i = 0; i < 7; i++) {
    centred(
      b,
      930 + rng.signed(30),
      284 + rng.signed(10),
      rng.signed(0.4),
      rng.range(28, 46),
      rng.range(13, 19),
      rng.signed(0.1),
      rng.pick(HAT),
      0.92,
      0.6,
    );
  }
  centred(b, 934, 274, -0.1, 56, 10, 0.05, hexLab("#a5b6c6"), 0.75, 0);

  // veil: translucent strokes wrapping the face and streaming downwind
  for (let i = 0; i < 22; i++) {
    const across = rng.chance(0.35);
    const x = across ? rng.range(870, 950) : rng.range(945, 1010);
    const y = across ? rng.range(330, 430) : rng.range(285, 380);
    const ang = across ? rng.range(-0.1, 0.35) : rng.range(-0.15, 0.8);
    const col = rng.chance(0.25) ? hexLab("#c9d4e2") : hexLab("#f4f1e6");
    b.stroke(
      x,
      y,
      ang,
      rng.range(60, 140),
      rng.range(7, 14),
      rng.signed(0.18),
      col,
      across ? rng.range(0.1, 0.22) : rng.range(0.3, 0.55),
      0.4,
    );
  }
  yield;

  // parasol shaft, then the hand gripping it
  const [scx, scy] = CANOPY_CENTER;
  const shaftAng = Math.atan2(700 - scy, 826 - scx);
  const shaftLen = Math.hypot(826 - scx, 700 - scy);
  b.stroke(scx, scy, shaftAng, shaftLen, 8, 0.004, SHAFT[0], 0.95, 0);
  b.stroke(scx - 2, scy, shaftAng, shaftLen * 0.9, 3, 0.004, hexLab("#b38c58"), 0.8, 0);
  for (let i = 0; i < 6; i++)
    b.dab(
      820 + rng.signed(8),
      618 + rng.signed(16),
      rng.range(11, 16),
      1.2,
      rng.pick([SKIN[2], hexLab("#b8806a"), SKIN[1]]),
      0.92,
    );
}

function* paintChild(b: Brush): Gen {
  const { ctx, rng } = b;
  fillPoly(ctx, CHILD_BODY, "#5584a8", 1);
  yield* strokesIn(rng, CHILD_BODY, 80, (x, y, u, v) => {
    const tone = 0.8 - 0.65 * u - 0.12 * v + rng.signed(0.16);
    const col = rng.chance(0.1) ? rng.pick(LAVENDER) : rampAt(CHILD, tone);
    const ang = Math.PI / 2 + 0.2 + rng.signed(0.4);
    centred(b, x, y, ang, rng.range(30, 55), rng.range(11, 17), rng.signed(0.12), col, 0.9);
  });
  // arms hanging at the sides
  band(b, 360, 1200, 346, 1300, 26, 2, () => rampAt(CHILD, rng.range(0.6, 0.95)), 0.9);
  band(b, 506, 1200, 520, 1300, 26, 2, () => rampAt(CHILD, rng.range(0.1, 0.4)), 0.9);
  // white collar and a dark bow
  b.dab(418, 1178, 14, 0.3, hexLab("#e8ece4"), 0.85);
  b.dab(448, 1178, 14, -0.3, hexLab("#dfe6e2"), 0.85);
  b.dab(433, 1186, 10, 0, hexLab("#25466e"), 0.9);
  // pink face
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = hex(CHILD_FACE[0]);
  ctx.beginPath();
  ctx.ellipse(433, 1140, 30, 34, 0, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 9; i++)
    b.dab(
      433 + rng.signed(16),
      1142 + rng.signed(18),
      rng.range(9, 14),
      rng.signed(1),
      rng.pick(CHILD_FACE),
      0.85,
    );
  b.dab(422, 1136, 4, 0, hexLab("#4a3a40"), 0.8);
  b.dab(445, 1136, 4, 0, hexLab("#4a3a40"), 0.8);
  // straw hat: domed crown, red band, a brim turned down at the sides
  ctx.fillStyle = hex(STRAW[0]);
  ctx.beginPath();
  ctx.ellipse(433, 1102, 66, 19, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(433, 1086, 40, 26, 0, Math.PI, TAU);
  ctx.fill();
  for (let i = 0; i < 10; i++) {
    centred(
      b,
      372 + i * 13 + rng.signed(4),
      1104 + rng.signed(5),
      rng.signed(0.2),
      rng.range(24, 38),
      rng.range(9, 13),
      rng.signed(0.15),
      rng.pick(STRAW),
      0.92,
      0.5,
    );
  }
  for (let i = 0; i < 6; i++) {
    centred(
      b,
      408 + i * 10,
      1076 + rng.signed(6),
      -0.2 + rng.signed(0.4),
      rng.range(18, 28),
      rng.range(9, 13),
      0,
      rng.pick(STRAW),
      0.92,
      0.5,
    );
  }
  for (let i = 0; i < 4; i++)
    centred(b, 406 + i * 18, 1093 + rng.signed(2), rng.signed(0.1), 26, 9, 0, rng.pick(HAT_BAND), 0.92, 0);
  centred(b, 433, 1116, 0, 110, 6, -0.06, hexLab("#9a8658"), 0.5, 0);
  yield;
}

function* paintGround(ctx: Ctx, L: Layout, seed: number): Gen {
  const rng = new Rng(hashInt(seed, 202));
  const brush = new Brush(ctx, rng);
  const { w, h, bu, dpr } = L;
  const setCss = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    brush.scale = dpr;
  };
  setCss();
  ctx.lineCap = "round";
  const patch = grassLight(L, seed);
  const depthAt = (x: number, y: number) => {
    const r = ridgeAt(L, x);
    return clamp((y - r) / Math.max(1, h - r), 0, 1);
  };

  // underpainting: olive crest fading into deep green
  const grad = ctx.createLinearGradient(0, L.ridgeMin, 0, h);
  grad.addColorStop(0, "#7a7d44");
  grad.addColorStop(0.18, "#5e6a2e");
  grad.addColorStop(0.55, "#42572a");
  grad.addColorStop(1, "#2e4426");
  ctx.fillStyle = grad;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= Math.ceil(w); x += 4) ctx.lineTo(x, ridgeAt(L, x) + bu * 0.8);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  const grassArea = w * (h - (L.ridgeMin + L.ridgeMax) / 2);
  // broad dark blocking-in
  const nBlock = Math.round(grassArea / (bu * bu * 6));
  for (let i = 0; i < nBlock; i++) {
    const x = rng.next() * w;
    const y = rng.range(ridgeAt(L, x) + bu, h + bu);
    const d = depthAt(x, y);
    const p = patch(x, y) + rng.signed(0.3);
    const col =
      p < -0.45
        ? rng.pick(GRASS.deep)
        : p < -0.05
          ? rng.pick(GRASS.dark)
          : rng.chance(0.2)
            ? rng.pick(GRASS.earth)
            : rng.pick(GRASS.mid);
    const ang = -Math.PI / 2 + rng.range(0.3, 0.9);
    brush.stroke(
      x,
      y,
      ang,
      bu * rng.range(2.5, 5) * (0.6 + d),
      bu * rng.range(1.2, 2.2) * (0.6 + d),
      rng.signed(0.1),
      col,
      rng.range(0.45, 0.75),
      0.5,
    );
    if ((i & 31) === 31) yield;
  }

  // figures stand behind the crest grass, so they come next
  const figure = (ox: number, oy: number) => {
    ctx.setTransform(dpr * L.k, 0, 0, dpr * L.k, dpr * ox, dpr * oy);
    brush.scale = dpr * L.k;
  };
  figure(L.cx, L.cy);
  yield* paintChild(brush);
  figure(L.tx, L.ty);
  yield* paintWoman(brush);
  setCss();

  // the field: thousands of short strokes leaning with the wind, small at the crest, big in front
  const nGrass = Math.round(grassArea / (bu * bu * 0.95));
  for (let i = 0; i < nGrass; i++) {
    const x = rng.next() * w;
    const r = ridgeAt(L, x);
    const y = rng.range(r - bu * 0.4, h + bu);
    const d = depthAt(x, y);
    const sc = 0.5 + 1.0 * d;
    const p = patch(x, y);
    const col = grassColor(rng, p, d);
    const r2 = rng.next();
    const lean = r2 < 0.12 ? -rng.range(0, 0.45) : r2 < 0.22 ? rng.range(0.9, 1.35) : rng.range(0.15, 0.85);
    const ang = -Math.PI / 2 + lean + p * 0.12;
    const len = bu * rng.range(1.3, 2.7) * sc;
    const wid = bu * rng.range(0.4, 0.75) * sc;
    brush.stroke(x, y, ang, len, wid, 0.04 + rng.signed(0.12), col, rng.range(0.7, 0.95), 0.7);
    if ((i & 31) === 31) yield;
  }

  // flowers: yellow dabs clustered along the crest and around the figures
  const flowerSeed = hashInt(seed, 43);
  const nFlowers = Math.round(grassArea / (bu * bu * 3));
  for (let i = 0; i < nFlowers; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const r = ridgeAt(L, x);
    const y = r - bu * 0.8 + Math.pow(rng.next(), 2.6) * (h - r) * 0.65;
    const d = depthAt(x, y);
    const cluster = fbm(x / (bu * 5), y / (bu * 3), flowerSeed, 0, 2) + (d < 0.2 ? 0.2 : 0);
    if (cluster < 0.06 || patch(x, y) < -0.4 || rng.chance(0.3)) continue;
    const sz = bu * (0.3 + 0.45 * d) * rng.range(0.8, 1.3);
    const col = rng.chance(0.1) ? hexLab("#f2f0dc") : rng.pick(GRASS.flower);
    const nDab = 2 + rng.int(2);
    for (let j = 0; j < nDab; j++) {
      centred(
        brush,
        x + rng.signed(sz * 0.8),
        y + rng.signed(sz * 0.5),
        rng.signed(Math.PI),
        sz * rng.range(0.9, 1.6),
        sz * rng.range(0.6, 0.9),
        rng.signed(0.2),
        col,
        rng.range(0.75, 0.95),
        0.4,
      );
    }
  }

  // light accents last: sunlit tips near the crest
  const nTips = Math.round(nGrass * 0.18);
  for (let i = 0; i < nTips; i++) {
    if ((i & 31) === 31) yield;
    const x = rng.next() * w;
    const r = ridgeAt(L, x);
    const y = r - bu * 0.6 + Math.pow(rng.next(), 2) * (h - r);
    if (patch(x, y) < -0.3) continue;
    const d = depthAt(x, y);
    const sc = 0.5 + 1.0 * d;
    const col = rng.chance(0.25) ? rng.pick(GRASS.pale) : rng.pick(GRASS.sun);
    brush.stroke(
      x,
      y,
      -Math.PI / 2 + rng.range(0.3, 0.8),
      bu * rng.range(1.2, 2.4) * sc,
      bu * rng.range(0.25, 0.5) * sc,
      0.05,
      col,
      rng.range(0.7, 0.9),
      0.5,
    );
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

/* ------------------------------------------------------------------ motion layer */

interface Group {
  color: string;
  alpha: number;
  start: number;
  end: number;
}

interface Flutter {
  x: number;
  y: number;
  ang: number;
  len: number;
  wid: number;
  bend: number;
  amp: number;
  freq: number;
  phase: number;
  color: string;
  alpha: number;
}

/** A canvas covering only the part of the scene that moves (CSS px). */
interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Motion {
  dpr: number;
  k: number;
  tx: number;
  ty: number;
  bx: Float32Array;
  by: Float32Array;
  len: Float32Array;
  hw: Float32Array;
  lean: Float32Array;
  flex: Float32Array;
  phase: Float32Array;
  bloom: Float32Array;
  tipX: Float32Array;
  tipY: Float32Array;
  order: Uint16Array;
  groups: Group[];
  flowerOrder: Uint16Array;
  flowerGroups: Group[];
  /** Skirt-edge strokes, drawn into the grass pane behind the blades. */
  hem: Flutter[];
  veil: Flutter[];
  grassPane: Pane;
  veilPane: Pane;
}

const BLADE_COLORS: [string, number][] = [
  ["#1c4228", 0.85],
  ["#2a4c30", 0.85],
  ["#2f5a38", 0.85],
  ["#3f6420", 0.85],
  ["#5a6a24", 0.85],
  ["#66702a", 0.85],
  ["#78783c", 0.85],
  ["#8a3a30", 0.8],
  ["#6c4a7e", 0.8],
  ["#5f8690", 0.8],
  ["#9a9878", 0.8],
  ["#8c8a14", 0.88],
  ["#a19a32", 0.88],
  ["#aaa848", 0.85],
  ["#b6b468", 0.8],
];
const FLOWER_COLORS: [string, number][] = [
  ["#ddc93e", 0.92],
  ["#ecdc6a", 0.92],
  ["#f3ecb4", 0.85],
];

function bladeColorIndex(rng: Rng, patch: number, depth: number): number {
  if (rng.chance(0.015)) return 7 + rng.int(2);
  if (depth < 0.15 && rng.chance(0.3)) return 9 + rng.int(2);
  const sun = patch * 1.1 + (0.25 - depth) * 0.35 + rng.signed(0.35);
  if (sun > 0.6) return 13 + rng.int(2);
  if (sun > 0.27) return 11 + rng.int(2);
  if (sun > -0.16) return 4 + rng.int(3);
  if (sun > -0.49) return 2 + rng.int(2);
  return rng.int(2);
}

/** Bounding box (CSS px) of everything a set of flutter strokes can reach. */
function flutterBounds(L: Layout, set: Flutter[]): Pane {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of set) {
    const r = f.len * 1.1 + f.wid;
    x0 = Math.min(x0, f.x - r);
    y0 = Math.min(y0, f.y - r);
    x1 = Math.max(x1, f.x + r);
    y1 = Math.max(y1, f.y + r);
  }
  const x = Math.floor(L.tx + x0 * L.k) - 1;
  const y = Math.floor(L.ty + y0 * L.k) - 1;
  return { x, y, w: Math.ceil(L.tx + x1 * L.k) + 1 - x, h: Math.ceil(L.ty + y1 * L.k) + 1 - y };
}

function buildMotion(L: Layout, seed: number): Motion {
  const rng = new Rng(hashInt(seed, 303));
  const { w, h, bu } = L;
  const patch = grassLight(L, seed);
  type Blade = [number, number, number, number, number, number, number, number, number];
  const blades: Blade[] = [];
  const feetX = L.tx + REF_FEET_X * L.k;
  const skirtL = L.tx + 600 * L.k;
  const skirtR = L.tx + 1140 * L.k;
  const childX = L.cx + REF_CHILD_X * L.k;

  // tall blades along the crest, silhouetted against the sky and the dress
  const nFringe = Math.round(w / 4.2);
  for (let i = 0; i < nFringe; i++) {
    const x = rng.next() * w;
    const y = ridgeAt(L, x) + bu * rng.range(-0.1, 1.3);
    // keep the hem and the child readable: shorter grass right in front of them
    const inFront = (x > skirtL && x < skirtR) || Math.abs(x - childX) < 70 * L.k;
    const len = bu * rng.range(1.3, 3.0) * (inFront ? 0.7 : 1);
    const flower = rng.chance(x > skirtL - bu * 6 && x < feetX + bu * 4 ? 0.3 : 0.12)
      ? bu * rng.range(0.22, 0.34)
      : 0;
    blades.push([
      x,
      y,
      len,
      bu * rng.range(0.22, 0.38),
      rng.range(0.12, 0.5),
      rng.range(0.16, 0.34),
      rng.next() * TAU,
      flower,
      bladeColorIndex(rng, patch(x, y), 0),
    ]);
  }
  // blades spread through the field
  const area = w * (h - L.ridgeMin);
  const nField = Math.min(240, Math.round(area / (bu * bu * 11)));
  for (let i = 0; i < nField; i++) {
    const x = rng.next() * w;
    const r = ridgeAt(L, x);
    const y = r + bu + rng.next() * (h - r);
    const d = clamp((y - r) / Math.max(1, h - r), 0, 1);
    const sc = 0.55 + 1.1 * d;
    const flower = rng.chance(0.1 * (1 - d)) ? bu * rng.range(0.24, 0.36) * sc : 0;
    blades.push([
      x,
      y,
      bu * rng.range(1.5, 3.0) * sc,
      bu * rng.range(0.2, 0.34) * sc,
      rng.range(0.3, 0.7),
      rng.range(0.1, 0.24),
      rng.next() * TAU,
      flower,
      bladeColorIndex(rng, patch(x, y), d),
    ]);
  }

  // veil strands and the leeward edge of the hem flutter a little (reference px)
  const veil: Flutter[] = [];
  for (let i = 0; i < 5; i++) {
    veil.push({
      x: 975 + rng.range(0, 26),
      y: 296 + i * 14 + rng.signed(4),
      ang: 0.05 + i * 0.12 + rng.signed(0.06),
      len: rng.range(70, 120),
      wid: rng.range(7, 12),
      bend: rng.range(-0.12, 0.02),
      amp: rng.range(0.07, 0.13),
      freq: rng.range(2.2, 3.4),
      phase: rng.next() * TAU,
      color: "#f6f3ea",
      alpha: rng.range(0.3, 0.48),
    });
  }
  const hem: Flutter[] = [];
  const hemPts = [1134, 1150, 1130, 1200, 1124, 1245, 1114, 1285];
  for (let i = 0; i < hemPts.length; i += 2) {
    hem.push({
      x: hemPts[i] - 24,
      y: hemPts[i + 1],
      ang: 0.45 + i * 0.06 + rng.signed(0.15),
      len: rng.range(34, 50),
      wid: rng.range(11, 16),
      bend: rng.signed(0.1),
      amp: rng.range(0.05, 0.09),
      freq: rng.range(1.6, 2.4),
      phase: rng.next() * TAU,
      color: rng.chance(0.4) ? "#958cc0" : rng.pick(["#8fa4bf", "#a9bccb", "#7d95b3"]),
      alpha: rng.range(0.8, 0.92),
    });
  }

  const n = blades.length;
  let top = flutterBounds(L, hem).y;
  const colorOf = new Uint8Array(n);
  const flowerColor: number[] = [];
  const m: Motion = {
    dpr: L.dpr,
    k: L.k,
    tx: L.tx,
    ty: L.ty,
    bx: new Float32Array(n),
    by: new Float32Array(n),
    len: new Float32Array(n),
    hw: new Float32Array(n),
    lean: new Float32Array(n),
    flex: new Float32Array(n),
    phase: new Float32Array(n),
    bloom: new Float32Array(n),
    tipX: new Float32Array(n),
    tipY: new Float32Array(n),
    order: new Uint16Array(n),
    groups: [],
    flowerOrder: new Uint16Array(0),
    flowerGroups: [],
    hem,
    veil,
    grassPane: { x: 0, y: 0, w: 0, h: 0 },
    veilPane: flutterBounds(L, veil),
  };
  blades.forEach((b, i) => {
    m.bx[i] = b[0];
    m.by[i] = b[1];
    m.len[i] = b[2];
    m.hw[i] = b[3];
    m.lean[i] = b[4];
    m.flex[i] = b[5];
    m.phase[i] = b[6];
    m.bloom[i] = b[7];
    colorOf[i] = b[8];
    flowerColor[i] = b[7] > 0 ? rng.int(FLOWER_COLORS.length) : -1;
    top = Math.min(top, b[1] - b[2] - b[3] - b[7] * 1.5);
  });
  const fill = (order: Uint16Array, palette: [string, number][], key: (i: number) => number) => {
    const groups: Group[] = [];
    let p = 0;
    for (let c = 0; c < palette.length; c++) {
      const start = p;
      for (let i = 0; i < n; i++) if (key(i) === c) order[p++] = i;
      if (p > start) groups.push({ color: palette[c][0], alpha: palette[c][1], start, end: p });
    }
    return groups;
  };
  m.groups = fill(m.order, BLADE_COLORS, (i) => colorOf[i]);
  m.flowerOrder = new Uint16Array(flowerColor.filter((c) => c >= 0).length);
  m.flowerGroups = fill(m.flowerOrder, FLOWER_COLORS, (i) => flowerColor[i]);
  const paneTop = Math.max(0, Math.floor(top - 2));
  m.grassPane = { x: 0, y: paneTop, w, h: h - paneTop };
  return m;
}

function drawFlutter(ctx: Ctx, m: Motion, pane: Pane, list: Flutter[], t: number): void {
  const d = m.dpr;
  ctx.setTransform(d * m.k, 0, 0, d * m.k, d * (m.tx - pane.x), d * (m.ty - pane.y));
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const ang = f.ang + f.amp * Math.sin(t * f.freq + f.phase);
    const bend = f.bend + f.amp * 0.9 * Math.sin(t * f.freq * 1.37 + f.phase + 1.1);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const x2 = f.x + dx * f.len;
    const y2 = f.y + dy * f.len;
    const cx = (f.x + x2) * 0.5 - dy * bend * f.len;
    const cy = (f.y + y2) * 0.5 + dx * bend * f.len;
    const hw = f.wid * 0.72;
    ctx.globalAlpha = f.alpha;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(f.x - dy * hw * 0.6, f.y + dx * hw * 0.6);
    ctx.quadraticCurveTo(cx - dy * hw, cy + dx * hw, x2, y2);
    ctx.quadraticCurveTo(cx + dy * hw, cy - dx * hw, f.x + dy * hw * 0.6, f.y - dx * hw * 0.6);
    ctx.closePath();
    ctx.fill();
  }
}

/** Repaints both motion panes for time t (seconds). Allocation-free. */
function drawMotion(grass: Ctx, veil: Ctx, m: Motion, t: number): void {
  const d = m.dpr;
  const pane = m.grassPane;
  grass.setTransform(1, 0, 0, 1, 0, 0);
  grass.clearRect(0, 0, grass.canvas.width, grass.canvas.height);
  drawFlutter(grass, m, pane, m.hem, t);

  // grass blades bend from the base; a gust envelope travels left → right across the field
  grass.setTransform(d, 0, 0, d, -pane.x * d, -pane.y * d);
  const { bx, by, len, hw, lean, flex, phase, tipX, tipY, order } = m;
  for (let g = 0; g < m.groups.length; g++) {
    const grp = m.groups[g];
    grass.globalAlpha = grp.alpha;
    grass.fillStyle = grp.color;
    for (let j = grp.start; j < grp.end; j++) {
      const i = order[j];
      const x = bx[i];
      const y = by[i];
      const l = len[i] * 0.5;
      const h = hw[i];
      const tt = t - x * 0.008;
      const gust = 0.6 + 0.26 * Math.sin(tt * 0.57) + 0.14 * Math.sin(tt * 1.37 + 0.8);
      const sway = Math.sin(t * 2.05 - x * 0.034 + phase[i]);
      const a1 = lean[i] + flex[i] * gust * (0.55 + 0.45 * sway);
      const a0 = lean[i] * 0.8 + (a1 - lean[i]) * 0.3;
      const s0 = Math.sin(a0);
      const c0 = Math.cos(a0);
      const s1 = Math.sin(a1);
      const c1 = Math.cos(a1);
      const ex = x + (s0 + s1) * l;
      const ey = y - (c0 + c1) * l;
      // the blade's bent centre line, as a two-segment polygon (cheap to rasterise)
      const qx = x + (s0 * 0.75 + s1 * 0.25) * l;
      const qy = y - (c0 * 0.75 + c1 * 0.25) * l;
      const nx = (c0 + c1) * 0.5 * h * 0.75;
      const ny = (s0 + s1) * 0.5 * h * 0.75;
      // one small path per blade: a software rasteriser handles many small fills faster than one
      // huge path spanning the whole pane
      grass.beginPath();
      grass.moveTo(x - c0 * h, y - s0 * h);
      grass.lineTo(qx - nx, qy - ny);
      grass.lineTo(ex - c1 * h * 0.3, ey - s1 * h * 0.3);
      grass.lineTo(ex + c1 * h * 0.3, ey + s1 * h * 0.3);
      grass.lineTo(qx + nx, qy + ny);
      grass.lineTo(x + c0 * h, y + s0 * h);
      grass.fill();
      tipX[i] = ex;
      tipY[i] = ey;
    }
  }
  const bloom = m.bloom;
  for (let g = 0; g < m.flowerGroups.length; g++) {
    const grp = m.flowerGroups[g];
    grass.globalAlpha = grp.alpha;
    grass.fillStyle = grp.color;
    for (let j = grp.start; j < grp.end; j++) {
      const i = m.flowerOrder[j];
      // a little four-sided dab riding on the blade tip
      const rr = bloom[i];
      const cx = Math.cos(phase[i]) * rr;
      const cy = Math.sin(phase[i]) * rr;
      const x = tipX[i];
      const y = tipY[i];
      grass.beginPath();
      grass.moveTo(x + cx, y + cy);
      grass.lineTo(x - cy * 0.6, y + cx * 0.6);
      grass.lineTo(x - cx, y - cy);
      grass.lineTo(x + cy * 0.6, y - cx * 0.6);
      grass.fill();
    }
  }
  grass.globalAlpha = 1;

  veil.setTransform(1, 0, 0, 1, 0, 0);
  veil.clearRect(0, 0, veil.canvas.width, veil.canvas.height);
  drawFlutter(veil, m, m.veilPane, m.veil, t);
  veil.globalAlpha = 1;
}

/* ------------------------------------------------------------------ engine */

interface Buffers {
  sky: HTMLCanvasElement;
  ground: HTMLCanvasElement;
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
  if (!sky || !ground) return;
  bufs.active = sky;
  yield* paintSky(sky, L, seed);
  yield "sky";
  bufs.active = ground;
  yield* paintGround(ground, L, seed);
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
  options: { seed: number; paused: boolean },
): MeadowEngine {
  const { root } = els;
  const seed = options.seed >>> 0;
  let paused = options.paused;
  let visible = true;
  let destroyed = false;
  const mql =
    typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduced = mql ? mql.matches : false;
  // contexts are taken on first use: nothing touches a canvas until the element has a size
  let grassCtx: Ctx | null = null;
  let veilCtx: Ctx | null = null;

  let current: { L: Layout; motion: Motion } | null = null;
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

  const render = () => {
    if (!current || !grassCtx || !veilCtx) return;
    drawMotion(grassCtx, veilCtx, current.motion, reduced ? STILL_TIME : time);
    // the clouds move a fraction of a pixel per frame: restyling them at ~10 Hz is enough
    if (frameCount++ % 3 === 0) placeSky(current.L);
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

  const commitRest = (L: Layout, ground: Shown, grain: Buffers["grain"]) => {
    show(els.ground, ground, Math.round(L.w * L.dpr), Math.round(L.h * L.dpr));
    els.ground.dataset.ready = "";
    if (grain) applyGrain(grain.tile, grain.cssSize);
    const motion = buildMotion(L, seed);
    placePane(els.motion, motion.grassPane, L.dpr);
    placePane(els.veil, motion.veilPane, L.dpr);
    els.motion.dataset.ready = "";
    els.veil.dataset.ready = "";
    grassCtx ??= els.motion.getContext("2d");
    veilCtx ??= els.veil.getContext("2d");
    current = { L, motion };
    render();
    root.dataset.state = "ready";
    update();
  };

  const generate = (w: number, h: number) => {
    job?.cancel();
    const dpr = pickDpr(w, h);
    const L = computeLayout(w, h, dpr, seed);
    const progressive = current === null;
    const bufs: Buffers = {
      sky: makeCanvas(L.tilePx, Math.round(L.skyH * dpr)),
      ground: makeCanvas(Math.round(w * dpr), Math.round(h * dpr)),
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
          void Promise.all([skyDone, snapshot(bufs.ground)]).then(([s, g]) => {
            if (!live()) {
              if (!progressive) discard(s);
              discard(g);
              if (grain) release(grain.tile);
              return;
            }
            if (!progressive) commitSky(L, s);
            commitRest(L, g, grain);
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
    render();
    if (current) placeSky(current.L);
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
      current = null;
      for (const el of [els.sky, els.ground, els.motion, els.veil]) {
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
