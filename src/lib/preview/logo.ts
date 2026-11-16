/**
 * Logo analysis (pure JS, works on Vercel): find the logo's own background,
 * trim its padding, and decide how to show it on light and dark surfaces.
 *
 * Treatments, per surface:
 * - plain:     the logo as is (transparent logos with enough contrast)
 * - multiply:  light surfaces + a light background box: mix-blend-mode multiply hides the box
 * - knockout:  single-color marks are recolored white (dark surfaces) or black (light surfaces)
 * - plate:     a rounded badge in the logo's own background color, so the box looks intentional
 * - reversed:  transparent multi-color logos get a second copy for dark (or light) surfaces where only the
 *              parts that would disappear are recolored (e.g. navy lettering → white, a red accent stays red)
 */
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { contrast, isHex, luminance } from "./design.ts";
import type { LogoMeta } from "./types.ts";

type Raster = { width: number; height: number; data: Buffer | Uint8Array };

function decode(bytes: Buffer, type: string): Raster | undefined {
  try {
    if (type === "image/png") {
      const png = PNG.sync.read(bytes);
      return { width: png.width, height: png.height, data: png.data };
    }
    if (type === "image/jpeg") {
      const img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 64, maxResolutionInMP: 16 });
      return { width: img.width, height: img.height, data: img.data };
    }
  } catch {
    // unreadable
  }
  return undefined;
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const dist = (d: Raster["data"], i: number, c: [number, number, number]) => Math.hypot(d[i]! - c[0], d[i + 1]! - c[1], d[i + 2]! - c[2]);

export type LogoAnalysis = { meta: LogoMeta; png?: Buffer; darkPng?: Buffer; lightPng?: Buffer };

const DARK_REF: [number, number, number] = [20, 20, 22];
const LIGHT_REF: [number, number, number] = [250, 248, 244];

function lum(r: number, g: number, b: number): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * A copy of a transparent logo for a dark (or light) surface: pixels that would vanish are recolored
 * white (or near-black); everything that already reads well keeps its brand color. Undefined if not needed.
 */
function reversedCopy(img: Raster, surface: [number, number, number], to: [number, number, number]): Raster | undefined {
  const d = img.data;
  const sl = lum(...surface);
  let visible = 0;
  let poor = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 60) continue;
    visible += 1;
    if (ratio(lum(d[i]!, d[i + 1]!, d[i + 2]!), sl) < 2.6) poor += 1;
  }
  if (!visible || poor / visible < 0.12) return undefined;
  const out = Buffer.from(d);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3]! === 0) continue;
    if (ratio(lum(out[i]!, out[i + 1]!, out[i + 2]!), sl) < 2.6) {
      out[i] = to[0];
      out[i + 1] = to[1];
      out[i + 2] = to[2];
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/** Analyse a logo file. Returns the metadata and (when readable) a trimmed PNG to store as image "logo". */
export function analyzeLogo(bytes: Buffer, type: string): LogoAnalysis {
  const img = decode(bytes, type);
  if (!img || img.width < 8 || img.height < 8 || img.width * img.height > 6_000_000) return { meta: { bg: "unknown" } };
  const { width: w, height: h, data } = img;
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.02));
  let transparent = 0;
  let opaque = 0;
  const sum = [0, 0, 0];
  const border: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      border.push(i);
      if (data[i + 3]! < 40) transparent += 1;
      else if (data[i + 3]! >= 200) {
        opaque += 1;
        sum[0] += data[i]!;
        sum[1] += data[i + 1]!;
        sum[2] += data[i + 2]!;
      }
    }
  }
  const total = border.length;
  let kind: LogoMeta["bg"];
  let bg: [number, number, number] | undefined;
  // Logos often touch their own edges, so "mostly transparent border, plenty of transparency overall" counts too.
  let clear = 0;
  for (let i = 3; i < data.length; i += 16) if (data[i]! < 40) clear += 1;
  const clearShare = clear / Math.ceil(data.length / 16);
  if (transparent / total >= 0.8 || (transparent / total >= 0.4 && clearShare >= 0.25)) kind = "transparent";
  else if (opaque / total >= 0.8) {
    bg = [sum[0]! / opaque, sum[1]! / opaque, sum[2]! / opaque];
    const close = border.filter((i) => data[i + 3]! >= 200 && dist(data, i, bg!) < 28).length;
    kind = close / total >= 0.85 ? "solid" : "complex";
  } else kind = "complex";

  // The mark: pixels that are visible and clearly different from the background.
  let fgCount = 0;
  let neutral = 0;
  const fgSum = [0, 0, 0];
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (data[i + 3]! < 128) continue;
      if (bg && dist(data, i, bg) < 60) continue;
      if (kind === "complex") continue;
      fgCount += 1;
      fgSum[0] += data[i]!;
      fgSum[1] += data[i + 1]!;
      fgSum[2] += data[i + 2]!;
      const sat = (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!)) / 255;
      if (sat < 0.18) neutral += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const meta: LogoMeta = { bg: kind };
  if (bg) meta.bgColor = hex(...bg);
  if (fgCount) {
    meta.fg = hex(fgSum[0]! / fgCount, fgSum[1]! / fgCount, fgSum[2]! / fgCount);
    meta.mono = neutral / fgCount >= 0.9;
  }
  if (kind === "complex" || !fgCount) return { meta, png: encode(img, 0, 0, w, h) };

  // Trim the logo's own padding (keep a little air), so every treatment spaces it consistently.
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(w - 1, maxX + pad);
  const y1 = Math.min(h - 1, maxY + pad);
  const cropped = crop(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  if (kind === "solid" && bg && (meta.mono || lum(...bg) > 0.8)) {
    // A plain white/light box (or any plain box behind a one-color mark): key the box out, counters inside letters too.
    keyOut(cropped, bg);
    meta.bg = "cleared";
  }
  const result: LogoAnalysis = { meta, png: encode(cropped, 0, 0, cropped.width, cropped.height) };
  if ((meta.bg === "transparent" || meta.bg === "cleared") && !meta.mono) {
    const dark = reversedCopy(cropped, DARK_REF, [255, 255, 255]);
    const light = reversedCopy(cropped, LIGHT_REF, [17, 17, 17]);
    if (dark) result.darkPng = encode(dark, 0, 0, dark.width, dark.height);
    if (light) result.lightPng = encode(light, 0, 0, light.width, light.height);
  }
  return result;
}

function crop(img: Raster, x0: number, y0: number, cw: number, ch: number): Raster {
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y += 1) {
    const from = ((y + y0) * img.width + x0) * 4;
    out.set(img.data.subarray(from, from + cw * 4), y * cw * 4);
  }
  return { width: cw, height: ch, data: out };
}

/** Make the background color transparent with a soft edge and remove its color fringe. */
function keyOut(img: Raster, bg: [number, number, number]): void {
  const lo = 36;
  const hi = 120;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const dd = dist(d, i, bg);
    if (dd <= lo) d[i + 3] = 0;
    else if (dd < hi) {
      const a = (dd - lo) / (hi - lo);
      for (let c = 0; c < 3; c += 1) d[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c]! - bg[c]! * (1 - a)) / a)));
      d[i + 3] = Math.round(d[i + 3]! * a);
    }
  }
}

function encode(img: Raster, x: number, y: number, w: number, h: number): Buffer | undefined {
  try {
    const source = x || y || w !== img.width || h !== img.height ? crop(img, x, y, w, h) : img;
    const png = new PNG({ width: source.width, height: source.height });
    Buffer.from(source.data.buffer, source.data.byteOffset, source.data.byteLength).copy(png.data);
    return PNG.sync.write(png);
  } catch {
    return undefined;
  }
}

export type LogoTreatment = {
  kind: "plain" | "multiply" | "knockout-white" | "knockout-black" | "plate";
  plate?: string;
  /** Stored image to use instead of the main logo (a reversed copy). */
  image?: string;
};

/** How to show the logo on a surface of the given color. */
export function logoTreatment(meta: LogoMeta | undefined, surface: string): LogoTreatment {
  const dark = luminance(surface) < 0.35;
  const m = meta ?? { bg: "unknown" as const };
  const fg = m.fg && isHex(m.fg) ? m.fg : undefined;
  const bgColor = m.bgColor && isHex(m.bgColor) ? m.bgColor : undefined;
  const fgOk = fg ? contrast(fg, surface) >= 2.6 : false;
  const plate = (color?: string): LogoTreatment => ({ kind: "plate", plate: color ?? (dark ? "#ffffff" : "#111111") });

  if (m.bg === "transparent" || m.bg === "cleared") {
    if (fgOk) return { kind: "plain" };
    if (m.mono) return { kind: dark ? "knockout-white" : "knockout-black" };
    if (dark && m.darkImage) return { kind: "plain", image: m.darkImage };
    if (!dark && m.lightImage) return { kind: "plain", image: m.lightImage };
    return plate(m.bg === "cleared" ? bgColor : undefined);
  }
  if (m.bg === "solid" && bgColor) {
    const boxLight = luminance(bgColor) > 0.6;
    if (!dark && boxLight) return { kind: "multiply" };
    if (contrast(bgColor, surface) < 1.25) return { kind: "plain" };
    return plate(bgColor);
  }
  // Unknown (SVG/WebP, not readable here): multiply hides a white box on light surfaces, a light badge on dark ones.
  // Complex (photo-like background): keep it as is on light surfaces.
  if (dark) return plate("#ffffff");
  return m.bg === "unknown" ? { kind: "multiply" } : { kind: "plain" };
}
