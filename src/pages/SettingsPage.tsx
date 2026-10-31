import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Monitor, Moon, Sun } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { api, errorMessage } from '../api';
import type { SystemInfo, ThemePreference } from '../types';

const THEMES: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

const formatGb = (mb: number) => `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;

interface Props {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onError: (message: string) => void;
}

export default function SettingsPage({ theme, onThemeChange, onError }: Props) {
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const saveTimer = useRef<number>();

  useEffect(() => {
    Promise.all([api.settings.get(), api.system.info()])
      .then(([s, info]) => {
        setMemoryMb(s.memoryMb);
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

  // Leave a little headroom for the OS.
  const maxMemory = system ? Math.max(1024, Math.floor((system.totalMemoryMb - 1024) / 512) * 512) : 8192;

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
    </>
  );
}
