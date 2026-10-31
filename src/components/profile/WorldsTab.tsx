import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FolderOpen, Globe } from 'lucide-react';
import ContentTab from '../content/ContentTab';
import { api, errorMessage } from '../../api';
import { timeAgo } from '../../time';
import type { Profile, World } from '../../types';

interface Props {
  profile: Profile;
  running: boolean;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

export default function WorldsTab({ profile, running, onError, onSuccess }: Props) {
  const [worlds, setWorlds] = useState<World[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const profileId = profile.id;

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
          {world.icon ? (
            <img className="world-icon" src={world.icon} alt="" />
          ) : (
            <div className="world-icon">
              <Globe size={20} />
            </div>
          )}
          <div className="world-info">
            <div className="world-name">{world.folder}</div>
            <div className="world-meta">Data packs</div>
          </div>
        </div>
        <ContentTab
          key={world.folder}
          profile={profile}
          target={{ profileId, kind: 'datapack', world: world.folder }}
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
            <button key={w.folder} className="world-card world-card-button" onClick={() => setSelected(w.folder)}>
              {w.icon ? (
                <img className="world-icon" src={w.icon} alt="" />
              ) : (
                <div className="world-icon">
                  <Globe size={20} />
                </div>
              )}
              <div className="world-info">
                <div className="world-name">{w.folder}</div>
                <div className="world-meta">Played {timeAgo(w.lastPlayedAt)}</div>
              </div>
              <ChevronRight size={16} className="world-chevron" aria-label="Data packs" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
