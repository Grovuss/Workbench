import { Layers, Package, Puzzle, Settings, type LucideIcon } from 'lucide-react';
import logo from '../assets/logo.svg';
import AccountMenu from './AccountMenu';
import type { AccountsState, Page } from '../types';

const NAV: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'profiles', label: 'Profiles', icon: Layers },
  { id: 'import', label: 'Import Pack', icon: Package },
  { id: 'mods', label: 'Mods', icon: Puzzle },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  accounts: AccountsState;
  onLogin: () => void;
  onSwitchAccount: (id: string) => void;
  onLogout: (id: string) => void;
}

export default function Sidebar({ page, onNavigate, accounts, onLogin, onSwitchAccount, onLogout }: Props) {
  return (
    <aside className="sidebar">
      <div className="logo">
        <img src={logo} alt="" />
        <span className="logo-text">workbench</span>
      </div>

      <nav className="nav" aria-label="Main">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className="nav-item"
            aria-current={page === id ? 'page' : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon size={18} strokeWidth={2} />
            {label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <AccountMenu accounts={accounts} onLogin={onLogin} onSwitch={onSwitchAccount} onLogout={onLogout} />
        <span className="sidebar-version">Workbench v0.2</span>
      </div>
    </aside>
  );
}
