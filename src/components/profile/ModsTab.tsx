import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, FolderOpen, LoaderCircle, Plus, Puzzle, RefreshCw, Search, Trash2 } from 'lucide-react';
import ModBrowser from '../mods/ModBrowser';
import ModIcon from '../mods/ModIcon';
import Toggle from '../Toggle';
import { api, errorMessage } from '../../api';
import type { InstalledMod, Profile } from '../../types';

type CheckState = 'checking' | 'done' | 'failed';

interface Props {
  profile: Profile;
  running: boolean;
  onOpenSettings: () => void;
  onError: (message: string) => void;
}

export default function ModsTab({ profile, running, onOpenSettings, onError }: Props) {
  const [mods, setMods] = useState<InstalledMod[] | null>(null);
  const [view, setView] = useState<'installed' | 'browse'>('installed');
  const [filter, setFilter] = useState('');
  const [check, setCheck] = useState<CheckState>('checking');
  // File names being updated, or 'all'.
  const [updating, setUpdating] = useState<Set<string> | 'all'>(new Set());
  const vanilla = profile.loader === 'vanilla';

  const checkUpdates = useCallback(() => {
    setCheck('checking');
    api.mods
      .checkUpdates(profile.id)
      .then((list) => {
        setMods(list);
        setCheck('done');
      })
      .catch(() => setCheck('failed'));
  }, [profile.id]);

  // Show the list straight away, then check Modrinth for updates in the background.
  useEffect(() => {
    if (vanilla) return;
    api.mods
      .list(profile.id)
      .then((list) => {
        setMods(list);
        checkUpdates();
      })
      .catch((err) => onError(errorMessage(err)));
  }, [profile.id, vanilla, onError, checkUpdates]);

  const runUpdate = async (fileNames?: string[]) => {
    setUpdating(fileNames ? (s) => (s === 'all' ? s : new Set([...s, ...fileNames])) : 'all');
    try {
      setMods(await api.mods.update(profile.id, fileNames));
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setUpdating((s) => (s === 'all' || !fileNames ? new Set() : new Set([...s].filter((f) => !fileNames.includes(f)))));
    }
  };

  const isUpdating = (fileName: string) => updating === 'all' || updating.has(fileName);
  const updateCount = mods?.filter((m) => m.updateVersion).length ?? 0;

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
            <div className="mods-updates">
              {check === 'checking' ? (
                <span className="mods-update-status">
                  <LoaderCircle size={14} className="spin" /> Checking for updates
                </span>
              ) : updateCount > 0 ? (
                <button
                  className="btn btn-primary btn-play"
                  onClick={() => runUpdate()}
                  disabled={running || updating === 'all'}
                  title={running ? 'Close the game to update mods' : undefined}
                >
                  {updating === 'all' ? <LoaderCircle size={15} className="spin" /> : <ArrowUpCircle size={15} />}
                  {updating === 'all' ? 'Updating…' : `Update all (${updateCount})`}
                </button>
              ) : (
                <>
                  <span className="mods-update-status">
                    {check === 'failed' ? 'Couldn’t check for updates' : 'All up to date'}
                  </span>
                  <button className="icon-btn" aria-label="Check for updates" onClick={checkUpdates}>
                    <RefreshCw size={15} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="mod-list">
            {shown.map((m) => (
              <div key={m.fileName} className="mod-row" data-disabled={!m.enabled || undefined}>
                <ModIcon url={m.iconUrl} size={40} />
                <div className="mod-info">
                  <div className="mod-title">{m.title}</div>
                  <span className="mod-meta">
                    {m.versionNumber ?? 'Local file'}
                    {m.updateVersion && <span className="mod-update-to">→ {m.updateVersion}</span>} · {m.fileName}
                  </span>
                </div>
                {m.updateVersion && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => runUpdate([m.fileName])}
                    disabled={running || isUpdating(m.fileName)}
                    title={running ? 'Close the game to update mods' : `Update to ${m.updateVersion}`}
                  >
                    {isUpdating(m.fileName) ? <LoaderCircle size={14} className="spin" /> : <ArrowUpCircle size={14} />}
                    Update
                  </button>
                )}
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
