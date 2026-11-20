/**
 * Mock-mode stand-in hero when a photo search finds nothing (PREVIEW_MOCK=1).
 * "Make it yummy" should still replace the current hero with visibly appetizing food-like imagery.
 */
import { PNG } from "pngjs";
import { createHash } from "node:crypto";

const W = 1280;
const H = 720;

function hash(s: string): number {
  const h = createHash("sha1").update(s).digest();
  return h.readUInt32BE(0);
}

function set(data: Buffer, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = a;
}

function fill(data: Buffer, fn: (x: number, y: number) => [number, number, number]): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fn(x, y);
      set(data, x, y, r, g, b);
    }
  }
}

function disc(data: Buffer, cx: number, cy: number, rx: number, ry: number, color: (dx: number, dy: number, t: number) => [number, number, number]): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const t = dx * dx + dy * dy;
      if (t > 1) continue;
      const [r, g, b] = color(dx, dy, t);
      set(data, x, y, r, g, b);
    }
  }
}

/** A warm, plated-food hero (16:9). Deterministic for a given subject. */
export function standInSubjectPng(subject: string): Buffer {
  const png = new PNG({ width: W, height: H });
  const data = png.data as Buffer;
  const seed = hash(subject.toLowerCase());
  const food = /\b(?:food|dish|meal|yummy|delicious|appetizing|tasty|plate|cuisine)\b/i.test(subject);

  // Table / backdrop: warm wood or kitchen amber for food subjects, cooler otherwise.
  fill(data, (x, y) => {
    const v = (Math.sin((x + seed) * 0.02) + Math.cos(y * 0.03) + 2) / 4;
    if (food) {
      const r = 92 + v * 70 + (y / H) * 40;
      const g = 48 + v * 36 + (y / H) * 20;
      const b = 28 + v * 18;
      return [r, g, b];
    }
    const r = 40 + v * 30;
    const g = 70 + v * 40;
    const b = 90 + v * 40;
    return [r, g, b];
  });

  // Soft window light from the upper left.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const glow = Math.max(0, 1 - Math.hypot((x - 180) / 700, (y - 80) / 500));
      const i = (y * W + x) * 4;
      data[i] = Math.min(255, data[i]! + glow * 50);
      data[i + 1] = Math.min(255, data[i + 1]! + glow * 36);
      data[i + 2] = Math.min(255, data[i + 2]! + glow * 16);
    }
  }

  // Plate
  const cx = W * 0.58;
  const cy = H * 0.55;
  disc(data, cx + 18, cy + 22, 340, 230, () => [70, 38, 22]);
  disc(data, cx, cy, 330, 220, (_dx, _dy, t) => {
    const shade = 1 - t * 0.18;
    return [245 * shade, 236 * shade, 220 * shade];
  });
  disc(data, cx, cy, 290, 190, (_dx, _dy, t) => {
    const shade = 0.96 + (1 - t) * 0.04;
    return [252 * shade, 246 * shade, 232 * shade];
  });

  // Main dish — roasted / tomato-sauced mound
  disc(data, cx - 10, cy + 8, 170, 130, (_dx, dy, t) => {
    const roast = 1 - t * 0.35 + dy * 0.08;
    return [Math.min(255, 176 * roast + 40), Math.min(255, 62 * roast + 18), 36 * roast];
  });
  // Melted cheese highlight
  disc(data, cx + 20, cy - 20, 90, 50, (_dx, _dy, t) => {
    const m = 1 - t * 0.4;
    return [255 * m, 214 * m, 130 * m];
  });
  // Fresh greens
  disc(data, cx + 110, cy + 40, 70, 40, (_dx, _dy, t) => {
    const m = 1 - t * 0.3;
    return [62 * m, 122 * m, 48 * m];
  });
  disc(data, cx - 130, cy + 50, 50, 30, (_dx, _dy, t) => {
    const m = 1 - t * 0.3;
    return [80 * m, 140 * m, 50 * m];
  });
  // Tomato coins
  for (const [tx, ty] of [
    [cx - 60, cy - 40],
    [cx + 70, cy + 10],
    [cx - 20, cy + 70],
  ] as const) {
    disc(data, tx, ty, 28, 20, (_dx, _dy, t) => {
      const m = 1 - t * 0.25;
      return [200 * m, 50 * m, 40 * m];
    });
  }
  // Herb flecks
  const rnd = (n: number) => {
    let x = (seed ^ n) >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(cx - 160 + rnd(i * 3) * 320);
    const y = Math.floor(cy - 100 + rnd(i * 3 + 1) * 220);
    const leaf = rnd(i * 3 + 2) > 0.5;
    set(data, x, y, leaf ? 48 : 210, leaf ? 110 : 70, leaf ? 40 : 30);
    set(data, x + 1, y, leaf ? 48 : 210, leaf ? 110 : 70, leaf ? 40 : 30);
  }

  return PNG.sync.write(png);
}
