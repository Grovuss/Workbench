import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Plus, Puzzle, Search, Trash2 } from 'lucide-react';
import ModBrowser from '../mods/ModBrowser';
import ModIcon from '../mods/ModIcon';
import Toggle from '../Toggle';
import { api, errorMessage } from '../../api';
import type { InstalledMod, Profile } from '../../types';

interface Props {
  profile: Profile;
  onOpenSettings: () => void;
  onError: (message: string) => void;
}

export default function ModsTab({ profile, onOpenSettings, onError }: Props) {
  const [mods, setMods] = useState<InstalledMod[] | null>(null);
  const [view, setView] = useState<'installed' | 'browse'>('installed');
  const [filter, setFilter] = useState('');
  const vanilla = profile.loader === 'vanilla';

  useEffect(() => {
    if (vanilla) return;
    api.mods
      .list(profile.id)
      .then(setMods)
      .catch((err) => onError(errorMessage(err)));
  }, [profile.id, vanilla, onError]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (mods ?? []).filter((m) => !q || m.title.toLowerCase().includes(q) || m.fileName.toLowerCase().includes(q));
  }, [mods, filter]);

  if (vanilla) {
    return (
      <div className="empty empty-compact">
        <Puzzle className="empty-icon" size={40} strokeWidth={1.5} />
        <h2>Mods need a mod loader</h2>
        <p>Switch this profile to Fabric, Quilt, Forge or NeoForge to add mods.</p>
        <button className="btn btn-secondary" onClick={onOpenSettings}>
          Open settings
        </button>
      </div>
    );
  }

  const update = (pending: Promise<InstalledMod[]>) => pending.then(setMods).catch((err) => onError(errorMessage(err)));
  const enabledCount = mods?.filter((m) => m.enabled).length ?? 0;

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Mods view">
          <button aria-pressed={view === 'installed'} onClick={() => setView('installed')}>
            Installed{mods ? ` · ${mods.length}` : ''}
          </button>
          <button aria-pressed={view === 'browse'} onClick={() => setView('browse')}>
            <Plus size={14} /> Add mods
          </button>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => api.profiles.openFolder(profile.id, 'mods').catch((err) => onError(errorMessage(err)))}
        >
          <FolderOpen size={15} /> Open mods folder
        </button>
      </div>

      {view === 'browse' && mods && (
        <ModBrowser profile={profile} installed={mods} onInstalled={setMods} onError={onError} />
      )}

      {view === 'installed' && mods && mods.length === 0 && (
        <div className="empty empty-compact">
          <Puzzle className="empty-icon" size={40} strokeWidth={1.5} />
          <h2>No mods yet</h2>
          <p>Browse Modrinth for mods that work with this profile.</p>
          <button className="btn btn-primary" onClick={() => setView('browse')}>
            <Plus size={16} /> Add mods
          </button>
        </div>
      )}

      {view === 'installed' && mods && mods.length > 0 && (
        <>
          <div className="mods-subbar">
            <label className="search-field search-field-sm">
              <Search size={15} />
              <input
                className="input"
                value={filter}
                placeholder="Filter installed mods"
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <span className="toolbar-title">
              {enabledCount} of {mods.length} enabled
            </span>
          </div>
          <div className="mod-list">
            {shown.map((m) => (
              <div key={m.fileName} className="mod-row" data-disabled={!m.enabled || undefined}>
                <ModIcon url={m.iconUrl} size={40} />
                <div className="mod-info">
                  <div className="mod-title">{m.title}</div>
                  <span className="mod-meta">
                    {m.versionNumber ?? 'Local file'} · {m.fileName}
                  </span>
                </div>
                <Toggle
                  label={`${m.enabled ? 'Disable' : 'Enable'} ${m.title}`}
                  checked={m.enabled}
                  onChange={(on) => update(api.mods.setEnabled(profile.id, m.fileName, on))}
                />
                <button
                  className="icon-btn icon-btn-danger"
                  aria-label={`Remove ${m.title}`}
                  onClick={() => update(api.mods.remove(profile.id, m.fileName))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
