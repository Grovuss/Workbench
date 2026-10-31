import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, FolderOpen, Globe, Pencil, Play, Plus, Server as ServerIcon, Trash2, Users } from 'lucide-react';
import ContentTab from '../content/ContentTab';
import Modal from '../Modal';
import { api, errorMessage } from '../../api';
import { timeAgo } from '../../time';
import type { Profile, QuickPlay, Server, ServerStatus, World } from '../../types';

/** Quick play (open a world from the launcher) arrived in 1.20; year-numbered versions (26.x) have it too. */
function supportsWorldQuickPlay(mcVersion: string) {
  const [major, minor] = mcVersion.split(/[.-]/).map(Number);
  return major > 1 || (major === 1 && minor >= 20);
}

interface Props {
  profile: Profile;
  running: boolean;
  /** The game is starting or running, so it can't be launched again. */
  launching: boolean;
  onPlay: (quickPlay: QuickPlay) => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

export default function WorldsTab({ profile, running, launching, onPlay, onError, onSuccess }: Props) {
  const [view, setView] = useState<'worlds' | 'servers'>('worlds');

  return (
    <>
      <div className="segmented worlds-switch" role="group" aria-label="Worlds or servers">
        <button aria-pressed={view === 'worlds'} onClick={() => setView('worlds')}>
          <Globe size={14} /> Worlds
        </button>
        <button aria-pressed={view === 'servers'} onClick={() => setView('servers')}>
          <ServerIcon size={14} /> Servers
        </button>
      </div>
      {view === 'worlds' ? (
        <Worlds profile={profile} running={running} launching={launching} onPlay={onPlay} onError={onError} onSuccess={onSuccess} />
      ) : (
        <Servers profile={profile} launching={launching} onPlay={onPlay} onError={onError} />
      )}
    </>
  );
}

// ---------- Worlds ----------

function Worlds({ profile, running, launching, onPlay, onError, onSuccess }: Props) {
  const [worlds, setWorlds] = useState<World[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const profileId = profile.id;
  const canQuickPlay = supportsWorldQuickPlay(profile.mcVersion);

  // Reload when the game stops, since that's when new worlds appear.
  useEffect(() => {
    api.profiles
      .worlds(profileId)
      .then(setWorlds)
      .catch((err) => onError(errorMessage(err)));
  }, [profileId, running, onError]);

  if (!worlds) return null;

  const world = worlds.find((w) => w.folder === selected);
  if (world) {
    return (
      <>
        <div className="world-header">
          <button className="btn btn-ghost" onClick={() => setSelected(null)}>
            <ChevronLeft size={16} /> Worlds
          </button>
          <WorldIcon world={world} />
          <div className="world-info">
            <div className="world-name">{world.folder}</div>
            <div className="world-meta">Data packs</div>
          </div>
          {canQuickPlay && (
            <button className="btn btn-primary btn-play world-header-play" disabled={launching} onClick={() => onPlay({ world: world.folder })}>
              <Play size={15} /> Play
            </button>
          )}
        </div>
        <ContentTab
          key={world.folder}
          profile={profile}
          kinds={['datapack']}
          world={world.folder}
          running={running}
          onError={onError}
          onSuccess={onSuccess}
        />
      </>
    );
  }

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">
          {worlds.length} {worlds.length === 1 ? 'world' : 'worlds'}
        </span>
        <button
          className="btn btn-ghost"
          onClick={() => api.profiles.openFolder(profileId, 'saves').catch((err) => onError(errorMessage(err)))}
        >
          <FolderOpen size={15} /> Open saves folder
        </button>
      </div>

      {worlds.length === 0 ? (
        <div className="empty empty-compact">
          <Globe className="empty-icon" size={40} strokeWidth={1.5} />
          <h2>No worlds yet</h2>
          <p>Worlds you create in this profile show up here. Open one to manage its data packs.</p>
        </div>
      ) : (
        <div className="world-list">
          {worlds.map((w) => (
            <div key={w.folder} className="world-card world-card-button" role="button" tabIndex={0} onClick={() => setSelected(w.folder)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), setSelected(w.folder))}
            >
              <WorldIcon world={w} />
              <div className="world-info">
                <div className="world-name">{w.folder}</div>
                <div className="world-meta">Played {timeAgo(w.lastPlayedAt)}</div>
              </div>
              {canQuickPlay ? (
                <button
                  className="icon-btn icon-btn-play"
                  aria-label={`Play ${w.folder}`}
                  title="Play this world"
                  disabled={launching}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay({ world: w.folder });
                  }}
                >
                  <Play size={16} />
                </button>
              ) : (
                <ChevronRight size={16} className="world-chevron" aria-hidden />
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function WorldIcon({ world }: { world: World }) {
  return world.icon ? (
    <img className="world-icon" src={world.icon} alt="" />
  ) : (
    <div className="world-icon">
      <Globe size={20} />
    </div>
  );
}

// ---------- Servers ----------

type Ping = { state: 'pinging' } | { state: 'online'; status: ServerStatus } | { state: 'offline'; error: string };

function Servers({ profile, launching, onPlay, onError }: Pick<Props, 'profile' | 'launching' | 'onPlay' | 'onError'>) {
  const [servers, setServers] = useState<Server[] | null>(null);
  const [pings, setPings] = useState<Record<string, Ping>>({});
  const [editing, setEditing] = useState<Server | 'new' | null>(null);

  const pingAll = useCallback((list: Server[]) => {
    for (const address of new Set(list.map((s) => s.address))) {
      setPings((p) => ({ ...p, [address]: { state: 'pinging' } }));
      api.servers
        .ping(address)
        .then((status) => setPings((p) => ({ ...p, [address]: { state: 'online', status } })))
        .catch((err) => setPings((p) => ({ ...p, [address]: { state: 'offline', error: errorMessage(err) } })));
    }
  }, []);

  const show = useCallback(
    (list: Server[]) => {
      setServers(list);
      pingAll(list);
    },
    [pingAll],
  );

  useEffect(() => {
    api.servers
      .list(profile.id)
      .then(show)
      .catch((err) => onError(errorMessage(err)));
  }, [profile.id, show, onError]);

  if (!servers) return null;

  const remove = (server: Server) =>
    api.servers
      .remove(profile.id, server.index)
      .then(setServers)
      .catch((err) => onError(errorMessage(err)));

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">
          {servers.length} {servers.length === 1 ? 'server' : 'servers'}
        </span>
        <div className="toolbar-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Add server
          </button>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="empty empty-compact">
          <ServerIcon className="empty-icon" size={40} strokeWidth={1.5} />
          <h2>No servers yet</h2>
          <p>Add a server to join it straight from the launcher. It also shows up in the game’s server list.</p>
        </div>
      ) : (
        <div className="mod-list">
          {servers.map((s) => {
            const ping = pings[s.address];
            const status = ping?.state === 'online' ? ping.status : null;
            const icon = status?.icon ?? s.icon;
            return (
              <div key={`${s.index}-${s.address}`} className="mod-row server-row">
                {icon ? (
                  <img className="mod-icon server-icon" src={icon} alt="" width={44} height={44} />
                ) : (
                  <div className="mod-icon server-icon" style={{ width: 44, height: 44 }}>
                    <ServerIcon size={20} />
                  </div>
                )}
                <div className="mod-info">
                  <div className="mod-title">
                    {s.name} <span className="mod-author">{s.address}</span>
                  </div>
                  {status?.motd && <p className="mod-description server-motd">{status.motd}</p>}
                  <span className="mod-meta">
                    {!ping || ping.state === 'pinging' ? (
                      'Checking…'
                    ) : ping.state === 'offline' ? (
                      <span className="server-offline">{ping.error}</span>
                    ) : (
                      <>
                        <span className="server-online-dot" />
                        {status!.players && (
                          <>
                            <Users size={12} /> {status!.players.online.toLocaleString()} / {status!.players.max.toLocaleString()}
                            <span className="dot">·</span>
                          </>
                        )}
                        {status!.latencyMs} ms
                        {status!.version && (
                          <>
                            <span className="dot">·</span>
                            {status!.version}
                          </>
                        )}
                      </>
                    )}
                  </span>
                </div>
                <button className="btn btn-primary btn-play" disabled={launching} onClick={() => onPlay({ server: s.address })}>
                  <Play size={15} /> Join
                </button>
                <button className="icon-btn" aria-label={`Edit ${s.name}`} title="Edit" onClick={() => setEditing(s)}>
                  <Pencil size={15} />
                </button>
                <button className="icon-btn icon-btn-danger" aria-label={`Remove ${s.name}`} title="Remove" onClick={() => remove(s)}>
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ServerModal
          server={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const list =
              editing === 'new'
                ? await api.servers.add(profile.id, input)
                : await api.servers.update(profile.id, editing.index, input);
            show(list);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ServerModal({
  server,
  onClose,
  onSave,
}: {
  server: Server | null;
  onClose: () => void;
  onSave: (input: { name: string; address: string }) => Promise<void>;
}) {
  const [name, setName] = useState(server?.name ?? '');
  const [address, setAddress] = useState(server?.address ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ name, address });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={server ? 'Edit server' : 'Add server'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="server-form" className="btn btn-primary" disabled={!address.trim() || saving}>
            {saving ? 'Saving…' : server ? 'Save' : 'Add server'}
          </button>
        </>
      }
    >
      <form id="server-form" className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Address</span>
          <input
            className="input"
            value={address}
            placeholder="play.example.com"
            onChange={(e) => setAddress(e.target.value)}
            autoFocus
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={name} maxLength={64} placeholder="Minecraft Server" onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}
