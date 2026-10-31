import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Monitor, Moon, Sun } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Toggle from '../components/Toggle';
import { api, errorMessage } from '../api';
import { formatGb, maxMemoryMb } from '../memory';
import type { Settings, SystemInfo, ThemePreference } from '../types';

const THEMES: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];


interface Props {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onError: (message: string) => void;
}

export default function SettingsPage({ theme, onThemeChange, onError }: Props) {
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const [toggles, setToggles] = useState<Pick<Settings, 'autoBackup' | 'discordPresence' | 'shareOptions'> | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const saveTimer = useRef<number>();

  useEffect(() => {
    Promise.all([api.settings.get(), api.system.info()])
      .then(([s, info]) => {
        setMemoryMb(s.memoryMb);
        setToggles({ autoBackup: s.autoBackup, discordPresence: s.discordPresence, shareOptions: s.shareOptions });
        setSystem(info);
      })
      .catch((err) => onError(errorMessage(err)));
  }, [onError]);

  const changeMemory = (mb: number) => {
    setMemoryMb(mb);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.settings.set({ memoryMb: mb }).catch((err) => onError(errorMessage(err)));
    }, 300);
  };

  const setToggle = (key: keyof NonNullable<typeof toggles>, value: boolean) => {
    setToggles((t) => t && { ...t, [key]: value });
    api.settings.set({ [key]: value }).catch((err) => onError(errorMessage(err)));
  };

  const maxMemory = system ? maxMemoryMb(system.totalMemoryMb) : 8192;

  return (
    <>
      <PageHeader title="Settings" subtitle="Customize how Workbench looks and behaves" />

      <h2 className="section-label section-label-first">Appearance</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <h3>Theme</h3>
            <p>Cream or charcoal, or follow your system.</p>
          </div>
          <div className="segmented" role="group" aria-label="Theme">
            {THEMES.map(({ id, label, icon: Icon }) => (
              <button key={id} aria-pressed={theme === id} onClick={() => onThemeChange(id)}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <h2 className="section-label">Game</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <h3>Memory</h3>
            <p>Maximum RAM Minecraft can use. 4 GB is plenty for vanilla.</p>
          </div>
          {memoryMb !== null && (
            <div className="memory-control">
              <input
                type="range"
                className="range"
                min={1024}
                max={maxMemory}
                step={512}
                value={Math.min(memoryMb, maxMemory)}
                onChange={(e) => changeMemory(Number(e.target.value))}
                aria-label="Memory"
              />
              <span className="memory-value">{formatGb(memoryMb)}</span>
            </div>
          )}
        </div>
        {toggles && (
          <div className="settings-row">
            <div>
              <h3>Share game settings</h3>
              <p>New profiles start with the keybinds, video and sound settings of the profile you played last.</p>
            </div>
            <Toggle label="Share game settings" checked={toggles.shareOptions} onChange={(on) => setToggle('shareOptions', on)} />
          </div>
        )}
        <div className="settings-row">
          <div>
            <h3>Data folder</h3>
            <p className="path-text">{system?.dataDir ?? '…'}</p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => api.system.openDataFolder().catch((err) => onError(errorMessage(err)))}
          >
            <FolderOpen size={15} /> Open
          </button>
        </div>
      </div>

      {toggles && (
        <>
          <h2 className="section-label">Worlds</h2>
          <div className="settings-group">
            <div className="settings-row">
              <div>
                <h3>Back up worlds automatically</h3>
                <p>After you play, worlds that changed are backed up. The last 5 are kept for each world.</p>
              </div>
              <Toggle label="Back up worlds automatically" checked={toggles.autoBackup} onChange={(on) => setToggle('autoBackup', on)} />
            </div>
          </div>

          <h2 className="section-label">Discord</h2>
          <div className="settings-group">
            <div className="settings-row">
              <div>
                <h3>Show what you’re playing</h3>
                <p>
                  {system?.discord
                    ? 'Your Discord status shows the profile you’re playing and for how long.'
                    : 'Not set up in this build of Workbench yet.'}
                </p>
              </div>
              <Toggle
                label="Show what you’re playing on Discord"
                checked={toggles.discordPresence && Boolean(system?.discord)}
                disabled={!system?.discord}
                onChange={(on) => setToggle('discordPresence', on)}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
