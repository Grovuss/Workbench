import { Compass, Download, Layers, Play, Settings, Shirt, type LucideIcon } from 'lucide-react';
import AccountMenu from './AccountMenu';
import ProfileIcon from './ProfileIcon';
import { version } from '../../package.json';
import type { AccountsState, LaunchStatus, Page, Profile, UpdateStatus } from '../types';

const NAV: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'profiles', label: 'Profiles', icon: Layers },
  { id: 'browse', label: 'Browse', icon: Compass },
  { id: 'skins', label: 'Skins', icon: Shirt },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  accounts: AccountsState;
  onLogin: () => void;
  onSwitchAccount: (id: string) => void;
  onLogout: (id: string) => void;
  update: UpdateStatus | null;
  onInstallUpdate: () => void;
  pinned: Profile[];
  /** The profile whose page is open, to highlight its pin. */
  currentProfileId: string | null;
  launches: Record<string, LaunchStatus>;
  onOpenProfile: (id: string) => void;
  onPlay: (profile: Profile) => void;
}

export default function Sidebar({
  page,
  onNavigate,
  accounts,
  onLogin,
  onSwitchAccount,
  onLogout,
  update,
  onInstallUpdate,
  pinned,
  currentProfileId,
  launches,
  onOpenProfile,
  onPlay,
}: Props) {
  return (
    <aside className="sidebar">
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

      {pinned.length > 0 && (
        <div className="sidebar-pins">
          <h2 className="sidebar-heading">Pinned</h2>
          {pinned.map((p) => {
            const state: string = launches[p.id]?.state ?? 'idle';
            return (
              <div key={p.id} className="sidebar-pin" aria-current={currentProfileId === p.id ? 'page' : undefined}>
                <button className="sidebar-pin-open" onClick={() => onOpenProfile(p.id)} title={p.name}>
                  <ProfileIcon profile={p} className="sidebar-pin-icon" />
                  <span className="sidebar-pin-name">{p.name}</span>
                  {state !== 'idle' && <span className="running-dot" aria-label={state === 'running' ? 'Running' : 'Starting'} />}
                </button>
                {state === 'idle' && (
                  <button className="sidebar-pin-play" onClick={() => onPlay(p)} aria-label={`Play ${p.name}`} title="Play">
                    <Play size={12} fill="currentColor" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="sidebar-footer">
        <AccountMenu accounts={accounts} onLogin={onLogin} onSwitch={onSwitchAccount} onLogout={onLogout} />
        {update?.state === 'ready' ? (
          <button className="sidebar-update" onClick={onInstallUpdate} title="Restarts Workbench into the new version">
            <Download size={15} />
            <span>
              Update to v{update.version}
              <small>Restart to install</small>
            </span>
          </button>
        ) : (
          <span className="sidebar-version">Workbench v{version}</span>
        )}
      </div>
    </aside>
  );
}
