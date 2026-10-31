import { useEffect, useState } from 'react';
import { FolderOpen, Globe } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { timeAgo } from '../../time';
import type { World } from '../../types';

interface Props {
  profileId: string;
  running: boolean;
  onError: (message: string) => void;
}

export default function WorldsTab({ profileId, running, onError }: Props) {
  const [worlds, setWorlds] = useState<World[] | null>(null);

  // Reload when the game stops, since that's when new worlds appear.
  useEffect(() => {
    api.profiles
      .worlds(profileId)
      .then(setWorlds)
      .catch((err) => onError(errorMessage(err)));
  }, [profileId, running, onError]);

  if (!worlds) return null;

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
          <p>Worlds you create in this profile show up here.</p>
        </div>
      ) : (
        <div className="world-list">
          {worlds.map((w) => (
            <div key={w.folder} className="world-card">
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
            </div>
          ))}
        </div>
      )}
    </>
  );
}
