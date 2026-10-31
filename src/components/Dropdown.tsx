import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface DropdownItem {
  icon: ReactNode;
  label: string;
  /** A second line under the label. */
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface Props {
  label: ReactNode;
  className?: string;
  disabled?: boolean;
  items: DropdownItem[];
  /** Hide the chevron, for icon-only buttons. */
  chevron?: boolean;
  /** Accessible name when the label is just an icon. */
  ariaLabel?: string;
}

/** A button that opens a menu below it, right-aligned. */
export default function Dropdown({ label, className = 'btn btn-secondary', disabled, items, chevron = true, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {chevron && <ChevronDown size={15} className="dropdown-chevron" />}
      </button>
      {open && (
        <div className="dropdown-popover" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={item.danger ? 'menu-item menu-danger' : 'menu-item'}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              <span className="menu-item-text">
                <span>{item.label}</span>
                {item.hint && <small>{item.hint}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
