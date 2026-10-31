import { useEffect, useRef } from 'react';
import type { SkinVariant } from '../types';

// Front view of a skin, drawn from its texture. The figure is 16×32 skin pixels.
// [source x, y, width, height, destination x, y]; arm widths depend on the variant.
type Part = [number, number, number, number, number, number];

function parts(variant: SkinVariant, legacy: boolean): { base: Part[]; overlay: Part[]; mirrored: Part[] } {
  const arm = variant === 'slim' ? 3 : 4;
  const base: Part[] = [
    [8, 8, 8, 8, 4, 0], // head
    [20, 20, 8, 12, 4, 8], // body
    [44, 20, arm, 12, 4 - arm, 8], // right arm (viewer's left)
    [4, 20, 4, 12, 4, 20], // right leg
  ];
  const overlay: Part[] = [[40, 8, 8, 8, 4, 0]]; // hat
  // 64×32 skins have no left limbs: the game mirrors the right ones.
  if (legacy) return { base, overlay, mirrored: [[44, 20, arm, 12, 12, 8], [4, 20, 4, 12, 8, 20]] };
  base.push([36, 52, arm, 12, 12, 8], [20, 52, 4, 12, 8, 20]);
  overlay.push(
    [20, 36, 8, 12, 4, 8], // jacket
    [44, 36, arm, 12, 4 - arm, 8], // right sleeve
    [52, 52, arm, 12, 12, 8], // left sleeve
    [4, 36, 4, 12, 4, 20], // right trouser
    [4, 52, 4, 12, 8, 20], // left trouser
  );
  return { base, overlay, mirrored: [] };
}

interface Props {
  url: string;
  variant: SkinVariant;
  /** Screen pixels per skin pixel. */
  scale?: number;
  label?: string;
}

export default function SkinView({ url, variant, scale = 6, label = 'Skin preview' }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      const ctx = canvas.current?.getContext('2d');
      if (cancelled || !ctx) return;
      // HD skins are larger multiples of 64.
      const k = img.naturalWidth / 64;
      const legacy = img.naturalHeight * 2 === img.naturalWidth;
      ctx.clearRect(0, 0, 16 * scale, 32 * scale);
      ctx.imageSmoothingEnabled = false;
      const draw = ([sx, sy, w, h, dx, dy]: Part) =>
        ctx.drawImage(img, sx * k, sy * k, w * k, h * k, dx * scale, dy * scale, w * scale, h * scale);
      const { base, overlay, mirrored } = parts(variant, legacy);
      base.forEach(draw);
      for (const [sx, sy, w, h, dx, dy] of mirrored) {
        ctx.save();
        ctx.translate((dx + w) * scale, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, sx * k, sy * k, w * k, h * k, 0, dy * scale, w * scale, h * scale);
        ctx.restore();
      }
      overlay.forEach(draw);
    };
    img.src = url.replace(/^http:/, 'https:');
    return () => {
      cancelled = true;
    };
  }, [url, variant, scale]);

  return <canvas ref={canvas} className="skin-view" width={16 * scale} height={32 * scale} role="img" aria-label={label} />;
}

/** The outside of a cape, from its texture. */
export function CapeView({ url, scale = 4, label = 'Cape' }: { url: string; scale?: number; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      const ctx = canvas.current?.getContext('2d');
      if (cancelled || !ctx) return;
      const k = img.naturalWidth / 64;
      ctx.clearRect(0, 0, 10 * scale, 16 * scale);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, 10 * scale, 16 * scale);
    };
    img.src = url.replace(/^http:/, 'https:');
    return () => {
      cancelled = true;
    };
  }, [url, scale]);

  return <canvas ref={canvas} className="cape-view" width={10 * scale} height={16 * scale} role="img" aria-label={label} />;
}
