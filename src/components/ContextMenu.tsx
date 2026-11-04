import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MenuItems, type DropdownItem } from './Dropdown';

interface Props {
  /** Where it was opened, in window coordinates. */
  x: number;
  y: number;
  items: DropdownItem[];
  onClose: () => void;
}

// Kept this far from the window's edges.
const EDGE = 8;

/** A right-click menu at the pointer, moved back inside the window when it would spill out. */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      // Opens upward when there's no room below.
      top: y + height + EDGE > window.innerHeight ? Math.max(EDGE, y - height) : y,
    });
    el.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
  }, [x, y]);

  useEffect(() => {
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    // Scrolling the page would leave it floating over the wrong thing.
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="dropdown-popover context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItems items={items} onPick={onClose} />
    </div>,
    document.body,
  );
}
