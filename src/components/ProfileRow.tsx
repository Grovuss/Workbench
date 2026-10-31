import { FolderOpen, LoaderCircle, Play, Square, Trash2 } from 'lucide-react';
import logo from '../assets/logo.svg';
import { timeAgo } from '../time';
import type { LaunchStatus, Profile } from '../types';

interface Props {
  profile: Profile;
  launch?: LaunchStatus;
  onPlay: () => void;
  onStop: () => void;
  onOpenFolder: () => void;
  onDelete: () => void;
}

export default function ProfileRow({ profile, launch, onPlay, onStop, onOpenFolder, onDelete }: Props) {
  const state = launch?.state ?? 'idle';
  const progress = launch?.progress;
  const percent = progress?.total ? Math.floor((progress.done / progress.total) * 100) : 0;

  let meta: string;
  if (state === 'installing') {
    meta = progress
      ? `${progress.label} · ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`
      : 'Preparing…';
  } else {
    meta = profile.lastPlayedAt ? `Played ${timeAgo(profile.lastPlayedAt)}` : 'Never played';
  }

  return (
    <div className="profile-row" data-state={state}>
      <div className="profile-icon">
        <img src={logo} alt="" />
      </div>

      <div className="profile-info">
        <div className="profile-name">
          {profile.name}
          <span className="badge badge-vanilla">Vanilla {profile.mcVersion}</span>
          {state === 'running' && (
            <span className="badge badge-running">
              <span className="running-dot" /> Running
            </span>
          )}
        </div>
        <div className="profile-meta">{meta}</div>
      </div>

      <div className="profile-actions">
        <button className="btn btn-ghost" onClick={onOpenFolder}>
          <FolderOpen size={15} /> Folder
        </button>
        <button className="btn btn-ghost btn-danger" onClick={onDelete} disabled={state !== 'idle'}>
          <Trash2 size={15} /> Delete
        </button>
        {state === 'idle' && (
          <button className="btn btn-primary btn-play" onClick={onPlay}>
            <Play size={15} fill="currentColor" /> Play
          </button>
        )}
        {state === 'installing' && (
          <button className="btn btn-primary btn-play" disabled>
            <LoaderCircle size={15} className="spin" /> {progress ? `${percent}%` : 'Starting'}
          </button>
        )}
        {state === 'running' && (
          <button className="btn btn-stop btn-play" onClick={onStop}>
            <Square size={13} fill="currentColor" /> Stop
          </button>
        )}
      </div>

      {state === 'installing' && (
        <div className="profile-progress" aria-hidden="true">
          <div style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}
