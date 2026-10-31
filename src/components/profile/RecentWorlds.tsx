import { useEffect, useState } from 'react';
import { ChevronRight, Globe, Play } from 'lucide-react';
import { api } from '../../api';
import { timeAgo } from '../../time';
import { WorldIcon, modeLabel, supportsWorldQuickPlay } from './Worlds';
import type { Profile, QuickPlay, World } from '../../types';

const SHOWN = 3;

interface Props {
  profile: Profile;
  running: boolean;
  launching: boolean;
  onPlay: (quickPlay: QuickPlay) => void;
  onOpenWorlds: () => void;
}

/** The last few worlds played, each one click from opening in game. */
export default function RecentWorlds({ profile, running, launching, onPlay, onOpenWorlds }: Props) {
  const [worlds, setWorlds] = useState<World[] | null>(null);
  const canQuickPlay = supportsWorldQuickPlay(profile.mcVersion);

  // New worlds appear when the game stops.
  useEffect(() => {
    api.profiles
      .worlds(profile.id)
      .then(setWorlds)
      .catch(() => setWorlds([]));
  }, [profile.id, running]);

  if (!worlds) return null;
  const recent = [...worlds].sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt)).slice(0, SHOWN);

  return (
    <section className="recent-worlds" aria-labelledby="recent-worlds-title">
      <header>
        <h2 id="recent-worlds-title">
          <Globe size={16} /> Jump back in
        </h2>
        {worlds.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={onOpenWorlds}>
            All worlds <ChevronRight size={14} />
          </button>
        )}
      </header>
      {recent.length === 0 ? (
        <p className="recent-worlds-empty">Worlds you play show up here, ready to open straight from the launcher.</p>
      ) : (
        <ul>
          {recent.map((world) => {
            const mode = modeLabel(world);
            return (
              <li key={world.folder}>
                <WorldIcon world={world} />
                <div className="recent-world-info">
                  <div className="recent-world-name">{world.name}</div>
                  <div className="recent-world-meta">
                    {mode ? `${mode} · ` : ''}
                    {timeAgo(world.lastPlayedAt)}
                  </div>
                </div>
                {canQuickPlay && (
                  <button
                    className="icon-btn recent-world-play"
                    onClick={() => onPlay({ world: world.folder })}
                    disabled={running || launching}
                    aria-label={`Play ${world.name}`}
                    title={running ? 'The game is already running' : `Play ${world.name}`}
                  >
                    <Play size={15} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
