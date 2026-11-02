import { useEffect, useRef } from 'react';
import { IdleAnimation, SkinViewer } from 'skinview3d';
import type { SkinVariant } from '../types';

interface Props {
  /** Skin texture; null shows nothing. */
  url: string | null;
  variant: SkinVariant;
  /** Cape texture, or null for none. */
  capeUrl?: string | null;
  label?: string;
}

const https = (url: string) => url.replace(/^http:/, 'https:');

/** A skin (and cape) on a 3D player that can be dragged around and zoomed. */
export default function Skin3D({ url, variant, capeUrl = null, label = 'Skin preview' }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);

  // One viewer for the component's life, sized to its box.
  useEffect(() => {
    const v = new SkinViewer({ canvas: canvas.current!, width: 300, height: 400, zoom: 0.85, fov: 50 });
    v.animation = new IdleAnimation();
    v.controls.enablePan = false;
    v.controls.minDistance = 25;
    v.controls.maxDistance = 90;
    // A quarter turn so the cape shows without having to drag.
    v.playerObject.rotation.y = Math.PI / 7;
    viewer.current = v;

    const fit = () => {
      const { width, height } = box.current!.getBoundingClientRect();
      if (width && height) v.setSize(width, height);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box.current!);
    return () => {
      observer.disconnect();
      v.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (!url) v.loadSkin(null);
    else v.loadSkin(https(url), { model: variant === 'slim' ? 'slim' : 'default' }).catch(() => v.loadSkin(null));
  }, [url, variant]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (!capeUrl) v.loadCape(null);
    else v.loadCape(https(capeUrl)).catch(() => v.loadCape(null));
  }, [capeUrl]);

  return (
    <div ref={box} className="skin-3d">
      <canvas ref={canvas} role="img" aria-label={label} title="Drag to turn, scroll to zoom" />
    </div>
  );
}
