/**
 * Round 10b — lettered stand-in PNG logos for tests and PREVIEW_MOCK=1 (no Imagine call).
 * Kept out of the browser bundle: the form only imports the pure helpers in ai-logo.ts.
 */
import { PNG } from "pngjs";
import type { LogoKind } from "./ai-logo";


const FONT_W = 5;
const FONT_H = 7;
/** 5×7 caps, one row per nibble-pack (5 bits × 7 rows) as a 7-digit binary string. */
const FONT: Record<string, string> = {
  A: "01110100011111110001100011000110001",
  B: "11110100011111010001100011000111110",
  C: "01111100001000010000100001000001111",
  D: "11110100011000110001100011000111110",
  E: "11111100001111010000100001000011111",
  F: "11111100001111010000100001000010000",
  G: "01111100001000010011100011000101111",
  H: "10001100011111110001100011000110001",
  I: "11111001000010000100001000010011111",
  J: "00111000100001000010000101001001100",
  K: "10001100101010011000101001001010001",
  L: "10000100001000010000100001000011111",
  M: "10001110111010110101100011000110001",
  N: "10001110011010110011100011000110001",
  O: "01110100011000110001100011000101110",
  P: "11110100011000111110100001000010000",
  Q: "01110100011000110001101011001001101",
  R: "11110100011000111110101001001010001",
  S: "01111100001000001110000011000101110",
  T: "11111001000010000100001000010000100",
  U: "10001100011000110001100011000101110",
  V: "10001100011000110001100010101000100",
  W: "10001100011000110101101011010101010",
  X: "10001100010101000100010101000110001",
  Y: "10001100010101000100001000010000100",
  Z: "11111000010001000100010001000011111",
  "0": "01110100011001110101110011000101110",
  "1": "00100011000010000100001000010011111",
  "2": "01110100010000100010001000100011111",
  "3": "01110100010000101110000011000101110",
  "4": "00010001100101010010111110001000010",
  "5": "11111100001111000001000011000101110",
  "6": "01110100001000011110100011000101110",
  "7": "11111000010001000100010000100001000",
  "8": "01110100011000101110100011000101110",
  "9": "01110100011000101111000011000101110",
  " ": "00000000000000000000000000000000000",
  "-": "00000000000000011111000000000000000",
  ".": "00000000000000000000000000010000100",
  ",": "00000000000000000000000000010001000",
  "'": "00100001000010000000000000000000000",
  "&": "01100100100101001100010100101001011",
  "+": "00000001000010011111001000010000000",
  "/": "00001000100001000100010001000010000",
};

function hueRgb(h: number, s = 0.55, l = 0.38): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
  };
  return [f(0), f(8), f(4)];
}

function hashHue(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % 360;
}

function glyph(ch: string): string {
  const up = ch.toUpperCase();
  return FONT[up] ?? FONT["."]!;
}

function measure(text: string, scale: number, tracking: number): number {
  if (!text) return 0;
  return text.length * (FONT_W * scale + tracking) - tracking;
}

function wrapLines(word: string, maxChars: number): string[] {
  const clean = word.replace(/\s+/g, " ").trim() || "LOGO";
  if (clean.length <= maxChars) return [clean];
  const parts = clean.split(/(\s+|-)/);
  const lines: string[] = [];
  let cur = "";
  for (const part of parts) {
    if ((cur + part).trim().length <= maxChars) cur += part;
    else {
      if (cur.trim()) lines.push(cur.trim());
      cur = part.trimStart();
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 3);
}

function blit(png: PNG, x: number, y: number, text: string, scale: number, color: [number, number, number], tracking = scale) {
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of text) {
    const bits = glyph(ch);
    for (let row = 0; row < FONT_H; row++) {
      for (let col = 0; col < FONT_W; col++) {
        if (bits[row * FONT_W + col] !== "1") continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = cx + col * scale + dx;
            const py = cy + row * scale + dy;
            if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
            const i = (py * png.width + px) << 2;
            png.data[i] = color[0];
            png.data[i + 1] = color[1];
            png.data[i + 2] = color[2];
            png.data[i + 3] = 255;
          }
        }
      }
    }
    cx += FONT_W * scale + tracking;
  }
}

function fillRect(png: PNG, x: number, y: number, w: number, h: number, color: [number, number, number], alpha = 255) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(png.width, Math.round(x + w));
  const y1 = Math.min(png.height, Math.round(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * png.width + px) << 2;
      png.data[i] = color[0];
      png.data[i + 1] = color[1];
      png.data[i + 2] = color[2];
      png.data[i + 3] = alpha;
    }
  }
}

function fillCircle(png: PNG, cx: number, cy: number, r: number, color: [number, number, number]) {
  const r2 = r * r;
  for (let py = Math.max(0, Math.floor(cy - r)); py < Math.min(png.height, Math.ceil(cy + r)); py++) {
    for (let px = Math.max(0, Math.floor(cx - r)); px < Math.min(png.width, Math.ceil(cx + r)); px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) {
        const i = (py * png.width + px) << 2;
        png.data[i] = color[0];
        png.data[i + 1] = color[1];
        png.data[i + 2] = color[2];
        png.data[i + 3] = 255;
      }
    }
  }
}

function initialsOf(word: string): string {
  const parts = word
    .replace(/\.(com|net|org|io|co|ai|biz)$/i, "")
    .split(/[\s.-]+/)
    .filter((p) => /[a-z0-9]/i.test(p));
  const letters = (parts.length >= 2 ? parts.slice(0, 2).map((p) => p[0]) : [word.replace(/[^a-z0-9]/gi, "")[0] ?? "A"]).join("");
  return letters.toUpperCase().slice(0, 2);
}

const SIZE = 512;

/**
 * A readable stand-in PNG for tests and PREVIEW_MOCK=1 (no Imagine call). The business name is lettered on a
 * plain background; each kind and variation looks different.
 */
export function standInLogoPng(word: string, kind: LogoKind, variation = 0): Buffer {
  const text = (word.trim() || "LOGO").slice(0, 60);
  const png = new PNG({ width: SIZE, height: SIZE });
  const hue = hashHue(`${text}:${kind}:${variation}`);
  const ink = hueRgb(hue, 0.45, variation % 2 === 1 && kind === "emblem" ? 0.92 : 0.22);
  const accent = hueRgb((hue + 18) % 360, 0.62, 0.42);
  const bg: [number, number, number] = variation % 2 === 1 && kind === "emblem" ? hueRgb(hue, 0.35, 0.16) : [250, 248, 244];
  fillRect(png, 0, 0, SIZE, SIZE, bg);

  const lines = wrapLines(text, kind === "wordmark" ? 14 : 16);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const scale = Math.max(3, Math.min(kind === "wordmark" ? 8 : 6, Math.floor(360 / (longest * (FONT_W + 1)))));
  const tracking = Math.max(2, Math.round(scale * 0.7));
  const lineH = FONT_H * scale + Math.round(scale * 1.2);
  const blockH = lines.length * lineH - Math.round(scale * 1.2);

  if (kind === "wordmark") {
    const startY = Math.round((SIZE - blockH) / 2 - scale);
    for (let i = 0; i < lines.length; i++) {
      const w = measure(lines[i]!, scale, tracking);
      blit(png, (SIZE - w) / 2, startY + i * lineH, lines[i]!, scale, ink, tracking);
    }
    const barW = Math.min(280, Math.max(80, measure(lines[lines.length - 1]!, scale, tracking)));
    fillRect(png, (SIZE - barW) / 2, startY + blockH + scale * 1.4, barW, Math.max(4, Math.round(scale * 0.45)), accent);
  } else if (kind === "icon_name") {
    const icon = 120;
    const gap = 28;
    const startY = Math.round((SIZE - icon - gap - blockH) / 2);
    const cx = SIZE / 2;
    const cy = startY + icon / 2;
    if (variation % 3 === 1) fillRect(png, cx - icon / 2, cy - icon / 2, icon, icon, accent);
    else if (variation % 3 === 2) {
      const r = icon / 2;
      // diamond
      for (let py = startY; py < startY + icon; py++) {
        for (let px = cx - r; px < cx + r; px++) {
          if (Math.abs(px - cx) + Math.abs(py - cy) <= r) {
            const i = (Math.round(py) * SIZE + Math.round(px)) << 2;
            if (i >= 0 && i < png.data.length) {
              png.data[i] = accent[0];
              png.data[i + 1] = accent[1];
              png.data[i + 2] = accent[2];
              png.data[i + 3] = 255;
            }
          }
        }
      }
    } else fillCircle(png, cx, cy, icon / 2, accent);
    const mono = initialsOf(text);
    const mScale = mono.length > 1 ? 7 : 9;
    const mTrack = Math.round(mScale * 0.6);
    const mw = measure(mono, mScale, mTrack);
    blit(png, (SIZE - mw) / 2, cy - (FONT_H * mScale) / 2, mono, mScale, [255, 255, 255], mTrack);
    for (let i = 0; i < lines.length; i++) {
      const w = measure(lines[i]!, scale, tracking);
      blit(png, (SIZE - w) / 2, startY + icon + gap + i * lineH, lines[i]!, scale, ink, tracking);
    }
  } else {
    const r = 150;
    fillCircle(png, SIZE / 2, SIZE / 2 - 20, r, accent);
    fillCircle(png, SIZE / 2, SIZE / 2 - 20, r - 12, bg);
    fillCircle(png, SIZE / 2, SIZE / 2 - 20, r - 24, accent);
    const mono = initialsOf(text);
    const mScale = mono.length > 1 ? 10 : 13;
    const mTrack = Math.round(mScale * 0.55);
    const mw = measure(mono, mScale, mTrack);
    blit(png, (SIZE - mw) / 2, SIZE / 2 - 20 - (FONT_H * mScale) / 2, mono, mScale, ink[0] > 200 ? hueRgb(hue, 0.4, 0.16) : [255, 255, 255], mTrack);
    const caption = lines[0] ?? text;
    const cScale = Math.max(3, Math.min(5, Math.floor(300 / (caption.length * (FONT_W + 1)))));
    const cTrack = Math.max(2, Math.round(cScale * 0.7));
    const cw = measure(caption, cScale, cTrack);
    blit(png, (SIZE - cw) / 2, SIZE / 2 - 20 + r + 18, caption, cScale, ink, cTrack);
  }
  return PNG.sync.write(png);
}
