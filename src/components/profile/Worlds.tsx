import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import {
  ArchiveRestore,
  ChevronLeft,
  Copy,
  FileArchive,
  FolderInput,
  FolderOpen,
  Globe,
  History,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import ContentTab from '../content/ContentTab';
import Dropdown from '../Dropdown';
import Modal from '../Modal';
import { api, errorMessage } from '../../api';
import { LOADER_LABELS } from '../../loaders';
import { formatBytes } from '../../format';
import { timeAgo } from '../../time';
import type { Profile, QuickPlay, World, WorldBackup } from '../../types';

/** Quick play (open a world from the launcher) arrived in 1.20; year-numbered versions (26.x) have it too. */
export function supportsWorldQuickPlay(mcVersion: string) {
  const [major, minor] = mcVersion.split(/[.-]/).map(Number);
  return major > 1 || (major === 1 && minor >= 20);
}

const MODE_LABELS: Record<NonNullable<World['gameMode']>, string> = {
  survival: 'Survival',
  creative: 'Creative',
  adventure: 'Adventure',
  spectator: 'Spectator',
};

const BACKUP_LABELS: Record<WorldBackup['kind'], string> = {
  auto: 'After playing',
  manual: 'Backed up by you',
  restore: 'Before restoring',
  update: 'Before a modpack update',
};

export function modeLabel(world: World) {
  if (world.hardcore) return 'Hardcore';
  return world.gameMode ? MODE_LABELS[world.gameMode] : null;
}

interface Props {
  profile: Profile;
  running: boolean;
  launching: boolean;
  onPlay: (quickPlay: QuickPlay) => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  /** The Worlds/Servers switch, shown at the start of the toolbar. */
  switcher: ReactNode;
}

type Action = { type: 'rename' | 'copyTo' | 'moveTo' | 'delete'; world: World };

export default function Worlds({ profile, running, launching, onPlay, onError, onSuccess, switcher }: Props) {
  const [worlds, setWorlds] = useState<World[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const dragDepth = useRef(0);
  const profileId = profile.id;
  const canQuickPlay = supportsWorldQuickPlay(profile.mcVersion);

  const reload = useCallback(() => {
    api.profiles
      .worlds(profileId)
      .then(setWorlds)
      .catch((err) => onError(errorMessage(err)));
  }, [profileId, onError]);

  // Reload when the game stops, since that's when new worlds (and backups) appear.
  useEffect(reload, [reload, running]);

  const run = async (pending: Promise<World[] | null>, message?: string) => {
    try {
      const list = await pending;
      if (list) {
        setWorlds(list);
        if (message) onSuccess(message);
      }
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const add = async (pending: () => Promise<World[] | null>) => {
    setAdding(true);
    await run(pending(), 'World added.');
    setAdding(false);
  };

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f));
    if (!paths.length || running) return;
    add(async () => {
      let list: World[] | null = null;
      for (const p of paths) list = await api.worlds.importPath(profileId, p);
      return list;
    });
  };

  if (!worlds) return null;

  const world = worlds.find((w) => w.folder === selected);
  if (world) {
    return (
      <WorldDetail
        profile={profile}
        world={world}
        running={running}
        launching={launching}
        canQuickPlay={canQuickPlay}
        onBack={() => {
          setSelected(null);
          reload();
        }}
        onPlay={onPlay}
        onError={onError}
        onSuccess={onSuccess}
      />
    );
  }

  const menu = (w: World) => [
    { icon: <Pencil size={16} />, label: 'Rename', onSelect: () => setAction({ type: 'rename', world: w }), disabled: running },
    {
      icon: <Copy size={16} />,
      label: 'Duplicate',
      onSelect: () => run(api.worlds.copy(profileId, w.folder), `Copied ${w.name}.`),
      disabled: running,
    },
    { icon: <FolderInput size={16} />, label: 'Copy to another profile', onSelect: () => setAction({ type: 'copyTo', world: w }) },
    { icon: <FolderInput size={16} />, label: 'Move to another profile', onSelect: () => setAction({ type: 'moveTo', world: w }), disabled: running },
    { icon: <History size={16} />, label: 'Backups', onSelect: () => setSelected(w.folder) },
    { icon: <Trash2 size={16} />, label: 'Delete', onSelect: () => setAction({ type: 'delete', world: w }), disabled: running, danger: true },
  ];

  return (
    <div
      className="mods-drop"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (hasFiles(e) && --dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {(dragging || adding) && (
        <div className="mods-drop-overlay" aria-live="polite">
          {adding ? <LoaderCircle size={26} className="spin" /> : <Upload size={26} />}
          <strong>{adding ? 'Adding world…' : 'Drop a world folder or .zip to add it'}</strong>
        </div>
      )}

      <div className="toolbar">
        <div className="toolbar-lead">
          {switcher}
          <span className="toolbar-title">
            {worlds.length} {worlds.length === 1 ? 'world' : 'worlds'}
          </span>
        </div>
        <div className="toolbar-actions">
          <button
            className="btn btn-ghost"
            onClick={() => api.profiles.openFolder(profileId, 'saves').catch((err) => onError(errorMessage(err)))}
          >
            <FolderOpen size={15} /> Open saves folder
          </button>
          <Dropdown
            label={
              <>
                <Plus size={16} /> Add world
              </>
            }
            disabled={running || adding}
            items={[
              { icon: <FolderOpen size={16} />, label: 'From a folder', hint: 'A world folder with level.dat in it', onSelect: () => add(() => api.worlds.import(profileId, 'folder')) },
              { icon: <FileArchive size={16} />, label: 'From a .zip', hint: 'Downloaded maps usually come like this', onSelect: () => add(() => api.worlds.import(profileId, 'zip')) },
            ]}
          />
        </div>
      </div>

      {worlds.length === 0 ? (
        <div className="empty empty-compact">
          <Globe className="empty-icon" size={40} strokeWidth={1.5} />
          <h2>No worlds yet</h2>
          <p>Worlds you create in this profile show up here. You can also drop in a downloaded map.</p>
        </div>
      ) : (
        <div className="world-list">
          {worlds.map((w) => (
            <div
              key={w.folder}
              className="world-card world-card-button"
              role="button"
              tabIndex={0}
              onClick={() => setSelected(w.folder)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                  e.preventDefault();
                  setSelected(w.folder);
                }
              }}
            >
              <WorldIcon world={w} />
              <div className="world-info">
                <div className="world-name">{w.name}</div>
                <div className="world-meta">
                  {[modeLabel(w), `Played ${timeAgo(w.lastPlayedAt)}`].filter(Boolean).join(' · ')}
                </div>
                <div className="world-meta world-meta-faint">
                  {formatBytes(w.sizeBytes)}
                  {w.lastBackupAt ? ` · Backed up ${timeAgo(w.lastBackupAt)}` : ' · No backups'}
                </div>
              </div>
              <div className="world-actions">
                {canQuickPlay && (
                  <button
                    className="icon-btn icon-btn-play"
                    aria-label={`Play ${w.name}`}
                    title="Play this world"
                    disabled={launching}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlay({ world: w.folder });
                    }}
                  >
                    <Play size={16} />
                  </button>
                )}
                <Dropdown label={<MoreHorizontal size={16} />} className="icon-btn" chevron={false} ariaLabel={`More for ${w.name}`} items={menu(w)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {action?.type === 'rename' && (
        <RenameModal
          world={action.world}
          onClose={() => setAction(null)}
          onSave={async (name) => {
            setWorlds(await api.worlds.rename(profileId, action.world.folder, name));
            setAction(null);
          }}
        />
      )}
      {(action?.type === 'copyTo' || action?.type === 'moveTo') && (
        <TargetProfileModal
          profile={profile}
          world={action.world}
          move={action.type === 'moveTo'}
          onClose={() => setAction(null)}
          onDone={(list, target) => {
            setWorlds(list);
            setAction(null);
            onSuccess(`${action.type === 'moveTo' ? 'Moved' : 'Copied'} ${action.world.name} to ${target.name}.`);
          }}
        />
      )}
      {action?.type === 'delete' && (
        <Modal
          title={`Delete ${action.world.name}?`}
          onClose={() => setAction(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setAction(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger-fill"
                onClick={() => {
                  run(api.worlds.remove(profileId, action.world.folder), `${action.world.name} is in the Recycle Bin.`);
                  setAction(null);
                }}
              >
                Delete world
              </button>
            </>
          }
        >
          <p className="modal-text">
            It goes to the Recycle Bin, so you can still get it back from there.
            {action.world.backupCount > 0 && ` Its ${action.world.backupCount === 1 ? 'backup stays' : `${action.world.backupCount} backups stay`} too.`}
          </p>
        </Modal>
      )}
    </div>
  );
}

export function WorldIcon({ world }: { world: World }) {
  return world.icon ? (
    <img className="world-icon" src={world.icon} alt="" />
  ) : (
    <div className="world-icon">
      <Globe size={20} />
    </div>
  );
}

// ---------- One world: data packs and backups ----------

function WorldDetail({
  profile,
  world,
  running,
  launching,
  canQuickPlay,
  onBack,
  onPlay,
  onError,
  onSuccess,
}: {
  profile: Profile;
  world: World;
  running: boolean;
  launching: boolean;
  canQuickPlay: boolean;
  onBack: () => void;
  onPlay: (quickPlay: QuickPlay) => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const [view, setView] = useState<'datapacks' | 'backups'>('datapacks');

  return (
    <>
      <div className="world-header">
        <button className="btn btn-ghost" onClick={onBack}>
          <ChevronLeft size={16} /> Worlds
        </button>
        <WorldIcon world={world} />
        <div className="world-info">
          <div className="world-name">{world.name}</div>
          <div className="world-meta">
            {[modeLabel(world), world.version && `Minecraft ${world.version}`, formatBytes(world.sizeBytes)].filter(Boolean).join(' · ')}
          </div>
        </div>
        {canQuickPlay && (
          <button className="btn btn-primary btn-play world-header-play" disabled={launching} onClick={() => onPlay({ world: world.folder })}>
            <Play size={15} /> Play
          </button>
        )}
      </div>
      <div className="segmented worlds-switch" role="group" aria-label="World section">
        <button aria-pressed={view === 'datapacks'} onClick={() => setView('datapacks')}>
          Data packs
        </button>
        <button aria-pressed={view === 'backups'} onClick={() => setView('backups')}>
          <History size={14} /> Backups
        </button>
      </div>
      {view === 'datapacks' ? (
        <ContentTab
          key={world.folder}
          profile={profile}
          kinds={['datapack']}
          world={world.folder}
          running={running}
          onError={onError}
          onSuccess={onSuccess}
        />
      ) : (
        <Backups profileId={profile.id} world={world} running={running} onError={onError} onSuccess={onSuccess} />
      )}
    </>
  );
}

function Backups({
  profileId,
  world,
  running,
  onError,
  onSuccess,
}: {
  profileId: string;
  world: World;
  running: boolean;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const [backups, setBackups] = useState<WorldBackup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<WorldBackup | null>(null);

  useEffect(() => {
    api.worlds
      .backups(profileId, world.folder)
      .then(setBackups)
      .catch((err) => onError(errorMessage(err)));
  }, [profileId, world.folder, running, onError]);

  const run = async (key: string, pending: () => Promise<WorldBackup[]>, message: string) => {
    setBusy(key);
    try {
      setBackups(await pending());
      onSuccess(message);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (!backups) return null;

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">
          {backups.length} {backups.length === 1 ? 'backup' : 'backups'}
        </span>
        <div className="toolbar-actions">
          <button className="btn btn-ghost" onClick={() => api.worlds.revealBackups(profileId, world.folder).catch((err) => onError(errorMessage(err)))}>
            <FolderOpen size={15} /> Open folder
          </button>
          <button
            className="btn btn-primary"
            disabled={running || busy !== null}
            title={running ? 'Close the game to back up' : undefined}
            onClick={() => run('new', () => api.worlds.backup(profileId, world.folder), `Backed up ${world.name}.`)}
          >
            {busy === 'new' ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Back up now
          </button>
        </div>
      </div>

      {backups.length === 0 ? (
        <div className="empty empty-compact">
          <History className="empty-icon" size={40} strokeWidth={1.5} />
          <h2>No backups yet</h2>
          <p>Workbench backs up worlds after you play them. You can also back up now.</p>
        </div>
      ) : (
        <div className="mod-list">
          {backups.map((b) => (
            <div key={b.id} className="mod-row backup-row">
              <div className="backup-icon">
                <ArchiveRestore size={18} />
              </div>
              <div className="mod-info">
                <div className="mod-title">{new Date(b.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
                <span className="mod-meta">
                  {BACKUP_LABELS[b.kind]} · {timeAgo(b.createdAt)} · {formatBytes(b.sizeBytes)}
                </span>
              </div>
              <button className="btn btn-secondary btn-sm" disabled={running || busy !== null} onClick={() => setRestoring(b)}>
                {busy === b.id ? <LoaderCircle size={14} className="spin" /> : <ArchiveRestore size={14} />} Restore
              </button>
              <button
                className="icon-btn icon-btn-danger"
                aria-label="Delete backup"
                title="Delete backup"
                disabled={busy !== null}
                onClick={() => run(`delete:${b.id}`, () => api.worlds.removeBackup(profileId, world.folder, b.id), 'Backup deleted.')}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="content-hint">Older automatic backups are cleared as new ones are made (how many are kept is in Settings). Ones you make stay until you delete them.</p>

      {restoring && (
        <Modal
          title="Restore this backup?"
          onClose={() => setRestoring(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setRestoring(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const b = restoring;
                  setRestoring(null);
                  run(b.id, () => api.worlds.restore(profileId, world.folder, b.id), `Restored ${world.name} to ${timeAgo(b.createdAt)}.`);
                }}
              >
                <ArchiveRestore size={16} /> Restore
              </button>
            </>
          }
        >
          <p className="modal-text">
            {world.name} goes back to how it was {timeAgo(restoring.createdAt)}. The world as it is now gets backed up first, so you
            can undo this.
          </p>
        </Modal>
      )}
    </>
  );
}

// ---------- Modals ----------

function RenameModal({ world, onClose, onSave }: { world: World; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(world.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(name);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Rename world"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="rename-world" className="btn btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Rename'}
          </button>
        </>
      }
    >
      <form id="rename-world" className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <p className="content-hint">This is the name you see in game. The folder keeps its name, like when you rename in game.</p>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}

function TargetProfileModal({
  profile,
  world,
  move,
  onClose,
  onDone,
}: {
  profile: Profile;
  world: World;
  move: boolean;
  onClose: () => void;
  onDone: (worlds: World[], target: Profile) => void;
}) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.profiles
      .list()
      .then((list) => setProfiles(list.filter((p) => p.id !== profile.id)))
      .catch((err) => setError(errorMessage(err)));
  }, [profile.id]);

  const submit = async () => {
    const chosen = profiles?.find((p) => p.id === target);
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const list = move ? await api.worlds.move(profile.id, world.folder, chosen.id) : await api.worlds.copy(profile.id, world.folder, chosen.id);
      onDone(list, chosen);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${move ? 'Move' : 'Copy'} ${world.name}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!target || busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <FolderInput size={16} />} {move ? 'Move' : 'Copy'}
          </button>
        </>
      }
    >
      <p className="modal-text">
        {move ? 'Moves' : 'Copies'} the world into another profile.
        {move && ' The original goes to the Recycle Bin.'} Opening it in an older Minecraft version than it was played in can break it.
      </p>
      {profiles && profiles.length === 0 && <p className="mod-empty">You don’t have any other profiles.</p>}
      <div className="pick-list pick-list-scroll" role="radiogroup" aria-label="Profile">
        {profiles?.map((p) => (
          <label key={p.id} className="pick-row pick-row-compact">
            <input type="radio" name="target-profile" checked={target === p.id} disabled={busy} onChange={() => setTarget(p.id)} />
            <span className="pick-row-text">
              <strong>{p.name}</strong>
              <span>
                {p.loader === 'vanilla' ? 'Minecraft' : LOADER_LABELS[p.loader]} {p.mcVersion}
              </span>
            </span>
          </label>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
