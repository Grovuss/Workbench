import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ArrowUpCircle,
  FolderOpen,
  Info,
  LoaderCircle,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import ContentBrowser from './ContentBrowser';
import ContentIcon from './ContentIcon';
import Toggle from '../Toggle';
import { api, errorMessage } from '../../api';
import { CONTENT, IRIS_PROJECT_ID, contentBlockedReason } from '../../content';
import type { ContentTarget, InstalledContent, Profile } from '../../types';

type CheckState = 'checking' | 'done' | 'failed';

const HINTS: Partial<Record<ContentTarget['kind'], string>> = {
  resourcepack: 'Turn packs on in game under Options → Resource Packs.',
  shader: 'Pick a shader in game under Options → Video Settings → Shader Packs.',
  datapack: 'Data packs load when the world opens, so reopen the world after changing them.',
};

interface Props {
  profile: Profile;
  target: ContentTarget;
  running: boolean;
  onOpenSettings?: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

/** Installed mods, resource packs, shaders or data packs, plus Modrinth search and drag-and-drop. */
export default function ContentTab({ profile, target, running, onOpenSettings, onError, onSuccess }: Props) {
  const { kind, world } = target;
  const labels = CONTENT[kind];
  const [items, setItems] = useState<InstalledContent[] | null>(null);
  const [view, setView] = useState<'installed' | 'browse'>('installed');
  const [filter, setFilter] = useState('');
  const [check, setCheck] = useState<CheckState>('checking');
  // File names being updated, or 'all'.
  const [updating, setUpdating] = useState<Set<string> | 'all'>(new Set());
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const dragDepth = useRef(0);
  const blocked = contentBlockedReason(kind, profile.loader);

  const checkUpdates = useCallback(() => {
    setCheck('checking');
    api.content
      .checkUpdates({ profileId: profile.id, kind, world })
      .then((list) => {
        setItems(list);
        setCheck('done');
      })
      .catch(() => setCheck('failed'));
  }, [profile.id, kind, world]);

  // Show the list straight away, then check Modrinth for updates in the background.
  useEffect(() => {
    if (blocked) return;
    setItems(null);
    api.content
      .list({ profileId: profile.id, kind, world })
      .then((list) => {
        setItems(list);
        checkUpdates();
      })
      .catch((err) => onError(errorMessage(err)));
  }, [profile.id, kind, world, blocked, onError, checkUpdates]);

  const runUpdate = async (fileNames?: string[]) => {
    setUpdating(fileNames ? (s) => (s === 'all' ? s : new Set([...s, ...fileNames])) : 'all');
    try {
      setItems(await api.content.update(target, fileNames));
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setUpdating((s) => (s === 'all' || !fileNames ? new Set() : new Set([...s].filter((f) => !fileNames.includes(f)))));
    }
  };

  const isUpdating = (fileName: string) => updating === 'all' || updating.has(fileName);
  const updateCount = items?.filter((m) => m.updateVersion).length ?? 0;

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (items ?? []).filter((m) => !q || m.title.toLowerCase().includes(q) || m.fileName.toLowerCase().includes(q));
  }, [items, filter]);

  if (blocked) {
    return (
      <div className="empty empty-compact">
        <Puzzle className="empty-icon" size={40} strokeWidth={1.5} />
        <h2>{labels.title} need a mod loader</h2>
        <p>{blocked}</p>
        {onOpenSettings && (
          <button className="btn btn-secondary" onClick={onOpenSettings}>
            Open settings
          </button>
        )}
      </div>
    );
  }

  const apply = (pending: Promise<InstalledContent[]>) => pending.then(setItems).catch((err) => onError(errorMessage(err)));
  const enabledCount = items?.filter((m) => m.enabled).length ?? 0;

  // dragenter/dragleave fire for every child element, so count depth rather than toggling.
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (hasFiles(e) && --dragDepth.current <= 0) setDragging(false);
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...e.dataTransfer.files];
    const accepted = files.filter((f) => f.name.toLowerCase().endsWith(labels.ext));
    if (!accepted.length) return onError(`Only ${labels.ext} files can be added as ${labels.nounPlural}.`);
    setAdding(true);
    try {
      setItems(await api.content.addFiles(target, accepted.map((f) => api.pathForFile(f))));
      setView('installed');
      const skipped = files.length - accepted.length;
      onSuccess(
        `Added ${accepted.length === 1 ? accepted[0].name : `${accepted.length} ${labels.nounPlural}`}` +
          (skipped ? ` (skipped ${skipped} other file${skipped === 1 ? '' : 's'})` : '') +
          '.',
      );
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      className="mods-drop"
      data-active={dragging || adding || undefined}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {(dragging || adding) && (
        <div className="mods-drop-overlay" aria-live="polite">
          {adding ? <LoaderCircle size={26} className="spin" /> : <Upload size={26} />}
          <strong>{adding ? `Adding ${labels.nounPlural}…` : `Drop ${labels.ext} files to add them`}</strong>
          {!adding && <span>They’ll be copied into this {world ? 'world' : 'profile'}.</span>}
        </div>
      )}
      <div className="toolbar">
        <div className="segmented" role="group" aria-label={`${labels.title} view`}>
          <button aria-pressed={view === 'installed'} onClick={() => setView('installed')}>
            Installed{items ? ` · ${items.length}` : ''}
          </button>
          <button aria-pressed={view === 'browse'} onClick={() => setView('browse')}>
            <Plus size={14} /> Add {labels.nounPlural}
          </button>
        </div>
        <button className="btn btn-ghost" onClick={() => api.content.openFolder(target).catch((err) => onError(errorMessage(err)))}>
          <FolderOpen size={15} /> Open folder
        </button>
      </div>

      {kind === 'shader' && <ShaderLoaderNotice profile={profile} onError={onError} onSuccess={onSuccess} />}

      {view === 'browse' && items && (
        <ContentBrowser profile={profile} target={target} installed={items} onInstalled={setItems} onError={onError} />
      )}

      {view === 'installed' && items && items.length === 0 && (
        <div className="empty empty-compact">
          <Puzzle className="empty-icon" size={40} strokeWidth={1.5} />
          <h2>No {labels.nounPlural} yet</h2>
          <p>
            Browse Modrinth for {labels.nounPlural} that work with this profile, or drop {labels.ext} files here.
          </p>
          <button className="btn btn-primary" onClick={() => setView('browse')}>
            <Plus size={16} /> Add {labels.nounPlural}
          </button>
        </div>
      )}

      {view === 'installed' && items && items.length > 0 && (
        <>
          <div className="mods-subbar">
            <label className="search-field search-field-sm">
              <Search size={15} />
              <input
                className="input"
                value={filter}
                placeholder={`Filter ${labels.nounPlural}`}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <span className="toolbar-title">
              {enabledCount} of {items.length} enabled
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
                  title={running ? 'Close the game to update' : undefined}
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
                <ContentIcon url={m.iconUrl} size={40} />
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
                    title={running ? 'Close the game to update' : `Update to ${m.updateVersion}`}
                  >
                    {isUpdating(m.fileName) ? <LoaderCircle size={14} className="spin" /> : <ArrowUpCircle size={14} />}
                    Update
                  </button>
                )}
                <Toggle
                  label={`${m.enabled ? 'Disable' : 'Enable'} ${m.title}`}
                  checked={m.enabled}
                  onChange={(on) => apply(api.content.setEnabled(target, m.fileName, on))}
                />
                <button
                  className="icon-btn icon-btn-danger"
                  aria-label={`Remove ${m.title}`}
                  onClick={() => apply(api.content.remove(target, m.fileName))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          {HINTS[kind] && <p className="content-hint">{HINTS[kind]}</p>}
        </>
      )}
    </div>
  );
}

/** Shaders only run with Iris (or OptiFine on Forge); offer to install Iris when it's missing. */
function ShaderLoaderNotice({
  profile,
  onError,
  onSuccess,
}: Pick<Props, 'profile' | 'onError' | 'onSuccess'>) {
  const [hasIris, setHasIris] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const forge = profile.loader === 'forge';

  useEffect(() => {
    if (forge) return;
    api.content
      .list({ profileId: profile.id, kind: 'mod' })
      .then((mods) => setHasIris(mods.some((m) => m.projectId === IRIS_PROJECT_ID && m.enabled)))
      .catch(() => setHasIris(null));
  }, [profile.id, forge]);

  const installIris = async () => {
    setInstalling(true);
    try {
      await api.content.install({ profileId: profile.id, kind: 'mod' }, IRIS_PROJECT_ID);
      setHasIris(true);
      onSuccess('Installed Iris. Shaders are ready to use.');
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setInstalling(false);
    }
  };

  let body: ReactNode = null;
  if (forge) {
    body = (
      <>
        <Info size={18} />
        <p>
          Forge can’t run Iris. Shaders need OptiFine or Oculus: download one and drop the jar into the Mods tab.
        </p>
      </>
    );
  } else if (hasIris === false) {
    body = (
      <>
        <Sparkles size={18} />
        <p>Shaders need the Iris mod, which isn’t installed in this profile.</p>
        <button className="btn btn-primary btn-play" onClick={installIris} disabled={installing}>
          {installing ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}
          {installing ? 'Installing…' : 'Install Iris'}
        </button>
      </>
    );
  }
  return body && <div className="content-notice">{body}</div>;
}
