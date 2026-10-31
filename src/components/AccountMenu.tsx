import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, LogIn, LogOut, UserPlus } from 'lucide-react';
import SkinHead from './SkinHead';
import type { AccountsState } from '../types';

interface Props {
  accounts: AccountsState;
  onLogin: () => void;
  onSwitch: (id: string) => void;
  onLogout: (id: string) => void;
}

export default function AccountMenu({ accounts, onLogin, onSwitch, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = accounts.accounts.find((a) => a.id === accounts.activeId);

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

  if (!active) {
    return (
      <button className="account-card account-signin" onClick={onLogin}>
        <span className="account-signin-icon">
          <LogIn size={18} />
        </span>
        <span className="account-text">
          <strong>Sign in</strong>
          <span>Microsoft account</span>
        </span>
      </button>
    );
  }

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="account-menu" ref={ref}>
      {open && (
        <div className="account-popover" role="menu">
          {accounts.accounts.map((a) => (
            <button key={a.id} role="menuitem" className="menu-item" onClick={run(() => onSwitch(a.id))}>
              <SkinHead skinUrl={a.skinUrl} name={a.name} size={22} />
              <span className="menu-item-label">{a.name}</span>
              {a.id === active.id && <Check size={16} className="menu-check" />}
            </button>
          ))}
          <div className="menu-sep" />
          <button role="menuitem" className="menu-item" onClick={run(onLogin)}>
            <UserPlus size={16} /> Add account
          </button>
          <button role="menuitem" className="menu-item menu-danger" onClick={run(() => onLogout(active.id))}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}

      <button
        className="account-card"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SkinHead skinUrl={active.skinUrl} name={active.name} />
        <span className="account-text">
          <span className="account-label">Playing as</span>
          <strong>{active.name}</strong>
        </span>
        <ChevronsUpDown size={16} className="account-chevron" />
      </button>
    </div>
  );
}
