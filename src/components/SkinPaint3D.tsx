import { useEffect, useRef } from 'react';
import { SkinViewer } from 'skinview3d';
import { CanvasTexture, MOUSE, NearestFilter, Raycaster, Vector2, type Intersection, type Mesh, type Object3D } from 'three';
import type { PartId } from '../skinTexture';

interface Props {
  /** The 64×64 texture being edited (all layers flattened). */
  texture: HTMLCanvasElement;
  /** Bumped whenever the texture changes. */
  version: number;
  slim: boolean;
  hiddenBase: ReadonlySet<PartId>;
  hiddenOuter: ReadonlySet<PartId>;
  grid: boolean;
  /** Pixels to outline: where the brush would paint. */
  highlight: { x: number; y: number }[];
  /** Bumped to put the camera back where it started. */
  resetView: number;
  onStrokeStart: () => void;
  onPaint: (x: number, y: number) => void;
  onHover: (pixel: { x: number; y: number } | null) => void;
}

const PART_IDS: PartId[] = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
// The model's texture is drawn this many times bigger, so grid lines and the brush outline fit inside a pixel.
const UP = 8;

const shown = (object: Object3D | null): boolean => !object || (object.visible && shown(object.parent));

/** The player in 3D: drag on the model to paint, right-drag (or drag beside it) to turn it, scroll to zoom. */
export default function SkinPaint3D(props: Props) {
  const { texture, version, slim, hiddenBase, hiddenOuter, grid, highlight, resetView } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  // What the model shows: the skin drawn bigger, with the grid and brush outline. Updated in place.
  const display = useRef<HTMLCanvasElement | null>(null);
  const map = useRef<CanvasTexture | null>(null);
  // Listeners are set up once, so they read the latest props from here.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const v = new SkinViewer({ canvas: canvas.current!, width: 300, height: 400, zoom: 0.7, fov: 45 });
    v.controls.enablePan = false;
    // Left paints on the model; the right button turns it from anywhere.
    v.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    v.controls.minDistance = 15;
    v.controls.maxDistance = 100;
    v.playerObject.rotation.y = Math.PI / 9;
    viewer.current = v;

    const el = box.current!;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width && height) v.setSize(width, height);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);

    // The texture pixel a hit lands on. The point is nudged toward the middle of the triangle it hit,
    // so a click right on an edge counts for the face that was clicked, not the one next to it on the texture.
    const pixelOf = (hit: Intersection) => {
      const uv = (hit.object as Mesh).geometry.attributes.uv;
      const f = hit.face!;
      const cu = (uv.getX(f.a) + uv.getX(f.b) + uv.getX(f.c)) / 3;
      const cv = (uv.getY(f.a) + uv.getY(f.b) + uv.getY(f.c)) / 3;
      const u = hit.uv!.x + (cu - hit.uv!.x) * 0.002;
      const w = hit.uv!.y + (cv - hit.uv!.y) * 0.002;
      return {
        x: Math.min(63, Math.max(0, Math.floor(u * 64))),
        y: Math.min(63, Math.max(0, Math.floor((1 - w) * 64))),
      };
    };

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const pixelAt = (clientX: number, clientY: number) => {
      const r = v.canvas.getBoundingClientRect();
      pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, v.camera);
      // The nearest shown layer gets the paint: the outer layer wherever it's shown, even where it's
      // see-through. Hide a part's outer layer to paint the base under it.
      for (const hit of raycaster.intersectObject(v.playerObject.skin, true)) {
        if (hit.uv && hit.face && shown(hit.object)) return pixelOf(hit);
      }
      return null;
    };

    let painting = false;
    let last = '';
    let lastPoint = { x: 0, y: 0 };
    let hovered = '';
    const paint = (p: { x: number; y: number } | null) => {
      const key = p ? `${p.x},${p.y}` : '';
      if (!p || key === last) return;
      last = key;
      latest.current.onPaint(p.x, p.y);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = pixelAt(e.clientX, e.clientY);
      if (!p) return; // Missed the model: let the camera turn.
      // Keep the camera still while painting.
      e.stopPropagation();
      e.preventDefault();
      painting = true;
      last = `${p.x},${p.y}`;
      lastPoint = { x: e.clientX, y: e.clientY };
      v.canvas.setPointerCapture(e.pointerId);
      latest.current.onStrokeStart();
      latest.current.onPaint(p.x, p.y);
    };
    const move = (e: PointerEvent) => {
      if (painting) {
        // Check the points in between too, so a fast stroke leaves no gaps.
        const dx = e.clientX - lastPoint.x;
        const dy = e.clientY - lastPoint.y;
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
        for (let i = 1; i < steps; i++) paint(pixelAt(lastPoint.x + (dx * i) / steps, lastPoint.y + (dy * i) / steps));
        lastPoint = { x: e.clientX, y: e.clientY };
      }
      const p = pixelAt(e.clientX, e.clientY);
      el.dataset.over = p ? 'model' : '';
      const hoverKey = p ? `${p.x},${p.y}` : '';
      if (hoverKey !== hovered) {
        hovered = hoverKey;
        latest.current.onHover(p);
      }
      if (painting) paint(p);
    };
    const up = () => {
      painting = false;
    };
    const leave = () => {
      if (painting) return;
      hovered = '';
      latest.current.onHover(null);
    };
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener('contextmenu', noMenu);
    // Capture, so a stroke starts before the camera controls see the press.
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', leave);

    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('contextmenu', noMenu);
      observer.disconnect();
      map.current?.dispose();
      map.current = null;
      v.dispose();
      viewer.current = null;
    };
  }, []);

  // Redraw the model's texture: the skin, then the grid and the brush outline on top.
  const highlightKey = highlight.map((p) => `${p.x},${p.y}`).join(' ');
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const out = (display.current ??= Object.assign(document.createElement('canvas'), { width: 64 * UP, height: 64 * UP }));
    const c = out.getContext('2d')!;
    c.clearRect(0, 0, out.width, out.height);
    c.imageSmoothingEnabled = false;
    c.drawImage(texture, 0, 0, out.width, out.height);
    if (grid) {
      // Only over pixels that are there, so see-through parts stay see-through.
      c.save();
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = 'rgba(0, 0, 0, 0.32)';
      for (let i = 0; i < 64; i++) {
        c.fillRect(i * UP, 0, 1, out.height);
        c.fillRect(0, i * UP, out.width, 1);
      }
      c.restore();
    }
    for (const p of highlight) {
      c.fillStyle = 'rgba(255, 255, 255, 0.35)';
      c.fillRect(p.x * UP, p.y * UP, UP, UP);
      c.strokeStyle = '#fff';
      c.lineWidth = 1;
      c.strokeRect(p.x * UP + 0.5, p.y * UP + 0.5, UP - 1, UP - 1);
    }
    // Update the same texture rather than making a new one each time: this runs on every brush move.
    if (!map.current) {
      map.current = new CanvasTexture(out);
      map.current.magFilter = NearestFilter;
      map.current.minFilter = NearestFilter;
      v.playerObject.skin.map = map.current;
      // The model starts hidden until it has a skin.
      v.playerObject.skin.visible = true;
    } else {
      map.current.needsUpdate = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture, version, grid, highlightKey]);

  useEffect(() => {
    const v = viewer.current;
    if (v) v.playerObject.skin.modelType = slim ? 'slim' : 'default';
  }, [slim]);

  useEffect(() => {
    const skin = viewer.current?.playerObject.skin;
    if (!skin) return;
    for (const id of PART_IDS) {
      skin[id].innerLayer.visible = !hiddenBase.has(id);
      skin[id].outerLayer.visible = !hiddenOuter.has(id);
    }
  }, [hiddenBase, hiddenOuter]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !resetView) return;
    v.resetCameraPose();
    v.playerObject.rotation.y = Math.PI / 9;
  }, [resetView]);

  return (
    <div ref={box} className="skin-paint-3d">
      <canvas ref={canvas} role="img" aria-label="Skin in 3D. Drag on the model to paint, right-drag to turn it, scroll to zoom." />
    </div>
  );
}
