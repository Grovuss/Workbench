import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface WindowDef {
  id: string;
  title: string;
  icon: ReactNode;
  minW: number;
  minH: number;
  /** Buttons in the title bar, before the close button. */
  actions?: ReactNode;
  content: ReactNode;
}

export interface WindowBox {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  open: boolean;
}

export type Layout = Record<string, WindowBox>;

interface Props {
  windows: WindowDef[];
  layout: Layout | null;
  onLayout: (update: (layout: Layout) => Layout) => void;
  /** The starting layout for a workspace of this size. */
  makeDefault: (width: number, height: number) => Layout;
}

type Edge = 'move' | 'e' | 's' | 'se' | 'w' | 'sw';

const SNAP = 4;
const snap = (n: number) => Math.round(n / SNAP) * SNAP;

/** Keeps a window inside the workspace. */
function fit(box: WindowBox, width: number, height: number, def: WindowDef): WindowBox {
  const w = Math.max(Math.min(box.w, width), Math.min(def.minW, width));
  const h = Math.max(Math.min(box.h, height), Math.min(def.minH, height));
  return { ...box, w, h, x: Math.min(Math.max(0, box.x), width - w), y: Math.min(Math.max(0, box.y), height - h) };
}

/** Windows that can be moved, resized, stacked and closed, inside a fixed area. */
export default function EditorWindows({ windows, layout, onLayout, makeDefault }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const drag = useRef<{ id: string; edge: Edge; startX: number; startY: number; box: WindowBox } | null>(null);

  useEffect(() => {
    const el = area.current!;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The first time, or when windows were added since the layout was saved.
  useEffect(() => {
    if (!size) return;
    if (!layout || windows.some((w) => !layout[w.id])) {
      const fresh = makeDefault(size.width, size.height);
      onLayout((current) => ({ ...fresh, ...(current ?? {}) }));
    }
  }, [size, layout, windows, makeDefault, onLayout]);

  const raise = (id: string) =>
    onLayout((l) => {
      const top = Math.max(0, ...Object.values(l).map((b) => b.z));
      return l[id].z === top ? l : { ...l, [id]: { ...l[id], z: top + 1 } };
    });

  const start = (e: ReactPointerEvent, id: string, edge: Edge) => {
    if (e.button !== 0 || !layout) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, edge, startX: e.clientX, startY: e.clientY, box: layout[id] };
    raise(id);
  };

  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !size) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const def = windows.find((w) => w.id === d.id)!;
    const b = { ...d.box };
    if (d.edge === 'move') {
      b.x = snap(d.box.x + dx);
      b.y = snap(d.box.y + dy);
    }
    if (d.edge === 'e' || d.edge === 'se') b.w = Math.max(def.minW, snap(d.box.w + dx));
    if (d.edge === 's' || d.edge === 'se' || d.edge === 'sw') b.h = Math.max(def.minH, snap(d.box.h + dy));
    if (d.edge === 'w' || d.edge === 'sw') {
      const w = Math.max(def.minW, snap(d.box.w - dx));
      b.x = d.box.x + d.box.w - w;
      b.w = w;
    }
    // Resizing past the edge stops at the edge; moving slides along it.
    if (d.edge !== 'move') {
      if (b.x < 0) {
        b.w += b.x;
        b.x = 0;
      }
      b.w = Math.min(b.w, size.width - b.x);
      b.h = Math.min(b.h, size.height - b.y);
    }
    const next = fit(b, size.width, size.height, def);
    onLayout((l) => ({ ...l, [d.id]: { ...next, z: l[d.id].z } }));
  };

  const end = () => {
    drag.current = null;
  };

  return (
    <div className="editor-workspace" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {/* Inset, so the gap at the edges matches the gap between windows. */}
      <div ref={area} className="editor-workspace-area">
        {size &&
          layout &&
          windows.map((def) => {
            const saved = layout[def.id];
            if (!saved?.open) return null;
            const box = fit(saved, size.width, size.height, def);
            return (
              <section
                key={def.id}
                className="ewin"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: box.z }}
                onPointerDownCapture={() => raise(def.id)}
                aria-label={def.title}
              >
                <header className="ewin-head" onPointerDown={(e) => start(e, def.id, 'move')}>
                  <span className="ewin-title">
                    {def.icon}
                    {def.title}
                  </span>
                  <span className="ewin-actions" onPointerDown={(e) => e.stopPropagation()}>
                    {def.actions}
                    <button
                      className="ewin-btn"
                      aria-label={`Close ${def.title}`}
                      title="Close (reopen it from Windows)"
                      onClick={() => onLayout((l) => ({ ...l, [def.id]: { ...l[def.id], open: false } }))}
                    >
                      <X size={14} />
                    </button>
                  </span>
                </header>
                <div className="ewin-body">{def.content}</div>
                {(['e', 's', 'w', 'se', 'sw'] as const).map((edge) => (
                  <span key={edge} className={`ewin-resize ewin-resize-${edge}`} onPointerDown={(e) => start(e, def.id, edge)} aria-hidden="true" />
                ))}
              </section>
            );
          })}
      </div>
    </div>
  );
}
