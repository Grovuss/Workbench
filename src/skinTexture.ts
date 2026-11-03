// The 64×64 skin layout: where each body part's faces sit on the texture.
import type { LibrarySkin } from './types';

/** A library skin's picture; the version makes previews refresh after an edit. */
export const skinUrl = (skin: LibrarySkin) => `workbench://skin/${skin.id}?v=${encodeURIComponent(skin.updatedAt ?? skin.addedAt)}`;

export type PartId = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
export type Layer = 'inner' | 'outer';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Face extends Rect {
  part: PartId;
  layer: Layer;
}

export const PARTS: { id: PartId; label: string }[] = [
  { id: 'head', label: 'Head' },
  { id: 'body', label: 'Body' },
  { id: 'rightArm', label: 'Right arm' },
  { id: 'leftArm', label: 'Left arm' },
  { id: 'rightLeg', label: 'Right leg' },
  { id: 'leftLeg', label: 'Left leg' },
];

// [u, v] of each part's box, inner then outer layer, with its width, height and depth.
const BOXES: Record<PartId, { inner: [number, number]; outer: [number, number]; w: number; h: number; d: number }> = {
  head: { inner: [0, 0], outer: [32, 0], w: 8, h: 8, d: 8 },
  body: { inner: [16, 16], outer: [16, 32], w: 8, h: 12, d: 4 },
  rightArm: { inner: [40, 16], outer: [40, 32], w: 4, h: 12, d: 4 },
  leftArm: { inner: [32, 48], outer: [48, 48], w: 4, h: 12, d: 4 },
  rightLeg: { inner: [0, 16], outer: [0, 32], w: 4, h: 12, d: 4 },
  leftLeg: { inner: [16, 48], outer: [0, 48], w: 4, h: 12, d: 4 },
};

/** Every face on the texture. Slim arms are 3 pixels wide. */
export function faces(slim: boolean): Face[] {
  const out: Face[] = [];
  for (const [part, box] of Object.entries(BOXES) as [PartId, (typeof BOXES)[PartId]][]) {
    const w = slim && (part === 'rightArm' || part === 'leftArm') ? 3 : box.w;
    const { h, d } = box;
    for (const layer of ['inner', 'outer'] as const) {
      const [u, v] = box[layer];
      const add = (x: number, y: number, fw: number, fh: number) => out.push({ part, layer, x, y, w: fw, h: fh });
      add(u + d, v, w, d); // top
      add(u + d + w, v, w, d); // bottom
      add(u, v + d, d, h); // right side
      add(u + d, v + d, w, h); // front
      add(u + d + w, v + d, d, h); // left side
      add(u + d * 2 + w, v + d, w, h); // back
    }
  }
  return out;
}

export const faceAt = (list: Face[], x: number, y: number) =>
  list.find((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) ?? null;

const MIRROR_PART: Partial<Record<PartId, PartId>> = {
  rightArm: 'leftArm',
  leftArm: 'rightArm',
  rightLeg: 'leftLeg',
  leftLeg: 'rightLeg',
};
// Faces come in sixes (top, bottom, side, front, side, back); mirroring swaps the two sides.
const MIRROR_FACE = [0, 1, 4, 3, 2, 5];

/** The same spot on the other side of the body, for mirror painting. */
export function mirrorPixel(list: Face[], x: number, y: number): { x: number; y: number } | null {
  const i = list.findIndex((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
  if (i < 0) return null;
  const f = list[i];
  const part = MIRROR_PART[f.part] ?? f.part;
  const kind = MIRROR_FACE[i % 6];
  const m = list.find((g, j) => g.part === part && g.layer === f.layer && j % 6 === kind);
  if (!m) return null;
  return { x: m.x + (m.w - 1 - (x - f.x)), y: m.y + (y - f.y) };
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (r: number, g: number, b: number) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return rgbToHex(f(5), f(3), f(1));
}

export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

/** A plain gray figure to start a new skin from. */
export function blankSkin(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, 64, 64);
  const shades: Record<PartId, string> = {
    head: '#b8b8b8',
    body: '#9a9a9a',
    rightArm: '#a8a8a8',
    leftArm: '#a8a8a8',
    rightLeg: '#808080',
    leftLeg: '#808080',
  };
  for (const f of faces(false)) {
    if (f.layer !== 'inner') continue;
    ctx.fillStyle = shades[f.part];
    ctx.fillRect(f.x, f.y, f.w, f.h);
  }
}

/** The colors a skin uses most, most-used first. */
export function topColors(data: ImageData, limit: number): string[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < data.data.length; i += 4) {
    if (data.data[i + 3] < 128) continue;
    const key = (data.data[i] << 16) | (data.data[i + 1] << 8) | data.data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => rgbToHex((key >> 16) & 255, (key >> 8) & 255, key & 255));
}
