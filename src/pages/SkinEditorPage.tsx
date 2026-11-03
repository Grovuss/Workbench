import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Box,
  Check,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Grid3x3,
  ImagePlus,
  Layers as LayersIcon,
  LayoutPanelLeft,
  ListTree,
  LoaderCircle,
  PaintBucket,
  Palette,
  Pencil,
  Pipette,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { loadSkinToCanvas } from 'skinview-utils';
import Dropdown from '../components/Dropdown';
import EditorWindows, { type Layout, type WindowDef } from '../components/EditorWindows';
import { api, errorMessage } from '../api';
import {
  PARTS,
  blankSkin,
  faceAt,
  faces,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  mirrorPixel,
  rgbToHex,
  skinUrl,
  topColors,
  type PartId,
} from '../skinTexture';
import { isMac, shortcut } from '../platform';
import type { SkinBase, SkinVariant } from '../types';

const SkinPaint3D = lazy(() => import('../components/SkinPaint3D'));

interface Props {
  /** Library skin to edit, or null for a new one. */
  id: string | null;
  /** For a new skin: the picture to start from (the skin being worn). */
  base?: SkinBase;
  /** Signed in with an account that can wear skins. */
  canWear: boolean;
  onDone: () => void;
  onSkinChanged: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

type Tool = 'pencil' | 'eraser' | 'fill' | 'picker';
type SwatchSet = 'palette' | 'recent' | 'skin';

const TOOLS: { id: Tool; label: string; key: string; icon: typeof Pencil }[] = [
  { id: 'pencil', label: 'Pencil', key: 'B', icon: Pencil },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: Eraser },
  { id: 'fill', label: 'Fill', key: 'G', icon: PaintBucket },
  { id: 'picker', label: 'Pick a color', key: 'I', icon: Pipette },
];

const SIZES = [1, 2, 3, 4];

// What Minecraft calls each part's outer layer.
const OUTER_NAMES: Record<PartId, string> = {
  head: 'Hat',
  body: 'Jacket',
  rightArm: 'Right sleeve',
  leftArm: 'Left sleeve',
  rightLeg: 'Right pants leg',
  leftLeg: 'Left pants leg',
};

const PALETTE = [
  '#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5a3825',
  '#2b1d0e', '#6b4423', '#e8c170', '#ffffff', '#9c9c9c', '#3a3a3a',
  '#000000', '#d32f2f', '#f57c00', '#fec424', '#388e3c', '#1976d2',
];

const RECENT_KEY = 'workbench.skinEditorRecent';
const LAYOUT_KEY = 'workbench.skinEditorLayout3';
const PREFS_KEY = 'workbench.skinEditorPrefs';
const SCALE = 8; // Canvas pixels per skin pixel on the flat view, before CSS scaling.

interface Prefs {
  size: number;
  mirror: boolean;
  gridFlat: boolean;
  grid3d: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An imported image still being moved and resized. */
interface Placing {
  image: ImageBitmap;
  rect: Rect;
  smooth: boolean;
}

interface Layer {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  visible: boolean;
  opacity: number;
  placing?: Placing;
}

interface Snapshot {
  layers: { id: string; name: string; visible: boolean; opacity: number; data: ImageData; placing?: Placing }[];
  active: string;
}

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const newCanvas = () => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  return c;
};
const ctxOf = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;
const uid = () => Math.random().toString(36).slice(2, 10);

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; that's fine.
  }
}

async function loadImage(url: string) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  return img;
}

/** Where the windows start: texture and parts on the left, the model in the middle, color and layers on the right. */
function defaultLayout(width: number, height: number): Layout {
  const gap = 6;
  const left = Math.round(Math.min(340, Math.max(260, width * 0.28)));
  const right = Math.round(Math.min(270, Math.max(232, width * 0.22)));
  const midW = width - left - right - gap * 2;
  // Parts is a fixed list; the texture gets the rest of the column.
  const partsH = 252;
  const flatH = Math.max(220, height - partsH - gap);
  const layersH = Math.min(240, Math.max(170, Math.round(height * 0.32)));
  return {
    flat: { x: 0, y: 0, w: left, h: flatH, z: 1, open: true },
    parts: { x: 0, y: flatH + gap, w: left, h: height - flatH - gap, z: 2, open: true },
    model: { x: left + gap, y: 0, w: midW, h: height, z: 3, open: true },
    color: { x: width - right, y: 0, w: right, h: height - layersH - gap, z: 4, open: true },
    layers: { x: width - right, y: height - layersH, w: right, h: layersH, z: 5, open: true },
  };
}

export default function SkinEditorPage({ id, base, canWear, onDone, onSkinChanged, onError, onSuccess }: Props) {
  // All layers flattened: what the 3D view shows and what gets saved.
  const [texture] = useState(newCanvas);
  const [layers, setLayersState] = useState<Layer[]>([]);
  const layersRef = useRef<Layer[]>([]);
  const [active, setActive] = useState('');
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState(id ? '' : (base?.name ?? 'New skin'));
  const [variant, setVariant] = useState<SkinVariant>(base?.variant ?? 'classic');
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColorState] = useState('#fec424');
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv('#fec424'));
  const [recent, setRecent] = useState<string[]>(() => readJson<string[]>(RECENT_KEY, []).filter((c) => /^#[0-9a-f]{6}$/.test(c)));
  const [prefs, setPrefsState] = useState<Prefs>(() => ({ size: 1, mirror: false, gridFlat: true, grid3d: false, ...readJson<Partial<Prefs>>(PREFS_KEY, {}) }));
  const [hiddenBase, setHiddenBase] = useState<ReadonlySet<PartId>>(new Set());
  const [hiddenOuter, setHiddenOuter] = useState<ReadonlySet<PartId>>(new Set());
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [resetView, setResetView] = useState(0);
  const [swatchSet, setSwatchSet] = useState<SwatchSet>('palette');
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState<'save' | 'wear' | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [theme, setTheme] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(() => readJson<Layout | null>(LAYOUT_KEY, null));
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const flat = useRef<HTMLCanvasElement>(null);
  const flatBox = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const stroke = useRef<{ x: number; y: number } | null>(null);
  const transform = useRef<{ handle: Handle; start: { x: number; y: number }; rect: Rect } | null>(null);
  const dragDepth = useRef(0);

  const slim = variant === 'slim';
  const faceList = useMemo(() => faces(slim), [slim]);
  const activeLayer = layers.find((l) => l.id === active) ?? null;
  const placing = activeLayer?.placing ?? null;

  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      writeJson(PREFS_KEY, next);
      return next;
    });

  // ---------- Layers ----------

  const composite = useCallback(
    (list: Layer[]) => {
      const c = ctxOf(texture);
      c.clearRect(0, 0, 64, 64);
      for (const l of list) {
        if (!l.visible) continue;
        c.globalAlpha = l.opacity;
        c.drawImage(l.canvas, 0, 0);
      }
      c.globalAlpha = 1;
    },
    [texture],
  );

  /** Redraws after pixels changed. */
  const refresh = useCallback(() => {
    composite(layersRef.current);
    setVersion((v) => v + 1);
  }, [composite]);

  /** Replaces the layer list. */
  const setLayers = useCallback(
    (list: Layer[]) => {
      layersRef.current = list;
      setLayersState(list);
      composite(list);
      setVersion((v) => v + 1);
    },
    [composite],
  );

  const renderPlacing = (layer: Layer) => {
    const p = layer.placing;
    if (!p) return;
    const c = ctxOf(layer.canvas);
    c.clearRect(0, 0, 64, 64);
    c.imageSmoothingEnabled = p.smooth;
    c.imageSmoothingQuality = 'high';
    c.drawImage(p.image, p.rect.x, p.rect.y, p.rect.w, p.rect.h);
  };

  const snapshot = useCallback(
    (): Snapshot => ({
      layers: layersRef.current.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        data: ctxOf(l.canvas).getImageData(0, 0, 64, 64),
        placing: l.placing && { ...l.placing, rect: { ...l.placing.rect } },
      })),
      active,
    }),
    [active],
  );

  /** Call before changing anything, so it can be undone. */
  const checkpoint = useCallback(() => {
    undo.current.push(snapshot());
    if (undo.current.length > 60) undo.current.shift();
    redo.current = [];
    setDirty(true);
  }, [snapshot]);

  const restore = useCallback(
    (s: Snapshot) => {
      const list = s.layers.map((l) => {
        const canvas = newCanvas();
        ctxOf(canvas).putImageData(l.data, 0, 0);
        return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, canvas, placing: l.placing };
      });
      setLayers(list);
      setActive(s.active);
    },
    [setLayers],
  );

  const step = useCallback(
    (from: Snapshot[], to: Snapshot[]) => {
      const s = from.pop();
      if (!s) return;
      to.push(snapshot());
      restore(s);
      setDirty(true);
    },
    [snapshot, restore],
  );
  const doUndo = useCallback(() => step(undo.current, redo.current), [step]);
  const doRedo = useCallback(() => step(redo.current, undo.current), [step]);

  const addLayer = (layer: Omit<Layer, 'id'>) => {
    const list = [...layersRef.current];
    const at = list.findIndex((l) => l.id === active);
    const made = { ...layer, id: uid() };
    list.splice(at + 1, 0, made);
    setLayers(list);
    setActive(made.id);
    return made;
  };

  const nextName = () => {
    let n = layersRef.current.length + 1;
    while (layersRef.current.some((l) => l.name === `Layer ${n}`)) n++;
    return `Layer ${n}`;
  };

  /** Fixes an imported image in place, so it can be painted on. */
  const bake = useCallback(() => {
    if (!layersRef.current.some((l) => l.placing)) return;
    setLayers(layersRef.current.map((l) => (l.placing ? { ...l, placing: undefined } : l)));
  }, [setLayers]);

  const updateLayer = (layerId: string, patch: Partial<Layer>) =>
    setLayers(layersRef.current.map((l) => (l.id === layerId ? { ...l, ...patch } : l)));

  const moveLayer = (dir: 1 | -1) => {
    const list = [...layersRef.current];
    const i = list.findIndex((l) => l.id === active);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    checkpoint();
    [list[i], list[j]] = [list[j], list[i]];
    setLayers(list);
  };

  const newLayer = () => {
    bake();
    checkpoint();
    addLayer({ name: nextName(), canvas: newCanvas(), visible: true, opacity: 1 });
  };

  const duplicateLayer = () => {
    if (!activeLayer) return;
    bake();
    checkpoint();
    const canvas = newCanvas();
    ctxOf(canvas).drawImage(activeLayer.canvas, 0, 0);
    addLayer({ name: `${activeLayer.name} copy`, canvas, visible: activeLayer.visible, opacity: activeLayer.opacity });
  };

  const deleteLayer = () => {
    const list = layersRef.current;
    if (list.length < 2) return;
    checkpoint();
    const i = list.findIndex((l) => l.id === active);
    const next = list.filter((l) => l.id !== active);
    setLayers(next);
    setActive(next[Math.max(0, i - 1)].id);
  };

  const mergeDown = () => {
    const list = [...layersRef.current];
    const i = list.findIndex((l) => l.id === active);
    if (i < 1) return;
    checkpoint();
    const below = list[i - 1];
    const c = ctxOf(below.canvas);
    c.globalAlpha = list[i].opacity;
    if (list[i].visible) c.drawImage(list[i].canvas, 0, 0);
    c.globalAlpha = 1;
    list.splice(i, 1);
    list[i - 1] = { ...below, placing: undefined };
    setLayers(list);
    setActive(below.id);
  };

  // ---------- Loading ----------

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const canvas = newCanvas();
        if (id) {
          const entry = (await api.skins.library()).find((s) => s.id === id);
          if (!entry) throw new Error('That skin is no longer in your library.');
          const img = await loadImage(skinUrl(entry));
          if (canceled) return;
          loadSkinToCanvas(canvas, img);
          setName(entry.name);
          setVariant(entry.variant);
        } else if (base) {
          loadSkinToCanvas(canvas, await loadImage(base.url.replace(/^http:/, 'https:')));
        } else {
          blankSkin(ctxOf(canvas));
        }
        if (canceled) return;
        const first = { id: uid(), name: 'Skin', canvas, visible: true, opacity: 1 };
        setLayers([first]);
        setActive(first.id);
        setLoaded(true);
      } catch (err) {
        if (!canceled) onError(errorMessage(err));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [id, base, setLayers, onError]);

  // ---------- Importing ----------

  const importFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return onError('Drop an image (PNG, JPG, GIF or WebP).');
    for (const file of images) {
      try {
        const image = await createImageBitmap(file);
        // A whole skin goes where a skin goes; anything else starts small in the middle, ready to move.
        const isSkin = image.width === 64 && (image.height === 64 || image.height === 32);
        const scale = isSkin ? 1 : Math.min(32 / image.width, 32 / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        const rect = isSkin ? { x: 0, y: 0, w, h } : { x: 32 - w / 2, y: 32 - h / 2, w, h };
        bake();
        checkpoint();
        const layer = addLayer({
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Image',
          canvas: newCanvas(),
          visible: true,
          opacity: 1,
          placing: { image, rect, smooth: Math.max(image.width, image.height) > 64 },
        });
        renderPlacing(layer);
        refresh();
      } catch {
        onError(`Couldn’t open ${file.name}.`);
      }
    }
  };

  const applyPlacing = () => bake();

  const cancelPlacing = () => {
    // The import was the last change; moving and resizing it don't add undo steps.
    doUndo();
    redo.current = [];
  };

  const setPlacing = (patch: Partial<Placing>) => {
    if (!activeLayer?.placing) return;
    const next = { ...activeLayer, placing: { ...activeLayer.placing, ...patch } };
    renderPlacing(next);
    setLayers(layersRef.current.map((l) => (l.id === next.id ? next : l)));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDropping(false);
    importFiles([...e.dataTransfer.files]);
  };

  // ---------- Painting ----------

  const setColor = useCallback((hex: string) => {
    setColorState(hex);
    setHsv(hexToHsv(hex));
  }, []);

  const remember = useCallback((hex: string) => {
    setRecent((list) => {
      const next = [hex, ...list.filter((c) => c !== hex)].slice(0, 18);
      writeJson(RECENT_KEY, next);
      return next;
    });
  }, []);

  const paintable = useCallback(
    (x: number, y: number) => {
      const face = faceAt(faceList, x, y);
      if (!face) return false;
      return face.layer === 'inner' ? !hiddenBase.has(face.part) : !hiddenOuter.has(face.part);
    },
    [faceList, hiddenBase, hiddenOuter],
  );

  /** Every pixel one dab of the brush covers here: the brush square, and its mirror image. */
  const brushAt = useCallback(
    (x: number, y: number) => {
      const size = tool === 'fill' || tool === 'picker' ? 1 : prefs.size;
      const start = -Math.floor((size - 1) / 2);
      // The brush stays on the face it started on, so it can't bleed onto a different part of the texture.
      const face = faceAt(faceList, x, y);
      const out = new Map<string, { x: number; y: number }>();
      if (!face) return [];
      const add = (p: { x: number; y: number } | null) => {
        if (p && paintable(p.x, p.y)) out.set(`${p.x},${p.y}`, p);
      };
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const p = { x: x + start + dx, y: y + start + dy };
          if (p.x < face.x || p.y < face.y || p.x >= face.x + face.w || p.y >= face.y + face.h) continue;
          add(p);
          if (prefs.mirror && tool !== 'picker') add(mirrorPixel(faceList, p.x, p.y));
        }
      }
      return [...out.values()];
    },
    [tool, prefs.size, prefs.mirror, faceList, paintable],
  );

  const highlight = useMemo(() => (hover && !placing ? brushAt(hover.x, hover.y) : []), [hover, placing, brushAt]);

  const startStroke = () => {
    stroke.current = null;
    // Picking a color changes nothing, so there's nothing to undo.
    if (tool === 'picker') return;
    bake();
    checkpoint();
    if (tool === 'pencil' || tool === 'fill') remember(color);
  };

  const fill = (layer: Layer, x: number, y: number) => {
    const face = faceAt(faceList, x, y);
    if (!face) return;
    const c = ctxOf(layer.canvas);
    const img = c.getImageData(0, 0, 64, 64);
    const d = img.data;
    const at = (px: number, py: number) => (py * 64 + px) * 4;
    const s = at(x, y);
    const from = [d[s], d[s + 1], d[s + 2], d[s + 3]];
    const [r, g, b] = hexToRgb(color);
    if (from[0] === r && from[1] === g && from[2] === b && from[3] === 255) return;
    const same = (i: number) => d[i] === from[0] && d[i + 1] === from[1] && d[i + 2] === from[2] && d[i + 3] === from[3];
    // Stays on the face that was clicked, so it can't spill onto the next part of the texture.
    const queue = [[x, y]];
    const seen = new Set<number>();
    while (queue.length) {
      const [px, py] = queue.pop()!;
      if (px < face.x || py < face.y || px >= face.x + face.w || py >= face.y + face.h) continue;
      const i = at(px, py);
      if (seen.has(i) || !same(i)) continue;
      seen.add(i);
      d.set([r, g, b, 255], i);
      queue.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    c.putImageData(img, 0, 0);
  };

  /** One dab of the current tool at a pixel. */
  const paintAt = (x: number, y: number) => {
    if (!paintable(x, y)) return;
    if (tool === 'picker') {
      const [r, g, b, a] = ctxOf(texture).getImageData(x, y, 1, 1).data;
      if (a > 0) setColor(rgbToHex(r, g, b));
      setTool('pencil');
      return;
    }
    // A hidden layer can't be painted on.
    const layer = layersRef.current.find((l) => l.id === active);
    if (!layer?.visible) return;
    const c = ctxOf(layer.canvas);
    for (const p of brushAt(x, y)) {
      if (tool === 'pencil') {
        c.fillStyle = color;
        c.fillRect(p.x, p.y, 1, 1);
      } else if (tool === 'eraser') {
        c.clearRect(p.x, p.y, 1, 1);
      } else {
        fill(layer, p.x, p.y);
      }
    }
    refresh();
  };

  /** Paints from the last point of the stroke to here, so fast drags leave no gaps. */
  const paintTo = (x: number, y: number) => {
    const from = stroke.current;
    stroke.current = { x, y };
    if (!from || tool === 'fill' || tool === 'picker') return paintAt(x, y);
    let [x0, y0] = [from.x, from.y];
    const dx = Math.abs(x - x0);
    const dy = -Math.abs(y - y0);
    const sx = x0 < x ? 1 : -1;
    const sy = y0 < y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      paintAt(x0, y0);
      if (x0 === x && y0 === y) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };

  // Keyboard: tools, brush size, undo, and finishing an import.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const key = e.key.toLowerCase();
    if (placing && key === 'enter') {
      e.preventDefault();
      applyPlacing();
    } else if (placing && key === 'escape') {
      e.preventDefault();
      cancelPlacing();
    } else if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
      e.preventDefault();
      doRedo();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = TOOLS.find((tl) => tl.key.toLowerCase() === key);
      if (t) setTool(t.id);
      else if (key === 'm') setPrefs({ mirror: !prefs.mirror });
      else if (key === '=' || key === '+') zoomFlat(1.5);
      else if (key === '-') zoomFlat(1 / 1.5);
      else if (key === '0') setFlatView({ zoom: 1, x: 0, y: 0 });
      else if (SIZES.includes(Number(key))) setPrefs({ size: Number(key) });
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- Flat view ----------

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  // The flat view: at zoom 1 it's square and as big as its window allows; zoomed in, it can be moved around.
  const flatOpen = Boolean(layout?.flat?.open);
  const [flatSize, setFlatSize] = useState({ w: 0, h: 0 });
  const [flatView, setFlatView] = useState({ zoom: 1, x: 0, y: 0 });
  const panning = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  // The 10px margin around it at zoom 1.
  const fitSide = Math.max(64, Math.floor(Math.min(flatSize.w, flatSize.h) - 20));
  const flatSide = fitSide * flatView.zoom;
  const flatLeft = (flatSize.w - flatSide) / 2 + flatView.x;
  const flatTop = (flatSize.h - flatSide) / 2 + flatView.y;
  const flatGeo = useRef({ w: 0, h: 0, fitSide });
  flatGeo.current = { w: flatSize.w, h: flatSize.h, fitSide };

  useEffect(() => {
    const box = flatBox.current;
    if (!box) return;
    const measure = () => setFlatSize({ w: box.clientWidth, h: box.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [flatOpen, loaded]);

  /** Keeps at least a bit of the texture in view; at zoom 1 it sits in the middle. */
  const clampView = useCallback((v: { zoom: number; x: number; y: number }) => {
    const { w, h, fitSide: fs } = flatGeo.current;
    const zoom = Math.min(16, Math.max(1, v.zoom));
    if (zoom === 1) return { zoom, x: 0, y: 0 };
    const side = fs * zoom;
    const keep = 48;
    // At least \`keep\` pixels of the texture stay inside the box on each axis.
    const axis = (size: number, offset: number) => {
      const centered = (size - side) / 2;
      const left = Math.min(size - keep, Math.max(keep - side, centered + offset));
      return left - centered;
    };
    return { zoom, x: axis(w, v.x), y: axis(h, v.y) };
  }, []);

  /** Zooms by a factor, keeping the point under (px, py) in the flat view's box where it is. */
  const zoomFlat = useCallback(
    (factor: number, px?: number, py?: number) =>
      setFlatView((v) => {
        const { w, h, fitSide: fs } = flatGeo.current;
        const mx = px ?? w / 2;
        const my = py ?? h / 2;
        const side = fs * v.zoom;
        const left = (w - side) / 2 + v.x;
        const top = (h - side) / 2 + v.y;
        const zoom = Math.min(16, Math.max(1, v.zoom * factor));
        const next = fs * zoom;
        const nx = mx - ((mx - left) / side) * next;
        const ny = my - ((my - top) / side) * next;
        return clampView({ zoom, x: nx - (w - next) / 2, y: ny - (h - next) / 2 });
      }),
    [clampView],
  );

  // Scroll to zoom. Not a React handler: it has to be able to stop the page from scrolling.
  useEffect(() => {
    const box = flatBox.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      zoomFlat(Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [flatOpen, loaded, zoomFlat]);

  // Right- or middle-drag moves the zoomed texture.
  const onFlatBoxDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    panning.current = { startX: e.clientX, startY: e.clientY, x: flatView.x, y: flatView.y };
    e.currentTarget.dataset.panning = 'true';
  };
  const onFlatBoxMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = panning.current;
    if (!p) return;
    setFlatView((v) => clampView({ zoom: v.zoom, x: p.x + e.clientX - p.startX, y: p.y + e.clientY - p.startY }));
  };
  const onFlatBoxUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    panning.current = null;
    delete e.currentTarget.dataset.panning;
  };

  // Keep the view in bounds when the window is resized.
  useEffect(() => setFlatView((v) => clampView(v)), [flatSize, clampView]);

  // Everything but the brush outline is drawn once into here, so moving the brush only copies it.
  const flatBase = useRef<HTMLCanvasElement | null>(null);
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;

  const showFlat = useCallback(() => {
    const el = flat.current;
    const base = flatBase.current;
    if (!el || !base) return;
    const c = el.getContext('2d')!;
    c.clearRect(0, 0, el.width, el.height);
    c.drawImage(base, 0, 0);
    if (placing) return;
    c.lineWidth = 1;
    c.strokeStyle = getComputedStyle(el).getPropertyValue('--accent').trim() || '#fec424';
    for (const p of highlightRef.current) c.strokeRect(p.x * SCALE + 0.5, p.y * SCALE + 0.5, SCALE - 1, SCALE - 1);
  }, [placing]);

  useEffect(() => {
    const el = flat.current;
    if (!el) return;
    const size = 64 * SCALE;
    const base = (flatBase.current ??= Object.assign(document.createElement('canvas'), { width: size, height: size }));
    const c = base.getContext('2d')!;
    const css = getComputedStyle(el);
    const muted = css.getPropertyValue('--bg-muted').trim() || '#333';
    const surface = css.getPropertyValue('--bg-surface').trim() || '#222';
    const accent = css.getPropertyValue('--accent').trim() || '#fec424';
    c.clearRect(0, 0, size, size);
    // Faces get a checkerboard so see-through pixels read as see-through.
    const tile = Object.assign(document.createElement('canvas'), { width: SCALE, height: SCALE });
    const t = tile.getContext('2d')!;
    t.fillStyle = surface;
    t.fillRect(0, 0, SCALE, SCALE);
    t.fillStyle = muted;
    t.fillRect(0, 0, SCALE / 2, SCALE / 2);
    t.fillRect(SCALE / 2, SCALE / 2, SCALE / 2, SCALE / 2);
    c.fillStyle = c.createPattern(tile, 'repeat')!;
    for (const f of faceList) c.fillRect(f.x * SCALE, f.y * SCALE, f.w * SCALE, f.h * SCALE);
    c.imageSmoothingEnabled = false;
    c.drawImage(texture, 0, 0, size, size);
    // Fade what's hidden (and so can't be painted).
    c.globalAlpha = 0.8;
    c.fillStyle = surface;
    for (const f of faceList) {
      const hiddenFace = f.layer === 'inner' ? hiddenBase.has(f.part) : hiddenOuter.has(f.part);
      if (hiddenFace) c.fillRect(f.x * SCALE, f.y * SCALE, f.w * SCALE, f.h * SCALE);
    }
    c.globalAlpha = 1;
    if (prefs.gridFlat) {
      c.strokeStyle = 'rgba(128, 128, 128, 0.12)';
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 1; i < 64; i++) {
        c.moveTo(i * SCALE + 0.5, 0);
        c.lineTo(i * SCALE + 0.5, size);
        c.moveTo(0, i * SCALE + 0.5);
        c.lineTo(size, i * SCALE + 0.5);
      }
      c.stroke();
    }
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(128, 128, 128, 0.4)';
    for (const f of faceList) c.strokeRect(f.x * SCALE + 0.5, f.y * SCALE + 0.5, f.w * SCALE - 1, f.h * SCALE - 1);
    if (placing) {
      // The image being placed, with corner handles.
      const { x, y, w, h } = placing.rect;
      c.lineWidth = 2;
      c.setLineDash([6, 4]);
      c.strokeStyle = accent;
      c.strokeRect(x * SCALE, y * SCALE, w * SCALE, h * SCALE);
      c.setLineDash([]);
      c.fillStyle = accent;
      for (const [hx, hy] of [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ]) {
        c.fillRect(hx * SCALE - 6, hy * SCALE - 6, 12, 12);
      }
    }
    showFlat();
  }, [version, faceList, hiddenBase, hiddenOuter, texture, placing, theme, flatOpen, prefs.gridFlat, showFlat]);

  useEffect(showFlat, [highlight, showFlat]);

  /** The pointer's position in skin pixels (fractional). */
  const skinPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 64, y: ((e.clientY - r.top) / r.height) * 64, perPx: 64 / r.width };
  };

  const handleAt = (p: { x: number; y: number; perPx: number }, rect: Rect): Handle | null => {
    const reach = 9 * p.perPx;
    const corners: [Handle, number, number][] = [
      ['nw', rect.x, rect.y],
      ['ne', rect.x + rect.w, rect.y],
      ['sw', rect.x, rect.y + rect.h],
      ['se', rect.x + rect.w, rect.y + rect.h],
    ];
    for (const [h, cx, cy] of corners) if (Math.abs(p.x - cx) <= reach && Math.abs(p.y - cy) <= reach) return h;
    if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) return 'move';
    return null;
  };

  const onFlatDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = skinPoint(e);
    if (placing) {
      const handle = handleAt(p, placing.rect);
      if (!handle) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      transform.current = { handle, start: p, rect: { ...placing.rect } };
      return;
    }
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x > 63 || y > 63 || !paintable(x, y)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startStroke();
    paintTo(x, y);
  };

  const onFlatMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = skinPoint(e);
    const t = transform.current;
    if (placing) {
      e.currentTarget.dataset.cursor = t?.handle ?? handleAt(p, placing.rect) ?? '';
      if (!t || e.buttons !== 1) return;
      const dx = p.x - t.start.x;
      const dy = p.y - t.start.y;
      const r = { ...t.rect };
      if (t.handle === 'move') {
        r.x += dx;
        r.y += dy;
      } else {
        // Corners keep the image's shape; hold Shift to stretch it.
        const left = t.handle === 'nw' || t.handle === 'sw';
        const top = t.handle === 'nw' || t.handle === 'ne';
        let w = Math.max(1, t.rect.w + (left ? -dx : dx));
        let h = Math.max(1, t.rect.h + (top ? -dy : dy));
        if (!e.shiftKey) {
          const aspect = t.rect.w / t.rect.h;
          if (w / h > aspect) h = w / aspect;
          else w = h * aspect;
        }
        r.w = w;
        r.h = h;
        r.x = left ? t.rect.x + t.rect.w - w : t.rect.x;
        r.y = top ? t.rect.y + t.rect.h - h : t.rect.y;
      }
      setPlacing({ rect: r });
      return;
    }
    e.currentTarget.dataset.cursor = '';
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const inside = x >= 0 && y >= 0 && x < 64 && y < 64;
    const next = inside ? { x, y } : null;
    if (next?.x !== hover?.x || next?.y !== hover?.y) setHover(next);
    if (inside && e.buttons === 1 && stroke.current) paintTo(x, y);
  };

  const onFlatUp = () => {
    stroke.current = null;
    transform.current = null;
  };

  // ---------- Saving ----------

  const save = async (wear: boolean) => {
    bake();
    setSaving(wear ? 'wear' : 'save');
    try {
      composite(layersRef.current);
      const base64 = texture.toDataURL('image/png').split(',')[1];
      const label = name.trim() || 'New skin';
      const result = await api.skins.saveEdited(id, base64, label, variant);
      setDirty(false);
      if (wear && result.id) {
        await api.skins.wear(result.id);
        onSkinChanged();
        onSuccess(`Saved and now wearing ${label}.`);
      } else {
        onSuccess('Saved to your library.');
      }
      onDone();
    } catch (err) {
      onError(errorMessage(err));
      setSaving(null);
    }
  };

  const cancel = () => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onDone();
  };

  useEffect(() => {
    if (!confirmDiscard) return;
    const t = setTimeout(() => setConfirmDiscard(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDiscard]);

  useEffect(() => writeJson(LAYOUT_KEY, layout), [layout]);

  const updateLayout = useCallback((update: (l: Layout) => Layout) => setLayout((l) => update(l ?? {})), []);

  // ---------- Windows ----------

  const skinColors = useMemo(() => (loaded ? topColors(ctxOf(texture).getImageData(0, 0, 64, 64), 18) : []), [texture, loaded, version]);

  const pickSV = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setHsv([hsv[0], s, v]);
    setColorState(hsvToHex(hsv[0], s, v));
  };

  const toggleIn = (set: ReadonlySet<PartId>, part: PartId) => {
    const next = new Set(set);
    if (next.has(part)) next.delete(part);
    else next.add(part);
    return next;
  };
  const allOuterHidden = PARTS.every((p) => hiddenOuter.has(p.id));

  const swatchSets: Record<SwatchSet, { label: string; list: string[]; empty: string }> = {
    palette: { label: 'Palette', list: PALETTE, empty: '' },
    recent: { label: 'Recent', list: recent, empty: 'Colors you paint with show up here.' },
    skin: { label: 'In this skin', list: skinColors, empty: 'This skin has no colors yet.' },
  };
  const shownSet = swatchSets[swatchSet];

  const swatches = (
    <div className="editor-swatches">
      <div className="editor-swatch-tabs" role="tablist" aria-label="Swatches">
        {(Object.keys(swatchSets) as SwatchSet[]).map((k) => (
          <button key={k} role="tab" aria-selected={swatchSet === k} onClick={() => setSwatchSet(k)}>
            {swatchSets[k].label}
          </button>
        ))}
      </div>
      {shownSet.list.length === 0 ? (
        <p className="editor-swatch-empty">{shownSet.empty}</p>
      ) : (
        <div className="editor-swatch-grid" role="tabpanel">
          {shownSet.list.map((c) => (
            <button
              key={c}
              className="editor-swatch"
              style={{ background: c }}
              aria-label={c}
              aria-pressed={c === color}
              title={c}
              onClick={() => {
                setColor(c);
                if (tool === 'eraser' || tool === 'picker') setTool('pencil');
              }}
            />
          ))}
        </div>
      )}
    </div>
  );

  const eye = (visible: boolean, label: string, onClick: () => void) => (
    <button className="ewin-btn editor-eye" aria-pressed={visible} aria-label={visible ? `Hide ${label}` : `Show ${label}`} title={visible ? 'Hide' : 'Show'} onClick={onClick}>
      {visible ? <Eye size={14} /> : <EyeOff size={14} />}
    </button>
  );

  const activeIndex = layers.findIndex((l) => l.id === active);

  const windows: WindowDef[] = [
    {
      id: 'flat',
      title: 'Texture',
      icon: <Grid3x3 size={14} />,
      minW: 200,
      minH: 220,
      actions: (
        <>
          <button className="ewin-btn" aria-label="Zoom out" title="Zoom out (-)" disabled={flatView.zoom <= 1} onClick={() => zoomFlat(1 / 1.5)}>
            <ZoomOut size={14} />
          </button>
          <button
            className="ewin-btn editor-zoom-level"
            aria-label="Fit to the window"
            title="Fit to the window (0). Scroll to zoom, right-drag to move around."
            onClick={() => setFlatView({ zoom: 1, x: 0, y: 0 })}
          >
            {Math.round(flatView.zoom * 100)}%
          </button>
          <button className="ewin-btn" aria-label="Zoom in" title="Zoom in (+)" disabled={flatView.zoom >= 16} onClick={() => zoomFlat(1.5)}>
            <ZoomIn size={14} />
          </button>
          <button
            className="ewin-btn"
            aria-pressed={prefs.gridFlat}
            aria-label="Pixel grid"
            title={prefs.gridFlat ? 'Hide the pixel grid' : 'Show the pixel grid'}
            onClick={() => setPrefs({ gridFlat: !prefs.gridFlat })}
          >
            <Grid3x3 size={14} />
          </button>
        </>
      ),
      content: (
        <div className="editor-flat">
          <div
            ref={flatBox}
            className="editor-flat-fit"
            onPointerDown={onFlatBoxDown}
            onPointerMove={onFlatBoxMove}
            onPointerUp={onFlatBoxUp}
            onPointerCancel={onFlatBoxUp}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          >
            <canvas
              ref={flat}
              width={64 * SCALE}
              height={64 * SCALE}
              style={{ left: flatLeft, top: flatTop, width: flatSide, height: flatSide }}
              data-tool={tool}
              onPointerDown={onFlatDown}
              onPointerMove={onFlatMove}
              onPointerUp={onFlatUp}
              onPointerCancel={onFlatUp}
              onPointerLeave={() => setHover(null)}
            />
          </div>
          {placing && (
            <div className="editor-placing" role="toolbar" aria-label="Placing an image">
              <span className="editor-placing-text">Drag to move, corners to resize. Shift stretches.</span>
              <label className="editor-placing-smooth">
                <input type="checkbox" checked={placing.smooth} onChange={(e) => setPlacing({ smooth: e.target.checked })} /> Smooth
              </label>
              <button className="btn btn-ghost btn-sm" onClick={cancelPlacing}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={applyPlacing}>
                <Check size={14} /> Apply
              </button>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'model',
      title: 'Model',
      icon: <Box size={14} />,
      minW: 200,
      minH: 220,
      actions: (
        <>
          <button
            className="ewin-btn"
            aria-pressed={prefs.grid3d}
            aria-label="Pixel grid on the model"
            title={prefs.grid3d ? 'Hide the grid on the model' : 'Show a grid on the model'}
            onClick={() => setPrefs({ grid3d: !prefs.grid3d })}
          >
            <Grid3x3 size={14} />
          </button>
          <button className="ewin-btn" aria-label="Reset the view" title="Reset the view" onClick={() => setResetView((n) => n + 1)}>
            <RotateCcw size={14} />
          </button>
        </>
      ),
      content: (
        <div className="editor-model">
          {loaded ? (
            <Suspense fallback={<LoaderCircle size={24} className="spin" />}>
              <SkinPaint3D
                texture={texture}
                version={version}
                slim={slim}
                hiddenBase={hiddenBase}
                hiddenOuter={hiddenOuter}
                grid={prefs.grid3d}
                highlight={highlight}
                resetView={resetView}
                onStrokeStart={startStroke}
                onPaint={paintAt}
                onHover={setHover}
              />
            </Suspense>
          ) : (
            <LoaderCircle size={24} className="spin" />
          )}
          <p className="editor-model-hint">Left-drag to paint · right-drag to turn · scroll to zoom</p>
        </div>
      ),
    },
    {
      id: 'layers',
      title: 'Layers',
      icon: <LayersIcon size={14} />,
      minW: 200,
      minH: 160,
      actions: (
        <>
          <button className="ewin-btn" title="New layer" aria-label="New layer" onClick={newLayer}>
            <Plus size={14} />
          </button>
          <button className="ewin-btn" title="Import an image (or drop one on the editor)" aria-label="Import an image" onClick={() => importInput.current?.click()}>
            <ImagePlus size={14} />
          </button>
        </>
      ),
      content: (
        <div className="editor-layers">
          <ul className="editor-layer-list">
            {[...layers].reverse().map((l) => (
              <li key={l.id} className="editor-layer" data-active={l.id === active || undefined} data-hidden={!l.visible || undefined}>
                <button className="editor-layer-pick" onClick={() => setActive(l.id)} onDoubleClick={() => setRenaming(l.id)} title="Double-click to rename">
                  <LayerThumb canvas={l.canvas} version={version} />
                  {renaming !== l.id && (
                    <span className="editor-layer-name">
                      {l.name}
                      {l.placing && <em> · placing</em>}
                    </span>
                  )}
                </button>
                {renaming === l.id && (
                  <input
                    className="input editor-layer-name-input"
                    defaultValue={l.name}
                    autoFocus
                    maxLength={30}
                    aria-label="Layer name"
                    onBlur={(e) => {
                      updateLayer(l.id, { name: e.target.value.trim() || l.name });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                )}
                {eye(l.visible, l.name, () => updateLayer(l.id, { visible: !l.visible }))}
              </li>
            ))}
          </ul>
          {activeLayer && (
            <div className="editor-layer-foot">
              <label className="editor-opacity">
                <span>Opacity</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(activeLayer.opacity * 100)}
                  onPointerDown={checkpoint}
                  onChange={(e) => updateLayer(activeLayer.id, { opacity: Number(e.target.value) / 100 })}
                />
                <span className="editor-opacity-value">{Math.round(activeLayer.opacity * 100)}%</span>
              </label>
              <div className="editor-layer-buttons">
                <button className="ewin-btn" onClick={() => moveLayer(1)} disabled={activeIndex >= layers.length - 1} title="Move up" aria-label="Move layer up">
                  <ArrowUp size={14} />
                </button>
                <button className="ewin-btn" onClick={() => moveLayer(-1)} disabled={activeIndex < 1} title="Move down" aria-label="Move layer down">
                  <ArrowDown size={14} />
                </button>
                <button className="ewin-btn" onClick={duplicateLayer} title="Duplicate" aria-label="Duplicate layer">
                  <Copy size={14} />
                </button>
                <button className="ewin-btn" onClick={mergeDown} disabled={activeIndex < 1} title="Merge down" aria-label="Merge into the layer below">
                  <ArrowDownToLine size={14} />
                </button>
                <button className="ewin-btn" onClick={deleteLayer} disabled={layers.length < 2} title="Delete" aria-label="Delete layer">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'color',
      title: 'Color',
      icon: <Palette size={14} />,
      minW: 200,
      minH: 180,
      content: (
        <div className="editor-color">
          <div
            className="editor-sv"
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv[0]} 100% 50%))` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pickSV(e);
            }}
            onPointerMove={(e) => e.buttons === 1 && pickSV(e)}
            role="slider"
            aria-label="Saturation and brightness"
            aria-valuetext={color}
          >
            <span className="editor-sv-dot" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: color }} />
          </div>
          <input
            type="range"
            className="editor-hue"
            min={0}
            max={359}
            value={Math.round(hsv[0])}
            aria-label="Hue"
            onChange={(e) => {
              const h = Number(e.target.value);
              setHsv([h, hsv[1], hsv[2]]);
              setColorState(hsvToHex(h, hsv[1], hsv[2]));
            }}
          />
          <div className="editor-hex">
            <span className="editor-hex-swatch" style={{ background: color }} />
            <HexInput value={color} onChange={setColor} />
          </div>
          {swatches}
        </div>
      ),
    },
    {
      id: 'parts',
      title: 'Parts',
      icon: <ListTree size={14} />,
      minW: 200,
      minH: 160,
      actions: (
        <button
          className="ewin-btn editor-eye"
          aria-pressed={!allOuterHidden}
          aria-label={allOuterHidden ? 'Show all outer layers' : 'Hide all outer layers'}
          title={allOuterHidden ? 'Show all outer layers' : 'Hide all outer layers'}
          onClick={() => setHiddenOuter(allOuterHidden ? new Set() : new Set(PARTS.map((p) => p.id)))}
        >
          {allOuterHidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      ),
      content: (
        <div className="editor-parts" role="table" aria-label="Parts">
          <div className="editor-parts-head" role="row">
            <span role="columnheader">Part</span>
            <span role="columnheader" title="The skin itself">
              Base
            </span>
            <span role="columnheader" title="The layer on top: hat, jacket, sleeves and pants legs. On the model, it gets painted wherever it's shown; hide it to paint the base underneath.">
              Outer
            </span>
          </div>
          {PARTS.map((p) => (
            <div key={p.id} className="editor-part" role="row" data-hidden={(hiddenBase.has(p.id) && hiddenOuter.has(p.id)) || undefined}>
              <span role="cell">{p.label}</span>
              <span role="cell">{eye(!hiddenBase.has(p.id), p.label.toLowerCase(), () => setHiddenBase((s) => toggleIn(s, p.id)))}</span>
              <span role="cell">{eye(!hiddenOuter.has(p.id), OUTER_NAMES[p.id].toLowerCase(), () => setHiddenOuter((s) => toggleIn(s, p.id)))}</span>
            </div>
          ))}
        </div>
      ),
    },
  ];

  const toggleWindow = (winId: string) =>
    updateLayout((l) => {
      const top = Math.max(0, ...Object.values(l).map((b) => b.z));
      return { ...l, [winId]: { ...l[winId], open: !l[winId]?.open, z: top + 1 } };
    });

  return (
    <div
      className="skin-editor"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.dataTransfer.types.includes('Files') && --dragDepth.current <= 0) setDropping(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {dropping && (
        <div className="mods-drop-overlay" aria-live="polite">
          <ImagePlus size={26} />
          <strong>Drop an image to add it as a layer</strong>
        </div>
      )}
      <input
        ref={importInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          importFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />

      <div className="editor-header">
        <input className="input editor-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Skin name" placeholder="Skin name" />
        <div className="segmented" role="group" aria-label="Arm style">
          {(['classic', 'slim'] as const).map((v) => (
            <button key={v} aria-pressed={variant === v} onClick={() => setVariant(v)}>
              {v === 'slim' ? 'Slim arms' : 'Wide arms'}
            </button>
          ))}
        </div>
        <div className="editor-actions">
          <button className={confirmDiscard ? 'btn btn-danger' : 'btn btn-ghost'} onClick={cancel} disabled={saving !== null}>
            {confirmDiscard ? 'Discard changes?' : 'Cancel'}
          </button>
          <button className={canWear ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => save(false)} disabled={!loaded || saving !== null}>
            {saving === 'save' && <LoaderCircle size={16} className="spin" />} Save
          </button>
          {canWear && (
            <button className="btn btn-primary" onClick={() => save(true)} disabled={!loaded || saving !== null}>
              {saving === 'wear' && <LoaderCircle size={16} className="spin" />} Save and wear
            </button>
          )}
        </div>
      </div>

      <div className="editor-frame">
        <div className="editor-tools" role="toolbar" aria-label="Painting">
          <div className="editor-tool-group" role="group" aria-label="Tool">
            {TOOLS.map((t) => (
              <button key={t.id} className="editor-tool" aria-pressed={tool === t.id} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`} aria-label={t.label}>
                <t.icon size={16} />
              </button>
            ))}
          </div>
          <span className="editor-tool-sep" />
          <div className="editor-tool-group" role="group" aria-label="Brush size">
            {SIZES.map((s) => (
              <button
                key={s}
                className="editor-tool editor-size"
                aria-pressed={prefs.size === s}
                disabled={tool === 'fill' || tool === 'picker'}
                onClick={() => setPrefs({ size: s })}
                title={`Brush ${s}×${s} (${s})`}
                aria-label={`Brush size ${s}`}
              >
                <span style={{ width: 3 + s * 3, height: 3 + s * 3 }} />
              </button>
            ))}
          </div>
          <button
            className="editor-tool"
            aria-pressed={prefs.mirror}
            onClick={() => setPrefs({ mirror: !prefs.mirror })}
            title="Mirror: paint both sides at once (M)"
            aria-label="Mirror painting"
          >
            <FlipHorizontal2 size={16} />
          </button>
          <span className="editor-tool-sep" />
          <button className="editor-tool" onClick={doUndo} disabled={!undo.current.length} title={`Undo (${shortcut('Z')})`} aria-label="Undo">
            <Undo2 size={16} />
          </button>
          <button className="editor-tool" onClick={doRedo} disabled={!redo.current.length} title={`Redo (${isMac ? shortcut('Z', true) : shortcut('Y')})`} aria-label="Redo">
            <Redo2 size={16} />
          </button>
          <span className="editor-tool-spacer" />
          <span className="editor-tool-color" style={{ background: color }} title={`Current color ${color}`} />
          <Dropdown
            label={
              <>
                <LayoutPanelLeft size={15} /> Windows
              </>
            }
            className="editor-tool editor-tool-text"
            items={[
              ...windows.map((w) => ({
                icon: layout?.[w.id]?.open ? <Check size={16} /> : <span className="menu-icon-blank" />,
                label: w.title,
                onSelect: () => toggleWindow(w.id),
              })),
              { icon: <LayoutPanelLeft size={16} />, label: 'Reset layout', section: 'Layout', onSelect: () => setLayout(null) },
            ]}
          />
        </div>

        <EditorWindows windows={windows} layout={layout} onLayout={updateLayout} makeDefault={defaultLayout} />
      </div>
    </div>
  );
}

/** A small preview of one layer. */
function LayerThumb({ canvas, version }: { canvas: HTMLCanvasElement; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, 64, 64);
    c.imageSmoothingEnabled = false;
    c.drawImage(canvas, 0, 0);
  }, [canvas, version]);
  return <canvas ref={ref} className="editor-layer-thumb" width={64} height={64} aria-hidden="true" />;
}

/** Hex color field that only applies complete colors. */
function HexInput({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="input editor-hex-input"
      value={text}
      maxLength={7}
      spellCheck={false}
      aria-label="Hex color"
      onChange={(e) => {
        const next = e.target.value.trim();
        setText(next);
        const hex = (next.startsWith('#') ? next : `#${next}`).toLowerCase();
        if (/^#[0-9a-f]{6}$/.test(hex)) onChange(hex);
      }}
      onBlur={() => setText(value)}
    />
  );
}
