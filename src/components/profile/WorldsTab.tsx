import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Globe, Pencil, Play, Plus, Server as ServerIcon, Trash2, Users } from 'lucide-react';
import Worlds from './Worlds';
import Modal from '../Modal';
import { api, errorMessage } from '../../api';
import type { Profile, QuickPlay, Server, ServerStatus } from '../../types';

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

  const switcher = (
      <div className="segmented" role="group" aria-label="Worlds or servers">
        <button aria-pressed={view === 'worlds'} onClick={() => setView('worlds')}>
          <Globe size={14} /> Worlds
        </button>
        <button aria-pressed={view === 'servers'} onClick={() => setView('servers')}>
          <ServerIcon size={14} /> Servers
        </button>
      </div>
  );

  return view === 'worlds' ? (
    <Worlds
      profile={profile}
      running={running}
      launching={launching}
      onPlay={onPlay}
      onError={onError}
      onSuccess={onSuccess}
      switcher={switcher}
    />
  ) : (
    <Servers profile={profile} launching={launching} onPlay={onPlay} onError={onError} switcher={switcher} />
  );
}

// ---------- Servers ----------

type Ping = { state: 'pinging' } | { state: 'online'; status: ServerStatus } | { state: 'offline'; error: string };

function Servers({
  profile,
  launching,
  onPlay,
  onError,
  switcher,
}: Pick<Props, 'profile' | 'launching' | 'onPlay' | 'onError'> & { switcher: ReactNode }) {
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
        <div className="toolbar-lead">
          {switcher}
          <span className="toolbar-title">
            {servers.length} {servers.length === 1 ? 'server' : 'servers'}
          </span>
        </div>
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
